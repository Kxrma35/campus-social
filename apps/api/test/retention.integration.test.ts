import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgLifecycleStore } from "../src/account/pgLifecycleStore.js";
import { runLifecycleSweep, type SweepOptions } from "../src/account/lifecycleStore.js";
import { AccountService } from "../src/account/service.js";
import { PgAuthStore } from "../src/auth/pgStore.js";
import { AuthService } from "../src/auth/service.js";
import { AuthActorResolver } from "../src/content/actor.js";
import { PgContentStore } from "../src/content/pgStore.js";
import { LocalPhotoStore } from "../src/content/photos.js";
import { ContentService, DEFAULT_CONTENT_OPTIONS } from "../src/content/service.js";
import type { Actor } from "../src/content/types.js";
import { PgReportStore, ReportService } from "../src/moderation/reports.js";
import { CapturingMailer } from "./helpers/memoryStore.js";

const password = process.env.TEST_PG_PASSWORD;
const host = process.env.TEST_PG_HOST ?? "127.0.0.1";
const port = Number(process.env.TEST_PG_PORT ?? 5432);
const database = process.env.TEST_PG_DB ?? "campus_social";

const suite = password ? describe : describe.skip;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SWEEP: SweepOptions = { reverifyGraceDays: 30, purgeAfterDays: 30 };

function pool(user: string) {
  return new pg.Pool({ host, port, database, user, password, max: 4 });
}

class FlakyPhotoStore extends LocalPhotoStore {
  failing = new Set<string>();
  override async delete(key: string): Promise<void> {
    if (this.failing.has(key)) throw new Error("storage unavailable");
    return super.delete(key);
  }
}

interface Student {
  email: string;
  token: string;
  accountId: string;
  actor: Actor;
}

suite("Retention and storage cleanup (PostgreSQL + filesystem)", () => {
  let admin: pg.Pool;
  let authPool: pg.Pool;
  let appPool: pg.Pool;
  let lifePool: pg.Pool;
  let modPool: pg.Pool;
  let photoDir: string;

  let photos: FlakyPhotoStore;
  let mailer: CapturingMailer;
  let clock: { now: Date };
  let auth: AuthService;
  let content: ContentService;
  let reports: ReportService;
  let lifecycle: PgLifecycleStore;
  let account: AccountService;
  let actors: AuthActorResolver;

  beforeAll(async () => {
    admin = pool("postgres");
    authPool = pool("auth_service");
    appPool = pool("app_api");
    lifePool = pool("account_lifecycle");
    modPool = pool("moderator");
    photoDir = await mkdtemp(join(tmpdir(), "retention-photos-"));
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
    photos = new FlakyPhotoStore(photoDir);

    const authStore = new PgAuthStore(authPool);
    auth = new AuthService(
      authStore,
      mailer,
      {
        codeHmacKey: "retention-key-retention-key-0123456789",
        codeTtlMinutes: 10,
        maxCodesPerHour: 100,
        maxCodeAttempts: 3,
        sessionTtlDays: 400,
        termsVersion: "t",
      },
      () => clock.now,
    );
    actors = new AuthActorResolver(auth);
    const reportStore = new PgReportStore(appPool);
    content = new ContentService(
      new PgContentStore(appPool),
      photos,
      {
        ...DEFAULT_CONTENT_OPTIONS,
        maxPostsPerHour: 1000,
        maxCommentsPerHour: 1000,
        maxPendingUploads: 100,
      },
      () => clock.now,
    );
    reports = new ReportService(reportStore);
    lifecycle = new PgLifecycleStore(lifePool);
    account = new AccountService(auth, authStore, lifecycle, () => clock.now);
  });

  async function student(name: string): Promise<Student> {
    const email = `${name}@test.ac.ke`;
    await auth.requestSignup(email);
    const s = await auth.verifySignup({
      email,
      code: mailer.lastCode(email),
      dateOfBirth: "2004-05-01",
      displayName: `${name} Student`,
    });
    return {
      email,
      token: s.sessionToken,
      accountId: s.account.id,
      actor: await actors.resolve(s.sessionToken, "known"),
    };
  }

  const jpeg = (colour: string) =>
    sharp({ create: { width: 32, height: 32, channels: 3, background: colour } })
      .jpeg()
      .toBuffer();

  async function postWithPhotos(s: Student, body: string, n: number) {
    const uploadIds: string[] = [];
    for (let i = 0; i < n; i += 1) {
      uploadIds.push((await content.uploadPhoto(s.actor, await jpeg("#336699"))).id);
    }
    const post = await content.createPost(s.actor, { body, photoIds: uploadIds });
    const keys = (
      await admin.query(`select storage_key from photo_uploads where id = any($1)`, [uploadIds])
    ).rows.map((r) => r.storage_key as string);
    return { post, uploadIds, keys };
  }

  const filesOnDisk = async () => (await readdir(photoDir)).sort();
  const count = async (sql: string, args: unknown[] = []) =>
    (await admin.query(sql, args)).rows[0].n as number;
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  const sweep = () => runLifecycleSweep(lifecycle, SWEEP, clock.now, photos);

  describe("posts a student deleted", () => {
    it("keeps them for 30 days, then removes rows and files", async () => {
      const a = await student("alice");
      const { post, keys } = await postWithPhotos(a, "with two pictures", 2);
      expect(await filesOnDisk()).toEqual([...keys].sort());

      await content.deletePost(a.actor, post.id);

      advance(29 * DAY);
      const early = await sweep();
      expect(early.purgedPosts).toBe(0);
      expect(await count(`select count(*)::int n from posts where id = $1`, [post.id])).toBe(1);
      expect(await filesOnDisk()).toEqual([...keys].sort());

      advance(2 * DAY);
      const r = await sweep();
      expect(r.purgedPosts).toBe(1);
      expect(r.filesDeleted).toBe(2);

      expect(await count(`select count(*)::int n from posts where id = $1`, [post.id])).toBe(0);
      expect(await count(`select count(*)::int n from post_photos`)).toBe(0);
      expect(await count(`select count(*)::int n from photo_uploads`)).toBe(0);
      expect(await count(`select count(*)::int n from storage_deletions`)).toBe(0);
      expect(await filesOnDisk()).toEqual([]);
    });

    it("leaves other posts, their photos and their files alone", async () => {
      const a = await student("alice");
      const gone = await postWithPhotos(a, "deleted", 1);
      const kept = await postWithPhotos(a, "kept", 2);
      await content.deletePost(a.actor, gone.post.id);

      advance(31 * DAY);
      await sweep();

      expect(await filesOnDisk()).toEqual([...kept.keys].sort());
      expect(await count(`select count(*)::int n from posts where id = $1`, [kept.post.id])).toBe(1);
      expect(await count(`select count(*)::int n from photo_uploads`)).toBe(2);
    });

    it("cascades away the post's comments and reactions", async () => {
      const a = await student("alice");
      const b = await student("bob");
      const { post } = await postWithPhotos(a, "thread", 0);
      await content.createComment(b.actor, post.id, "hello");
      await content.react(b.actor, { postId: post.id });
      await content.deletePost(a.actor, post.id);

      advance(31 * DAY);
      await sweep();

      expect(await count(`select count(*)::int n from comments`)).toBe(0);
      expect(await count(`select count(*)::int n from reactions`)).toBe(0);
    });

    it("purges comments a student deleted, and nothing else", async () => {
      const a = await student("alice");
      const b = await student("bob");
      const { post } = await postWithPhotos(a, "thread", 0);
      const mine = await content.createComment(b.actor, post.id, "to delete");
      await content.createComment(b.actor, post.id, "to keep");
      await content.deleteComment(b.actor, mine.id);

      advance(31 * DAY);
      const r = await sweep();

      expect(r.purgedComments).toBe(1);
      const left = await admin.query(`select body from comments`);
      expect(left.rows).toEqual([{ body: "to keep" }]);
    });

    it("does not purge posts that moderation hid but the author did not delete", async () => {
      const a = await student("alice");
      const { post } = await postWithPhotos(a, "hidden by a moderator", 1);
      await admin.query(
        `update posts set hidden_at = now(), hidden_reason = 'moderator' where id = $1`,
        [post.id],
      );

      advance(45 * DAY);
      const r = await sweep();
      expect(r.purgedPosts).toBe(0);
      expect(await count(`select count(*)::int n from accounts where status = 'active'`)).toBe(1);
      expect(
        await count(`select count(*)::int n from posts where id = $1 and deleted_at is null`, [post.id]),
      ).toBe(1);
      expect((await filesOnDisk()).length).toBe(1);
    });

    it("keeps a deleted post while a report on it is unresolved, then purges it", async () => {
      const a = await student("alice");
      const b = await student("bob");
      const { post } = await postWithPhotos(a, "reported then deleted", 1);
      await reports.report(b.actor, { targetKind: "post", targetId: post.id, reason: "harassment" });
      await content.deletePost(a.actor, post.id);

      advance(60 * DAY);
      const held = await sweep();
      expect(held.purgedPosts).toBe(0);
      expect(await count(`select count(*)::int n from posts where id = $1`, [post.id])).toBe(1);
      expect((await filesOnDisk()).length).toBe(1);

      await admin.query(`update moderation.reports set status = 'dismissed'`);
      const released = await sweep();
      expect(released.purgedPosts).toBe(1);
      expect(await filesOnDisk()).toEqual([]);
    });

    it("is idempotent", async () => {
      const a = await student("alice");
      const { post } = await postWithPhotos(a, "x", 1);
      await content.deletePost(a.actor, post.id);
      advance(31 * DAY);
      await sweep();

      const again = await sweep();
      expect(again).toMatchObject({
        purgedPosts: 0,
        purgedComments: 0,
        filesDeleted: 0,
        filesFailed: 0,
        filesPending: 0,
      });
    });
  });

  describe("files when an account is purged", () => {
    it("removes every file the account owned, including uploads never attached to a post", async () => {
      const a = await student("alice");
      const b = await student("bob");
      await postWithPhotos(a, "one", 2);
      await postWithPhotos(a, "two", 1);
      await content.uploadPhoto(a.actor, await jpeg("#cc4444"));
      const bobs = await postWithPhotos(b, "bob stays", 1);
      expect((await filesOnDisk()).length).toBe(5);

      await account.requestClose(a.token);
      await account.confirmClose(a.token, mailer.lastCode(a.email));
      advance(31 * DAY);
      const r = await sweep();

      expect(r.purged).toBe(1);
      expect(await filesOnDisk()).toEqual([...bobs.keys].sort());
      expect(await count(`select count(*)::int n from storage_deletions`)).toBe(0);
      expect(await count(`select count(*)::int n from photo_uploads`)).toBe(1);
    });
  });

  describe("when a file cannot be deleted", () => {
    it("keeps the key queued and succeeds on a later sweep", async () => {
      const a = await student("alice");
      const { post, keys } = await postWithPhotos(a, "two files", 2);
      await content.deletePost(a.actor, post.id);
      const [ok, stuck] = [...keys].sort();
      photos.failing.add(stuck!);

      advance(31 * DAY);
      const r1 = await sweep();
      expect(r1.filesDeleted).toBe(1);
      expect(r1.filesFailed).toBe(1);
      expect(r1.filesPending).toBe(1);
      expect(await filesOnDisk()).toEqual([stuck]);
      expect(await count(`select count(*)::int n from photo_uploads`)).toBe(0);
      const queued = await admin.query(`select storage_key from storage_deletions`);
      expect(queued.rows).toEqual([{ storage_key: stuck }]);
      expect(ok).not.toBe(stuck);

      photos.failing.clear();
      const r2 = await sweep();
      expect(r2.filesDeleted).toBe(1);
      expect(r2.filesPending).toBe(0);
      expect(await filesOnDisk()).toEqual([]);
    });

    it("queues files even when the sweep has no storage to delete from", async () => {
      const a = await student("alice");
      const { post } = await postWithPhotos(a, "x", 1);
      await content.deletePost(a.actor, post.id);
      advance(31 * DAY);

      const blind = await runLifecycleSweep(lifecycle, SWEEP, clock.now);
      expect(blind.filesPending).toBe(1);
      expect((await filesOnDisk()).length).toBe(1);

      const proper = await sweep();
      expect(proper.filesDeleted).toBe(1);
      expect(await filesOnDisk()).toEqual([]);
    });
  });

  describe("records that have outlived their purpose", () => {
    it("removes expired one-time codes and the email of a sign-up never finished", async () => {
      await student("alice");
      await auth.requestSignup("never-finished@test.ac.ke");
      expect(
        await count(`select count(*)::int n from email_codes where email = 'never-finished@test.ac.ke'`),
      ).toBe(1);

      advance(2 * HOUR);
      expect((await sweep()).expiredCodes).toBe(0);

      advance(23 * HOUR);
      const r = await sweep();
      expect(r.expiredCodes).toBeGreaterThanOrEqual(2);
      expect(await count(`select count(*)::int n from email_codes`)).toBe(0);
      expect(
        await count(`select count(*)::int n from accounts where email = 'never-finished@test.ac.ke'`),
      ).toBe(0);
    });

    it("removes sessions a week after they expire or are revoked, never live ones", async () => {
      const a = await student("alice");
      await auth.requestLogin(a.email);
      const second = await auth.verifyLogin(a.email, mailer.lastCode(a.email));
      await auth.logout(second.sessionToken);

      advance(6 * DAY);
      expect((await sweep()).expiredSessions).toBe(0);

      advance(2 * DAY);
      const r = await sweep();
      expect(r.expiredSessions).toBe(1);
      expect(await count(`select count(*)::int n from sessions`)).toBe(1);
      await expect(auth.authenticate(a.token)).resolves.toMatchObject({ accountId: a.accountId });
    });

    it("removes unattached uploads and their files after a day, keeping attached and recent ones", async () => {
      const a = await student("alice");
      const attached = await postWithPhotos(a, "has a photo", 1);
      const stale = await content.uploadPhoto(a.actor, await jpeg("#aa0000"));

      advance(23 * HOUR);
      const fresh = await content.uploadPhoto(a.actor, await jpeg("#00aa00"));
      advance(2 * HOUR);

      const r = await sweep();
      expect(r.staleUploads).toBe(1);

      const remaining = await admin.query(`select id from photo_uploads order by created_at`);
      const ids = remaining.rows.map((x) => x.id);
      expect(ids).toContain(fresh.id);
      expect(ids).toContain(attached.uploadIds[0]);
      expect(ids).not.toContain(stale.id);
      expect((await filesOnDisk()).length).toBe(2);
    });
  });

  describe("role privileges for the new objects", () => {
    it("account_lifecycle sees only the report columns it needs", async () => {
      const ok = await lifePool.query(
        `select target_kind, target_id, status from moderation.reports`,
      );
      expect(ok.rowCount).toBe(0);

      for (const col of ["reporter_account_id", "reason", "detail", "source"]) {
        await expect(
          lifePool.query(`select ${col} from moderation.reports`),
          col,
        ).rejects.toThrow(/permission denied/);
      }
      await expect(lifePool.query(`select * from moderation.actions`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        lifePool.query(`update moderation.reports set status = 'dismissed'`),
      ).rejects.toThrow(/permission denied/);
    });

    it("only the lifecycle role can touch the deletion queue", async () => {
      for (const [name, p] of [
        ["app_api", appPool],
        ["auth_service", authPool],
        ["moderator", modPool],
      ] as const) {
        await expect(p.query(`select * from storage_deletions`), name).rejects.toThrow(
          /permission denied/,
        );
        await expect(
          p.query(`insert into storage_deletions (storage_key) values ('x.jpg')`),
          name,
        ).rejects.toThrow(/permission denied/);
      }
      await expect(lifePool.query(`select count(*) from storage_deletions`)).resolves.toBeTruthy();
    });

    it("account_lifecycle still cannot create or alter content", async () => {
      await expect(
        lifePool.query(`insert into posts (author_profile_id, body) values (gen_random_uuid(), 'x')`),
      ).rejects.toThrow(/permission denied/);
      await expect(lifePool.query(`update posts set body = 'x'`)).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});
