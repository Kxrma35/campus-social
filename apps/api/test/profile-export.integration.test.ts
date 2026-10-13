import { randomBytes } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgAdminStore } from "../src/admin/pgStore.js";
import { AdminService, DEFAULT_ADMIN_OPTIONS } from "../src/admin/service.js";
import type { Moderator } from "../src/admin/store.js";
import { PgLifecycleStore } from "../src/account/pgLifecycleStore.js";
import { AccountService } from "../src/account/service.js";
import { PgAuthStore } from "../src/auth/pgStore.js";
import { AuthService } from "../src/auth/service.js";
import { AuthActorResolver } from "../src/content/actor.js";
import { PgContentStore } from "../src/content/pgStore.js";
import { ContentService, DEFAULT_CONTENT_OPTIONS } from "../src/content/service.js";
import type { Actor } from "../src/content/types.js";
import { LinkCrypto } from "../src/identity/linkCrypto.js";
import { DEFAULT_IDENTITY_OPTIONS, IdentityService } from "../src/identity/service.js";
import { PgReportStore, ReportService } from "../src/moderation/reports.js";
import { DEFAULT_PROFILE_OPTIONS, ProfileService } from "../src/profile/service.js";
import { CapturingMailer } from "./helpers/memoryStore.js";
import { MemoryPhotoStore } from "./helpers/memoryContent.js";

const password = process.env.TEST_PG_PASSWORD;
const host = process.env.TEST_PG_HOST ?? "127.0.0.1";
const port = Number(process.env.TEST_PG_PORT ?? 5432);
const database = process.env.TEST_PG_DB ?? "campus_social";

const suite = password ? describe : describe.skip;
const DAY = 24 * 60 * 60 * 1000;
const b64 = () => randomBytes(32).toString("base64");

function pool(user: string) {
  return new pg.Pool({ host, port, database, user, password, max: 6 });
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}

interface Student {
  email: string;
  token: string;
  accountId: string;
  knownProfileId: string;
  known: Actor;
  anon?: Actor;
  anonProfileId?: string;
}

suite("Profile correction and data export (PostgreSQL)", () => {
  let admin: pg.Pool;
  let authPool: pg.Pool;
  let appPool: pg.Pool;
  let lifePool: pg.Pool;
  let modPool: pg.Pool;
  let tsPool: pg.Pool;

  let clock: { now: Date };
  let mailer: CapturingMailer;
  let authStore: PgAuthStore;
  let auth: AuthService;
  let profile: ProfileService;
  let identity: IdentityService;
  let actors: AuthActorResolver;
  let content: ContentService;
  let reports: ReportService;
  let adminSvc: AdminService;
  let account: AccountService;
  const mod: Moderator = { id: "m1", name: "Wanjiru" };

  beforeAll(() => {
    admin = pool("postgres");
    authPool = pool("auth_service");
    appPool = pool("app_api");
    lifePool = pool("account_lifecycle");
    modPool = pool("moderator");
    tsPool = pool("trust_safety");
  });

  afterAll(async () => {
    await Promise.all([admin, authPool, appPool, lifePool, modPool, tsPool].map((p) => p?.end()));
  });

  beforeEach(async () => {
    await admin.query(
      `truncate accounts, profiles, email_codes, sessions, banned_emails, universities,
                photo_uploads, notifications, storage_deletions, moderation.reports,
                moderation.actions, moderation.penalties, moderation.appeals,
                moderation.legal_holds, identity.lookup_audit, identity.lookup_audit_purges cascade`,
    );
    await admin.query(
      `insert into universities (name, email_domain, active) values ('One', 'test.ac.ke', true)`,
    );

    clock = { now: new Date("2026-10-12T10:00:00Z") };
    mailer = new CapturingMailer();
    authStore = new PgAuthStore(authPool);
    auth = new AuthService(
      authStore,
      mailer,
      {
        codeHmacKey: "profile-export-key-profile-export-0123456789",
        codeTtlMinutes: 10,
        maxCodesPerHour: 100,
        maxCodeAttempts: 3,
        sessionTtlDays: 400,
        termsVersion: "t",
      },
      () => clock.now,
    );
    const crypto = new LinkCrypto(`1:${b64()}`, b64());
    identity = new IdentityService(
      auth,
      authStore,
      crypto,
      { ...DEFAULT_IDENTITY_OPTIONS, minAccountAgeDays: 0 },
      () => clock.now,
    );
    actors = new AuthActorResolver(auth, { store: authStore, crypto });
    profile = new ProfileService(auth, authStore, DEFAULT_PROFILE_OPTIONS, () => clock.now);

    const reportStore = new PgReportStore(appPool);
    content = new ContentService(
      new PgContentStore(appPool),
      new MemoryPhotoStore(),
      {
        ...DEFAULT_CONTENT_OPTIONS,
        maxPostsPerHour: 1000,
        maxCommentsPerHour: 1000,
        maxPendingUploads: 100,
      },
      () => clock.now,
    );
    reports = new ReportService(reportStore);
    adminSvc = new AdminService(
      new PgAdminStore(modPool),
      { ...DEFAULT_ADMIN_OPTIONS, blindIndexFor: (id) => crypto.blindIndex(id) },
      () => clock.now,
    );
    account = new AccountService(auth, authStore, new PgLifecycleStore(lifePool, {
      decryptAnonymousProfileId: (enc, accountId) => crypto.decrypt(enc, accountId),
    }), () => clock.now);
  });

  async function student(name: string, opts: { anon?: boolean; course?: string } = {}): Promise<Student> {
    const email = `${name}@test.ac.ke`;
    await auth.requestSignup(email);
    const s = await auth.verifySignup({
      email,
      code: mailer.lastCode(email),
      dateOfBirth: "2004-05-01",
      displayName: `${name[0]!.toUpperCase()}${name.slice(1)} Student`,
      course: opts.course ?? "Computer Science",
      studyYear: 2,
    });
    const out: Student = {
      email,
      token: s.sessionToken,
      accountId: s.account.id,
      knownProfileId: s.profile.id,
      known: await actors.resolve(s.sessionToken, "known"),
    };
    if (opts.anon) {
      const created = await identity.createAnonymous(s.sessionToken, { acknowledged: true });
      out.anonProfileId = created.profile.profileId;
      out.anon = await actors.resolve(s.sessionToken, "anonymous");
    }
    return out;
  }

  const jpeg = (c: string) =>
    sharp({ create: { width: 24, height: 24, channels: 3, background: c } }).jpeg().toBuffer();
  const row = async (id: string) =>
    (await admin.query(`select * from profiles where id = $1`, [id])).rows[0];

  describe("profile correction (G4)", () => {
    it("saves the change, refreshes the handle, and is what other students then see", async () => {
      const a = await student("alice");
      const bob = await student("bob");
      const before = await row(a.knownProfileId);

      const out = await profile.update(a.token, { displayName: "Alice Wanjiru", course: "Law" });
      expect(out).toMatchObject({ displayName: "Alice Wanjiru", course: "Law", studyYear: 2 });
      expect(out.handle).toMatch(/^alice_wanjiru_\d{4}$/);

      const after = await row(a.knownProfileId);
      expect(after.display_name).toBe("Alice Wanjiru");
      expect(after.handle).not.toBe(before.handle);

      const seen = await content.getProfile(bob.known, a.knownProfileId);
      expect(seen).toMatchObject({ displayName: "Alice Wanjiru", course: "Law", handle: after.handle });
      expect(JSON.stringify(seen)).not.toContain("Alice Student");
    });

    it("does not touch the anonymous profile, even when the student has one", async () => {
      const a = await student("alice", { anon: true });
      const anonBefore = await row(a.anonProfileId!);

      await profile.update(a.token, { displayName: "Alice Wanjiru", course: "Law", studyYear: 4 });

      const anonAfter = await row(a.anonProfileId!);
      expect(anonAfter).toEqual(anonBefore);
      expect(anonAfter.display_name).toBeNull();
      expect(anonAfter.course).toBeNull();
    });

    it("refuses at the database even if handed an anonymous profile's id", async () => {
      const a = await student("alice", { anon: true });
      const result = await authStore.updateKnownProfile({
        profileId: a.anonProfileId!,
        now: clock.now,
        set: { displayName: "Alice Wanjiru", course: "Law" },
        maxEdits: 5,
        windowDays: 30,
      });
      expect(result).toBe("not_found");
      expect((await row(a.anonProfileId!)).display_name).toBeNull();
    });

    it("ignores a profile id smuggled into the change, so the session decides whose profile it is", async () => {
      const a = await student("alice");
      const b = await student("bob");

      const smuggled = { displayName: "Alice Wanjiru", profileId: b.knownProfileId };
      await profile.update(a.token, smuggled as never);

      expect((await row(a.knownProfileId)).display_name).toBe("Alice Wanjiru");
      expect((await row(b.knownProfileId)).display_name).toBe("Bob Student");
      expect((await row(b.knownProfileId)).edits_in_window).toBe(0);
    });

    it("never lets one student change another's profile", async () => {
      const a = await student("alice");
      const b = await student("bob");
      await profile.update(b.token, { displayName: "Bob Otieno" });
      expect((await row(a.knownProfileId)).display_name).toBe("Alice Student");
    });

    it("allows 5 real edits in 30 days and then refuses, counting in the database", async () => {
      const a = await student("alice");
      for (const year of [1, 3, 4, 5, 6]) await profile.update(a.token, { studyYear: year });
      expect(await code(profile.update(a.token, { studyYear: 7 }))).toBe("too_many_edits");
      expect((await row(a.knownProfileId)).study_year).toBe(6);

      clock.now = new Date(clock.now.getTime() + 31 * DAY);
      expect(await code(profile.update(a.token, { studyYear: 7 }))).toBe("ok");
      expect((await row(a.knownProfileId)).edits_in_window).toBe(1);
    });

    it("does not count a save that changes nothing", async () => {
      const a = await student("alice");
      for (let i = 0; i < 8; i += 1) {
        await profile.update(a.token, { displayName: "Alice Student", studyYear: 2 });
      }
      expect((await row(a.knownProfileId)).edits_in_window).toBe(0);
    });

    it("cannot be got past by sending edits at the same instant", async () => {
      const a = await student("alice");
      const attempts = [
        { studyYear: 1 }, { studyYear: 3 }, { studyYear: 4 }, { studyYear: 5 }, { studyYear: 6 },
        { studyYear: 7 }, { studyYear: 8 }, { course: "A" }, { course: "B" }, { course: "C" },
      ];
      const results = await Promise.all(attempts.map((p) => code(profile.update(a.token, p))));

      expect(results.filter((r) => r === "ok")).toHaveLength(5);
      expect(results.filter((r) => r === "too_many_edits")).toHaveLength(5);
      expect((await row(a.knownProfileId)).edits_in_window).toBe(5);
    });

    it("works for a read-only account and is refused for a banned one", async () => {
      const a = await student("alice");
      await admin.query(`update accounts set status = 'read_only' where id = $1`, [a.accountId]);
      expect(await code(profile.update(a.token, { course: "Law" }))).toBe("ok");

      await admin.query(`update accounts set status = 'banned' where id = $1`, [a.accountId]);
      expect(await code(profile.update(a.token, { course: "Medicine" }))).toBe("unauthorized");
    });

    it("keeps the handle unique per campus when two students pick the same name", async () => {
      const a = await student("alice");
      const b = await student("bob");
      await profile.update(a.token, { displayName: "Sam Kimani" });
      await profile.update(b.token, { displayName: "Sam Kimani" });

      const h = await admin.query(
        `select handle from profiles where id = any($1) order by handle`,
        [[a.knownProfileId, b.knownProfileId]],
      );
      expect(new Set(h.rows.map((x) => x.handle)).size).toBe(2);
    });
  });

  describe("complete data export (G8)", () => {
    async function richAccount() {
      const a = await student("alice", { anon: true });
      const b = await student("bob");
      const secret = "secret-allegation-written-by-bob-about-alice";

      const up1 = await content.uploadPhoto(a.known, await jpeg("#336699"));
      const withPhoto = await content.createPost(a.known, {
        body: "known post with picture",
        photoIds: [up1.id],
        altTexts: { [up1.id]: "A red bicycle" },
      });
      const unused = await content.uploadPhoto(a.known, await jpeg("#aa0000"));

      const anonPost = await content.createPost(a.anon!, { body: "an anonymous thought", confirmedAnonymous: true });
      const hiddenPost = await content.createPost(a.known, { body: "a post moderators hid" });
      await admin.query(
        `update posts set hidden_at = now(), hidden_reason = 'moderator' where id = $1`,
        [hiddenPost.id],
      );
      const deletedPost = await content.createPost(a.known, { body: "a post she deleted herself" });
      await content.deletePost(a.known, deletedPost.id);

      const bobsPost = await content.createPost(b.known, { body: "bob's post" });
      await content.createComment(a.known, bobsPost.id, "alice comments on bob");
      await content.react(a.known, { postId: bobsPost.id });
      await content.follow(a.known, b.knownProfileId);
      await content.follow(b.known, a.knownProfileId);
      await content.react(b.known, { postId: withPhoto.id });
      await content.createComment(b.known, withPhoto.id, "bob replies");

      await reports.report(b.known, {
        targetKind: "post",
        targetId: withPhoto.id,
        reason: "harassment",
        detail: secret,
      });
      await reports.report(a.known, {
        targetKind: "post",
        targetId: bobsPost.id,
        reason: "hate",
        detail: "alice's own report text",
      });
      await adminSvc.penalize(mod, {
        profileId: a.knownProfileId,
        kind: "warning",
        note: "Repeated insults in comments",
      });
      await admin.query(
        `insert into moderation.appeals (account_id, message, status, created_at, decided_at, decided_by, decision_note)
         values ($1, 'my appeal text', 'denied', now(), now(), 'Wanjiru', 'appeal denied note')`,
        [a.accountId],
      );

      await auth.requestLogin(a.email);
      await auth.verifyLogin(a.email, mailer.lastCode(a.email), "Pixel 7 (work)");

      return { a, b, secret, withPhoto, anonPost, hiddenPost, deletedPost, bobsPost, up1, unused };
    }

    it("includes everything the person is entitled to, across both profiles", async () => {
      const { a, b, withPhoto, anonPost, hiddenPost, up1, unused, bobsPost } = await richAccount();
      const data = await account.exportData(a.token);

      expect(data.schemaVersion).toBe(2);
      expect(data.notice).toMatch(/connects your known profile and your anonymous profile/);
      expect(data.account).toMatchObject({
        email: a.email,
        dateOfBirth: "2004-05-01",
        warningsCounting: 1,
        closedAt: null,
      });

      expect(data.profiles.map((p) => p.kind).sort()).toEqual(["anonymous", "known"]);

      const bodies = data.posts.map((p) => `${p.profile}:${p.body}`).sort();
      expect(bodies).toEqual([
        "anonymous:an anonymous thought",
        "known:a post moderators hid",
        "known:known post with picture",
      ]);
      expect(data.posts.find((p) => p.body === "a post moderators hid")).toMatchObject({
        hidden: true,
        hiddenReason: "moderator",
      });
      expect(data.posts.find((p) => p.body === "known post with picture")?.photos).toEqual([
        expect.objectContaining({ id: up1.id, url: `/photos/${up1.id}`, altText: "A red bicycle" }),
      ]);

      expect(data.comments.map((c) => c.body)).toEqual(["alice comments on bob"]);
      expect(data.reactions).toEqual([
        expect.objectContaining({ profile: "known", on: "post", targetId: bobsPost.id }),
      ]);
      expect(data.following).toEqual([expect.objectContaining({ as: "known" })]);
      expect(data.followers).toEqual(
        expect.arrayContaining([{ profile: "known", count: 1 }, { profile: "anonymous", count: 0 }]),
      );

      expect(data.notifications.map((n) => n.kind).sort()).toEqual(["comment", "follow", "reaction"]);
      const bobHandle = (await admin.query(`select handle from profiles where id = $1`, [b.knownProfileId]))
        .rows[0].handle;
      expect(data.notifications.every((n) => n.fromHandle === bobHandle)).toBe(true);

      expect(data.photos.map((p) => p.id).sort()).toEqual([up1.id, unused.id].sort());
      expect(data.photos.find((p) => p.id === up1.id)?.attachedToPost).toBe(true);
      expect(data.photos.find((p) => p.id === unused.id)?.attachedToPost).toBe(false);
      expect(data.photos.find((p) => p.id === up1.id)?.altText).toBe("A red bicycle");
      expect(data.photos.find((p) => p.id === unused.id)?.altText).toBeNull();

      expect(data.sessions.length).toBeGreaterThanOrEqual(2);
      expect(data.sessions.map((s) => s.deviceLabel)).toContain("Pixel 7 (work)");

      expect(data.moderation.reportsFiled).toEqual([
        expect.objectContaining({
          targetId: bobsPost.id,
          reason: "hate",
          detail: "alice's own report text",
        }),
      ]);
      expect(data.moderation.penalties).toEqual([
        expect.objectContaining({ kind: "warning", reason: "Repeated insults in comments" }),
      ]);
      expect(data.moderation.appeals).toEqual([
        expect.objectContaining({ message: "my appeal text", status: "denied", decisionNote: "appeal denied note" }),
      ]);
      expect(data.moderation.reportsAboutYourContent).toEqual([
        expect.objectContaining({ targetId: withPhoto.id, reason: "harassment", source: "user" }),
      ]);
      expect(anonPost.id).toBeTruthy();
      expect(hiddenPost.id).toBeTruthy();
      expect(data.notIncluded.length).toBeGreaterThanOrEqual(5);
    });

    it("leaves out a post the student deleted themselves", async () => {
      const { a, deletedPost } = await richAccount();
      const data = await account.exportData(a.token);
      expect(JSON.stringify(data)).not.toContain("a post she deleted herself");
      expect(data.posts.every((p) => p.body !== deletedPost.body)).toBe(true);
    });

    it("reveals nothing about who reported, what they wrote, or who moderators are", async () => {
      const { a, b, secret } = await richAccount();
      const data = await account.exportData(a.token);
      const text = JSON.stringify(data);

      const forbidden: [string, string][] = [
        ["the reporter's allegation text", secret],
        ["the reporter's email", b.email],
        ["the reporter's account id", b.accountId],
        ["a moderator's name", "Wanjiru"],
        ["the session token", a.token],
      ];
      for (const [what, needle] of forbidden) {
        expect(text, what).not.toContain(needle);
      }

      const about = data.moderation.reportsAboutYourContent[0]!;
      expect(Object.keys(about).sort()).toEqual(
        ["createdAt", "reason", "source", "status", "targetId", "targetKind"].sort(),
      );
      for (const section of [data.moderation.penalties, data.moderation.actionsOnYourContent]) {
        for (const item of section) {
          expect(Object.keys(item)).not.toContain("moderator");
        }
      }
    });

    it("does not include other people's content, only counts and public handles", async () => {
      const { a } = await richAccount();
      const text = JSON.stringify(await account.exportData(a.token));
      expect(text).not.toContain("bob's post");
      expect(text).not.toContain("bob replies");
      expect(text).not.toContain("Bob Student");
    });

    it("stores only hashes of credentials, so none appear in the export", async () => {
      const { a } = await richAccount();
      const hashes = await admin.query(`select encode(refresh_hash, 'hex') h from sessions`);
      const text = JSON.stringify(await account.exportData(a.token));
      for (const r of hashes.rows) expect(text).not.toContain(r.h);
    });

    it("is available to a read-only account (graduates) and refused once closed", async () => {
      const { a } = await richAccount();
      await admin.query(`update accounts set status = 'read_only' where id = $1`, [a.accountId]);
      expect((await account.exportData(a.token)).account.status).toBe("read_only");

      await admin.query(`update accounts set status = 'closed' where id = $1`, [a.accountId]);
      expect(await code(account.exportData(a.token))).toBe("unauthorized");
    });

    it("is plain JSON that survives a round trip", async () => {
      const { a } = await richAccount();
      const data = await account.exportData(a.token);
      expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    });

    it("is for the caller's own account only", async () => {
      const { a, b } = await richAccount();
      const bobs = await account.exportData(b.token);
      const alices = await account.exportData(a.token);
      expect(bobs.account.email).toBe(b.email);
      expect(alices.account.email).toBe(a.email);
      expect(JSON.stringify(bobs)).not.toContain("known post with picture");
    });
  });

  describe("who can run the export function", () => {
    it("only the lifecycle login can call it", async () => {
      const args = ["00000000-0000-4000-8000-000000000000", []];
      for (const [name, p] of [
        ["app_api", appPool],
        ["moderator", modPool],
        ["auth_service", authPool],
        ["trust_safety", tsPool],
      ] as const) {
        await expect(
          p.query(`select moderation.export_account_records($1, $2::uuid[])`, args),
          name,
        ).rejects.toThrow(/permission denied/);
      }
      await expect(
        lifePool.query(`select moderation.export_account_records($1, $2::uuid[])`, args),
      ).resolves.toBeTruthy();
    });

    it("the lifecycle login still cannot read reporter columns directly", async () => {
      await expect(
        lifePool.query(`select reporter_account_id from moderation.reports`),
      ).rejects.toThrow(/permission denied/);
      await expect(lifePool.query(`select moderator from moderation.actions`)).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});
