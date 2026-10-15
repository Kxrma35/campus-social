import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgAdminStore } from "../src/admin/pgStore.js";
import { PgLifecycleStore } from "../src/account/pgLifecycleStore.js";
import { runLifecycleSweep, type SweepOptions } from "../src/account/lifecycleStore.js";
import { PgAuthStore } from "../src/auth/pgStore.js";
import { AuthService } from "../src/auth/service.js";
import { AuthActorResolver } from "../src/content/actor.js";
import { PgContentStore } from "../src/content/pgStore.js";
import { LocalPhotoStore } from "../src/content/photos.js";
import { ContentService, DEFAULT_CONTENT_OPTIONS } from "../src/content/service.js";
import type { Actor } from "../src/content/types.js";
import { CapturingMailer } from "./helpers/memoryStore.js";

const password = process.env.TEST_PG_PASSWORD;
const host = process.env.TEST_PG_HOST ?? "127.0.0.1";
const port = Number(process.env.TEST_PG_PORT ?? 5432);
const database = process.env.TEST_PG_DB ?? "campus_social";

const suite = password ? describe : describe.skip;
const DAY = 24 * 60 * 60 * 1000;
const SWEEP: SweepOptions = { reverifyGraceDays: 30, purgeAfterDays: 30 };

function pool(user: string) {
  return new pg.Pool({ host, port, database, user, password, max: 4 });
}

suite("Profile photo (PostgreSQL + filesystem)", () => {
  let admin: pg.Pool;
  let authPool: pg.Pool;
  let appPool: pg.Pool;
  let lifePool: pg.Pool;
  let modPool: pg.Pool;
  let photoDir: string;

  let photos: LocalPhotoStore;
  let mailer: CapturingMailer;
  let clock: { now: Date };
  let auth: AuthService;
  let content: ContentService;
  let lifecycle: PgLifecycleStore;
  let adminStore: PgAdminStore;
  let actors: AuthActorResolver;

  beforeAll(async () => {
    admin = pool("postgres");
    authPool = pool("auth_service");
    appPool = pool("app_api");
    lifePool = pool("account_lifecycle");
    modPool = pool("moderator");
    photoDir = await mkdtemp(join(tmpdir(), "avatar-photos-"));
  });

  afterAll(async () => {
    await Promise.all([admin, authPool, appPool, lifePool, modPool].map((p) => p?.end()));
    if (photoDir) await rm(photoDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await admin.query(
      `truncate accounts, profiles, email_codes, sessions, banned_emails, universities,
                photo_uploads, notifications, storage_deletions, moderation.reports,
                moderation.actions, moderation.penalties, moderation.appeals cascade`,
    );
    await admin.query(
      `insert into universities (name, email_domain, active) values ('One', 'test.ac.ke', true)`,
    );
    for (const f of await readdir(photoDir)) await rm(join(photoDir, f), { force: true });

    clock = { now: new Date("2026-10-12T10:00:00Z") };
    mailer = new CapturingMailer();
    photos = new LocalPhotoStore(photoDir);
    const authStore = new PgAuthStore(authPool);
    auth = new AuthService(
      authStore,
      mailer,
      {
        codeHmacKey: "avatar-key-avatar-key-avatar-key-0123456789",
        codeTtlMinutes: 10,
        maxCodesPerHour: 100,
        maxCodeAttempts: 3,
        sessionTtlDays: 400,
        termsVersion: "t",
      },
      () => clock.now,
    );
    actors = new AuthActorResolver(auth);
    content = new ContentService(
      new PgContentStore(appPool),
      photos,
      { ...DEFAULT_CONTENT_OPTIONS, maxPendingUploads: 100 },
      () => clock.now,
    );
    lifecycle = new PgLifecycleStore(lifePool);
    adminStore = new PgAdminStore(modPool);
  });

  async function student(name: string): Promise<Actor> {
    const email = `${name}@test.ac.ke`;
    await auth.requestSignup(email);
    const s = await auth.verifySignup({
      email,
      code: mailer.lastCode(email),
      dateOfBirth: "2004-05-01",
      displayName: `${name} Student`,
    });
    return actors.resolve(s.sessionToken, "known");
  }

  const jpeg = (colour: string) =>
    sharp({ create: { width: 32, height: 32, channels: 3, background: colour } }).jpeg().toBuffer();
  const count = async (sql: string, args: unknown[] = []) =>
    (await admin.query(sql, args)).rows[0].n as number;
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return "ok";
    } catch (e) {
      return (e as { code?: string }).code ?? "error";
    }
  };

  it("sets, serves, replaces and removes a photo", async () => {
    const alice = await student("alice");
    const bob = await student("bob");

    const first = await content.uploadPhoto(alice, await jpeg("#336699"));
    await content.setAvatar(alice, first.id);
    expect((await content.getProfile(bob, alice.profileId)).hasAvatar).toBe(true);
    expect((await content.readAvatar(bob, alice.profileId)).length).toBeGreaterThan(50);

    const second = await content.uploadPhoto(alice, await jpeg("#993366"));
    await content.setAvatar(alice, second.id);
    expect(
      await count(`select count(*)::int n from photo_uploads where id = $1 and attached_at is null`, [first.id]),
    ).toBe(1);

    await content.removeAvatar(alice);
    expect((await content.getProfile(bob, alice.profileId)).hasAvatar).toBe(false);
    expect(await code(content.readAvatar(bob, alice.profileId))).toBe("not_found");
  });

  it("shows hasAvatar on a post author", async () => {
    const alice = await student("alice");
    const up = await content.uploadPhoto(alice, await jpeg("#336699"));
    await content.setAvatar(alice, up.id);
    const post = await content.createPost(alice, { body: "hello" });
    expect(post.author.hasAvatar).toBe(true);
  });

  it("refuses an anonymous profile at the database, whatever the code does", async () => {
    const alice = await student("alice");
    const up = await content.uploadPhoto(alice, await jpeg("#336699"));
    const uni = (await admin.query(`select id from universities limit 1`)).rows[0].id;
    const anon = (
      await admin.query(
        `insert into profiles (kind, university_id, handle) values ('anonymous', $1, 'quiet_fox_1111') returning id`,
        [uni],
      )
    ).rows[0].id;
    await expect(
      admin.query(`update profiles set avatar_upload_id = $1 where id = $2`, [up.id, anon]),
    ).rejects.toThrow(/profiles_avatar_known_only/);
  });

  it("lets a moderator remove it, records the action, and cleans the file up", async () => {
    const alice = await student("alice");
    const up = await content.uploadPhoto(alice, await jpeg("#336699"));
    await content.setAvatar(alice, up.id);
    await admin.query(
      `insert into moderation.moderators (name, token_hash) values ('Mo', 'x'::bytea)`,
    );

    expect(
      await adminStore.removeAvatar({ profileId: alice.profileId, moderator: "Mo", note: "Breaks rule 4" }),
    ).toBe(true);
    expect(await adminStore.removeAvatar({ profileId: alice.profileId, moderator: "Mo", note: "again" })).toBe(
      false,
    );

    expect(
      await count(
        `select count(*)::int n from moderation.actions
          where kind = 'avatar_removed' and target_id = $1 and moderator = 'Mo'`,
        [alice.profileId],
      ),
    ).toBe(1);
    expect(
      await count(`select count(*)::int n from profiles where id = $1 and avatar_upload_id is null`, [
        alice.profileId,
      ]),
    ).toBe(1);

    clock.now = new Date(clock.now.getTime() + 3 * DAY);
    const r = await runLifecycleSweep(lifecycle, SWEEP, clock.now, photos);
    expect(r.filesDeleted).toBe(1);
    expect(await count(`select count(*)::int n from photo_uploads where id = $1`, [up.id])).toBe(0);
    expect(await readdir(photoDir)).toEqual([]);
  });

  it("shows moderators the photo when they open the profile", async () => {
    const alice = await student("alice");
    const up = await content.uploadPhoto(alice, await jpeg("#336699"));
    await content.setAvatar(alice, up.id);
    const detail = await adminStore.targetDetail("profile", alice.profileId);
    expect(detail?.photos.map((p) => p.uploadId)).toEqual([up.id]);
  });

  it("limits what the moderator role can change on a profile", async () => {
    const alice = await student("alice");
    await expect(
      modPool.query(`update profiles set display_name = 'x' where id = $1`, [alice.profileId]),
    ).rejects.toThrow(/permission denied/);
  });

  it("stops serving the photo once the profile is deleted", async () => {
    const alice = await student("alice");
    const bob = await student("bob");
    const up = await content.uploadPhoto(alice, await jpeg("#336699"));
    await content.setAvatar(alice, up.id);
    await admin.query(`update profiles set deleted_at = now() where id = $1`, [alice.profileId]);
    expect(await code(content.readAvatar(bob, alice.profileId))).toBe("not_found");
  });
});
