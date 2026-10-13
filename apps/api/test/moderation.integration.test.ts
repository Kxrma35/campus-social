import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgAdminStore } from "../src/admin/pgStore.js";
import { AdminService, DEFAULT_ADMIN_OPTIONS } from "../src/admin/service.js";
import type { Moderator } from "../src/admin/store.js";
import { PgLifecycleStore } from "../src/account/pgLifecycleStore.js";
import { runLifecycleSweep } from "../src/account/lifecycleStore.js";
import { hashEmail } from "../src/auth/crypto.js";
import { PgAuthStore } from "../src/auth/pgStore.js";
import { AuthService } from "../src/auth/service.js";
import { PgContentStore } from "../src/content/pgStore.js";
import { ContentService, DEFAULT_CONTENT_OPTIONS } from "../src/content/service.js";
import type { Actor } from "../src/content/types.js";
import { buildSupportInfo } from "../src/moderation/crisis.js";
import { PgReportStore, ReportService } from "../src/moderation/reports.js";
import { CapturingMailer, } from "./helpers/memoryStore.js";
import { MemoryPhotoStore } from "./helpers/memoryContent.js";

const password = process.env.TEST_PG_PASSWORD;
const host = process.env.TEST_PG_HOST ?? "127.0.0.1";
const port = Number(process.env.TEST_PG_PORT ?? 5432);
const database = process.env.TEST_PG_DB ?? "campus_social";

const suite = password ? describe : describe.skip;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function pool(user: string) {
  return new pg.Pool({ host, port, database, user, password, max: 4 });
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
  accountId: string;
  email: string;
  known: Actor;
  anon?: Actor;
  anonBlind?: Buffer;
}

suite("Moderation (PostgreSQL)", () => {
  let admin: pg.Pool;
  let appPool: pg.Pool;
  let modPool: pg.Pool;
  let authPool: pg.Pool;
  let lifePool: pg.Pool;

  let content: ContentService;
  let reports: ReportService;
  let adminSvc: AdminService;
  let adminStore: PgAdminStore;
  let authSvc: AuthService;
  let lifecycle: PgLifecycleStore;
  let mailer: CapturingMailer;
  let clock: { now: Date };
  let uni1: string;
  let uni2: string;
  const mod: Moderator = { id: "m1", name: "Wanjiru" };
  let seq = 0;

  beforeAll(() => {
    admin = pool("postgres");
    appPool = pool("app_api");
    modPool = pool("moderator");
    authPool = pool("auth_service");
    lifePool = pool("account_lifecycle");
  });

  afterAll(async () => {
    await Promise.all([admin, appPool, modPool, authPool, lifePool].map((p) => p?.end()));
  });

  async function student(
    uni: string,
    handle: string,
    opts: { anon?: boolean } = {},
  ): Promise<Student> {
    seq += 1;
    const email = `${handle}${seq}@test.ac.ke`;
    const acc = await admin.query(
      `insert into accounts (university_id, email, date_of_birth, terms_accepted_at, terms_version,
                             email_verified_at, last_reverified_at, reverify_due_at)
       values ($1, $2, '2004-05-01', now(), 't', now(), now(), now() + interval '1 year')
       returning id`,
      [uni, email],
    );
    const accountId: string = acc.rows[0].id;

    const kp = await admin.query(
      `insert into profiles (kind, university_id, handle, display_name)
       values ('known', $1, $2, $3) returning id`,
      [uni, handle, handle.toUpperCase()],
    );
    await admin.query(
      `insert into identity.known_profile_owner (account_id, profile_id) values ($1, $2)`,
      [accountId, kp.rows[0].id],
    );
    const out: Student = {
      accountId,
      email,
      known: { profileId: kp.rows[0].id, kind: "known", canWrite: true },
    };

    if (opts.anon) {
      const ap = await admin.query(
        `insert into profiles (kind, university_id, handle) values ('anonymous', $1, $2) returning id`,
        [uni, `${handle}_anon`],
      );
      const blind = createHash("sha256").update(`blind:${ap.rows[0].id}`).digest();
      await admin.query(
        `insert into identity.anonymous_links (account_id, anon_profile_enc, anon_blind_index)
         values ($1, '\\x01', $2)`,
        [accountId, blind],
      );
      out.anonBlind = blind;
      out.anon = {
        profileId: ap.rows[0].id,
        kind: "anonymous",
        canWrite: true,
        blindIndex: blind,
      };
    }
    return out;
  }

  const session = async (accountId: string) => {
    await admin.query(
      `insert into sessions (account_id, refresh_hash, expires_at)
       values ($1, gen_random_bytes(32), now() + interval '1 day')`,
      [accountId],
    );
  };

  const accountStatus = async (accountId: string) =>
    (await admin.query(`select status from accounts where id = $1`, [accountId])).rows[0].status as string;

  beforeEach(async () => {
    await admin.query(
      `truncate accounts, profiles, email_codes, sessions, banned_emails, universities,
                photo_uploads, notifications, moderation.reports, moderation.actions,
                moderation.penalties, moderation.appeals, moderation.moderators cascade`,
    );
    const u1 = await admin.query(
      `insert into universities (name, email_domain, active) values ('One', 'test.ac.ke', true) returning id`,
    );
    const u2 = await admin.query(
      `insert into universities (name, email_domain, active) values ('Two', 'two.ac.ke', true) returning id`,
    );
    uni1 = u1.rows[0].id;
    uni2 = u2.rows[0].id;

    clock = { now: new Date("2026-10-12T10:00:00Z") };
    mailer = new CapturingMailer();

    const reportStore = new PgReportStore(appPool);
    content = new ContentService(
      new PgContentStore(appPool),
      new MemoryPhotoStore(),
      { ...DEFAULT_CONTENT_OPTIONS, maxPostsPerHour: 1000, maxCommentsPerHour: 1000 },
      () => clock.now,
      {
        flagForReview: (kind, id) => reportStore.fileAutoFlag(kind, id),
        support: buildSupportInfo([{ name: "Campus counselling", contact: "ext 100" }]),
      },
    );
    reports = new ReportService(reportStore);

    adminStore = new PgAdminStore(modPool);
    adminSvc = new AdminService(
      adminStore,
      {
        ...DEFAULT_ADMIN_OPTIONS,
        blindIndexFor: (id) => createHash("sha256").update(`blind:${id}`).digest(),
      },
      () => clock.now,
    );

    authSvc = new AuthService(
      new PgAuthStore(authPool),
      mailer,
      {
        codeHmacKey: "moderation-key-moderation-key-0123456789",
        codeTtlMinutes: 10,
        maxCodesPerHour: 50,
        maxCodeAttempts: 3,
        sessionTtlDays: 30,
        termsVersion: "t",
      },
      () => clock.now,
    );
    lifecycle = new PgLifecycleStore(lifePool);
  });

  describe("reporting", () => {
    it("hides a post once three different students have reported it", async () => {
      const author = await student(uni1, "author");
      const r1 = await student(uni1, "r1");
      const r2 = await student(uni1, "r2");
      const r3 = await student(uni1, "r3");
      const post = await content.createPost(author.known, { body: "a nasty post" });

      const file = (s: Student) =>
        reports.report(s.known, { targetKind: "post", targetId: post.id, reason: "harassment" });

      await file(r1);
      await file(r2);
      expect((await content.getPost(r1.known, post.id)).id).toBe(post.id);

      await file(r3);
      expect(await code(content.getPost(r1.known, post.id))).toBe("not_found");
      expect((await content.campusFeed(r1.known, {})).items).toHaveLength(0);

      const row = await admin.query(`select hidden_reason from posts where id = $1`, [post.id]);
      expect(row.rows[0].hidden_reason).toBe("auto_reports");
    });

    it("counts one person once, even when reporting from both of their profiles", async () => {
      const author = await student(uni1, "author");
      const twoProfiles = await student(uni1, "dual", { anon: true });
      const other = await student(uni1, "other");
      const post = await content.createPost(author.known, { body: "contested" });

      const as = (a: Actor) =>
        reports.report(a, { targetKind: "post", targetId: post.id, reason: "hate" });

      await as(twoProfiles.known);
      await as(twoProfiles.anon!);
      await as(other.known);

      const rows = await admin.query(
        `select count(*)::int total, count(distinct reporter_account_id)::int people
           from moderation.reports where target_id = $1`,
        [post.id],
      );
      expect(rows.rows[0]).toEqual({ total: 2, people: 2 });
      expect((await content.getPost(other.known, post.id)).id).toBe(post.id);
    });

    it("ignores repeat reports from the same person and answers the same way", async () => {
      const author = await student(uni1, "author");
      const reporter = await student(uni1, "rep");
      const post = await content.createPost(author.known, { body: "x" });
      const file = () =>
        reports.report(reporter.known, { targetKind: "post", targetId: post.id, reason: "other" });

      const first = await file();
      const second = await file();
      expect(first).toEqual(second);
      const n = await admin.query(`select count(*)::int n from moderation.reports`);
      expect(n.rows[0].n).toBe(1);
    });

    it("auto-hides comments the same way", async () => {
      const author = await student(uni1, "author");
      const commenter = await student(uni1, "cm");
      const post = await content.createPost(author.known, { body: "thread" });
      const comment = await content.createComment(commenter.known, post.id, "rude comment");

      for (const n of ["a", "b", "c"]) {
        const s = await student(uni1, `rep${n}`);
        await reports.report(s.known, {
          targetKind: "comment",
          targetId: comment.id,
          reason: "harassment",
        });
      }
      const list = await content.listComments(author.known, post.id, {});
      expect(list.items).toHaveLength(0);
    });

    it("refuses to report your own content, other campuses, and missing targets", async () => {
      const author = await student(uni1, "author");
      const outsider = await student(uni2, "outsider");
      const post = await content.createPost(author.known, { body: "mine" });

      expect(
        await code(
          reports.report(author.known, { targetKind: "post", targetId: post.id, reason: "other" }),
        ),
      ).toBe("own_content");
      expect(
        await code(
          reports.report(outsider.known, { targetKind: "post", targetId: post.id, reason: "other" }),
        ),
      ).toBe("not_found");
      expect(
        await code(
          reports.report(author.known, {
            targetKind: "post",
            targetId: "00000000-0000-4000-8000-000000000000",
            reason: "other",
          }),
        ),
      ).toBe("not_found");
    });

    it("marks threats, self-harm and intimate-image reports urgent", async () => {
      const author = await student(uni1, "author");
      const r = await student(uni1, "rep");
      const p1 = await content.createPost(author.known, { body: "one" });
      const p2 = await content.createPost(author.known, { body: "two" });
      await reports.report(r.known, { targetKind: "post", targetId: p1.id, reason: "threat" });
      await reports.report(r.known, { targetKind: "post", targetId: p2.id, reason: "hate" });

      const urgent = await admin.query(
        `select target_id, urgent from moderation.reports order by created_at`,
      );
      expect(urgent.rows.map((x) => x.urgent)).toEqual([true, false]);
    });

    it("rate limits a person's reports across profiles", async () => {
      const author = await student(uni1, "author");
      const reporter = await student(uni1, "spammy");
      for (let i = 0; i < 30; i += 1) {
        const p = await content.createPost(author.known, { body: `p${i}` });
        await reports.report(reporter.known, { targetKind: "post", targetId: p.id, reason: "other" });
      }
      const extra = await content.createPost(author.known, { body: "one more" });
      expect(
        await code(
          reports.report(reporter.known, { targetKind: "post", targetId: extra.id, reason: "other" }),
        ),
      ).toBe("rate_limited");
    });

    it("lets a self-harm phrase flag a post for moderators without a reporter", async () => {
      const author = await student(uni1, "author");
      const post = await content.createPost(author.known, { body: "I want to die" });
      expect(post.support?.resources[0]?.name).toBe("Campus counselling");

      const r = await admin.query(
        `select source, urgent, reason, reporter_account_id from moderation.reports where target_id = $1`,
        [post.id],
      );
      expect(r.rows).toEqual([
        { source: "auto", urgent: true, reason: "self_harm", reporter_account_id: null },
      ]);
      const other = await student(uni1, "other");
      expect((await content.getPost(other.known, post.id)).id).toBe(post.id);
    });

    it("does not duplicate automatic flags", async () => {
      const author = await student(uni1, "author");
      const post = await content.createPost(author.known, { body: "I want to die" });
      await new PgReportStore(appPool).fileAutoFlag("post", post.id);
      const n = await admin.query(`select count(*)::int n from moderation.reports`);
      expect(n.rows[0].n).toBe(1);
    });
  });

  describe("who can see and do what", () => {
    it("moderators cannot read who reported, who owns a profile, or any account", async () => {
      const author = await student(uni1, "author");
      const r = await student(uni1, "rep");
      const post = await content.createPost(author.known, { body: "x" });
      await reports.report(r.known, { targetKind: "post", targetId: post.id, reason: "other" });

      await expect(modPool.query(`select reporter_account_id from moderation.reports`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(modPool.query(`select * from moderation.reports`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(modPool.query(`select * from accounts`)).rejects.toThrow(/permission denied/);
      await expect(modPool.query(`select * from identity.known_profile_owner`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(modPool.query(`select account_id from moderation.penalties`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(modPool.query(`select account_id from moderation.appeals`)).rejects.toThrow(
        /permission denied/,
      );

      const ok = await modPool.query(
        `select id, reason, status from moderation.reports where target_id = $1`,
        [post.id],
      );
      expect(ok.rowCount).toBe(1);
    });

    it("moderators cannot call the unmask function or the core penalty function", async () => {
      await expect(
        modPool.query(
          `select identity.unmask_profile('\\x01', 'x', 'court_order', 'long enough reason text')`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        modPool.query(
          `select identity.apply_penalty_to_account(gen_random_uuid(), 'ban', null, null, '{}')`,
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it("app_api can only file reports through the function", async () => {
      await expect(
        appPool.query(
          `insert into moderation.reports (target_kind, target_id, reason, reporter_account_id, source)
           values ('post', gen_random_uuid(), 'other', gen_random_uuid(), 'user')`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(appPool.query(`select * from moderation.reports`)).rejects.toThrow(
        /permission denied/,
      );
    });

    it("app_api can only raise self-harm flags, on posts and comments", async () => {
      const author = await student(uni1, "author");
      const post = await content.createPost(author.known, { body: "hello" });
      await expect(
        appPool.query(`select moderation.file_auto_flag('post', $1, 'hate')`, [post.id]),
      ).rejects.toThrow(/unsupported automatic flag/);
      await expect(
        appPool.query(`select moderation.file_auto_flag('profile', $1, 'self_harm')`, [
          author.known.profileId,
        ]),
      ).rejects.toThrow(/unsupported automatic flag/);
    });

    it("the moderator token table only holds hashes", async () => {
      await admin.query(
        `insert into moderation.moderators (name, token_hash) values ('Wanjiru', $1)`,
        [createHash("sha256").update("mod_secret").digest()],
      );
      const found = await adminStore.findModeratorByTokenHash(
        createHash("sha256").update("mod_secret").digest(),
      );
      expect(found?.name).toBe("Wanjiru");
      expect(await adminStore.findModeratorByTokenHash(Buffer.alloc(32))).toBeNull();

      await admin.query(`update moderation.moderators set active = false`);
      expect(
        await adminStore.findModeratorByTokenHash(createHash("sha256").update("mod_secret").digest()),
      ).toBeNull();
    });
  });

  describe("moderator queue and resolution", () => {
    it("orders urgent first, then oldest, and shows the content and reasons", async () => {
      const author = await student(uni1, "author");
      const r1 = await student(uni1, "r1");
      const r2 = await student(uni1, "r2");

      clock.now = new Date("2026-10-12T08:00:00Z");
      const old = await content.createPost(author.known, { body: "old minor" });
      await reports.report(r1.known, { targetKind: "post", targetId: old.id, reason: "other" });
      const urgent = await content.createPost(author.known, { body: "scary" });
      await reports.report(r1.known, { targetKind: "post", targetId: urgent.id, reason: "threat" });
      await reports.report(r2.known, { targetKind: "post", targetId: urgent.id, reason: "harassment" });

      const { items } = await adminSvc.queue({});
      expect(items.map((i) => i.targetId)).toEqual([urgent.id, old.id]);
      expect(items[0]).toMatchObject({
        urgent: true,
        userReports: 2,
        reasons: { threat: 1, harassment: 1 },
      });
      expect(items[0]?.preview?.text).toBe("scary");
      expect(items[0]?.preview?.authorHandle).toBe("author");
      expect(JSON.stringify(items)).not.toMatch(/account|reporter/i);
    });

    it("upholding hides content and closes reports as actioned", async () => {
      const author = await student(uni1, "author");
      const r = await student(uni1, "rep");
      const post = await content.createPost(author.known, { body: "bad" });
      await reports.report(r.known, { targetKind: "post", targetId: post.id, reason: "harassment" });

      const out = await adminSvc.resolve(mod, "post", post.id, "uphold", "confirmed");
      expect(out).toMatchObject({ reportsClosed: 1, contentHidden: true });

      expect(await code(content.getPost(r.known, post.id))).toBe("not_found");
      expect((await adminSvc.queue({})).items).toHaveLength(0);

      const rep = await admin.query(`select status, resolved_by from moderation.reports`);
      expect(rep.rows[0]).toMatchObject({ status: "actioned", resolved_by: "Wanjiru" });
      const act = await admin.query(`select kind, moderator from moderation.actions`);
      expect(act.rows[0]).toMatchObject({ kind: "hide_content", moderator: "Wanjiru" });
    });

    it("dismissing restores content that was hidden only by report volume", async () => {
      const author = await student(uni1, "author");
      const post = await content.createPost(author.known, { body: "innocent" });
      const rs: Student[] = [];
      for (const n of ["a", "b", "c"]) {
        const s = await student(uni1, `r${n}`);
        rs.push(s);
        await reports.report(s.known, { targetKind: "post", targetId: post.id, reason: "other" });
      }
      expect(await code(content.getPost(author.known, post.id))).toBe("not_found");

      const out = await adminSvc.resolve(mod, "post", post.id, "dismiss", "no violation");
      expect(out).toMatchObject({ contentRestored: true, contentHidden: false });
      expect((await content.getPost(author.known, post.id)).id).toBe(post.id);

      const rep = await admin.query(`select distinct status from moderation.reports`);
      expect(rep.rows).toEqual([{ status: "dismissed" }]);
    });

    it("dismissing does not unhide content a moderator hid earlier", async () => {
      const author = await student(uni1, "author");
      const r = await student(uni1, "rep");
      const post = await content.createPost(author.known, { body: "bad" });
      await reports.report(r.known, { targetKind: "post", targetId: post.id, reason: "hate" });
      await adminSvc.resolve(mod, "post", post.id, "uphold", null);

      await adminSvc.resolve(mod, "post", post.id, "dismiss", "second look");
      expect(await code(content.getPost(r.known, post.id))).toBe("not_found");
    });

    it("shows full detail for a target, including photos and history", async () => {
      const author = await student(uni1, "author");
      const r = await student(uni1, "rep");
      const post = await content.createPost(author.known, { body: "detail me" });
      await reports.report(r.known, {
        targetKind: "post",
        targetId: post.id,
        reason: "private_info",
        detail: "shares my number",
      });
      await adminSvc.resolve(mod, "post", post.id, "uphold", "removed");

      const d = await adminSvc.target("post", post.id);
      expect(d.preview).toMatchObject({ text: "detail me", hidden: true, hiddenReason: "moderator" });
      expect(d.reports[0]).toMatchObject({
        reason: "private_info",
        detail: "shares my number",
        status: "actioned",
      });
      expect(d.actions.map((a) => a.kind)).toEqual(["hide_content"]);
      expect(await code(adminSvc.target("post", "00000000-0000-4000-8000-000000000000"))).toBe(
        "not_found",
      );
    });
  });

  describe("penalties", () => {
    it("warns a known profile: strike count rises and the action is logged", async () => {
      const bad = await student(uni1, "bad");
      await adminSvc.penalize(mod, {
        profileId: bad.known.profileId,
        kind: "warning",
        note: "Repeated insults in comments",
      });

      const acc = await admin.query(`select strike_count, status from accounts where id = $1`, [
        bad.accountId,
      ]);
      expect(acc.rows[0]).toEqual({ strike_count: 1, status: "active" });
      const pen = await admin.query(`select kind from moderation.penalties where account_id = $1`, [
        bad.accountId,
      ]);
      expect(pen.rows).toEqual([{ kind: "warning" }]);
    });

    it("suspends: status changes, sessions end, and the sweep lifts it after the end date", async () => {
      const bad = await student(uni1, "bad");
      await session(bad.accountId);

      await adminSvc.penalize(mod, {
        profileId: bad.known.profileId,
        kind: "suspension",
        endsAt: new Date(clock.now.getTime() + 3 * DAY),
        note: "Targeted harassment of a classmate",
      });
      expect(await accountStatus(bad.accountId)).toBe("suspended");
      const sess = await admin.query(
        `select count(*)::int n from sessions where account_id = $1 and revoked_at is null`,
        [bad.accountId],
      );
      expect(sess.rows[0].n).toBe(0);

      const early = await runLifecycleSweep(
        lifecycle,
        { reverifyGraceDays: 30, purgeAfterDays: 30 },
        new Date(clock.now.getTime() + DAY),
      );
      expect(early.liftedSuspensions).toBe(0);
      expect(await accountStatus(bad.accountId)).toBe("suspended");

      await admin.query(
        `update moderation.penalties set ends_at = now() - interval '1 minute' where account_id = $1`,
        [bad.accountId],
      );
      const late = await runLifecycleSweep(
        lifecycle,
        { reverifyGraceDays: 30, purgeAfterDays: 30 },
        new Date(),
      );
      expect(late.liftedSuspensions).toBe(1);
      expect(await accountStatus(bad.accountId)).toBe("active");
    });

    it("a ban hides both profiles' content, blocks the email and ends sessions", async () => {
      const bad = await student(uni1, "bad", { anon: true });
      const other = await student(uni1, "other");
      await session(bad.accountId);
      const known = await content.createPost(bad.known, { body: "known post" });
      const anon = await content.createPost(bad.anon!, { body: "anon post", confirmedAnonymous: true });

      await adminSvc.penalize(mod, {
        profileId: bad.anon!.profileId,
        kind: "ban",
        note: "Posted credible threats repeatedly",
      });

      expect(await accountStatus(bad.accountId)).toBe("banned");
      expect(await new PgAuthStore(authPool).isEmailBanned(hashEmail(bad.email))).toBe(true);

      expect(await code(content.getPost(other.known, known.id))).toBe("not_found");
      expect(await code(content.getPost(other.known, anon.id))).toBe("not_found");
      expect(await code(content.getProfile(other.known, bad.known.profileId))).toBe("not_found");
      expect(await code(content.getProfile(other.known, bad.anon!.profileId))).toBe("not_found");
      expect((await content.campusFeed(other.known, {})).items).toHaveLength(0);

      const live = await admin.query(
        `select count(*)::int n from sessions where account_id = $1 and revoked_at is null`,
        [bad.accountId],
      );
      expect(live.rows[0].n).toBe(0);

      const row = await admin.query(`select hidden_reason, deleted_at from posts where id = $1`, [
        known.id,
      ]);
      expect(row.rows[0]).toEqual({ hidden_reason: "account_banned", deleted_at: null });
    });

    it("a ban applied from the known profile also works and blocks sign-up", async () => {
      const bad = await student(uni1, "bad");
      await adminSvc.penalize(mod, {
        profileId: bad.known.profileId,
        kind: "ban",
        note: "Sharing intimate images without consent",
      });
      expect(await accountStatus(bad.accountId)).toBe("banned");

      const before = mailer.codes.length;
      await expect(authSvc.requestSignup(bad.email.replace("test.ac.ke", "test.ac.ke"))).resolves
        .toBeUndefined();
      expect(mailer.codes).toHaveLength(before);
    });
  });

  describe("appeals", () => {
    async function bannedWithContent() {
      const bad = await student(uni1, "bad");
      const post = await content.createPost(bad.known, { body: "my post" });
      await adminSvc.penalize(mod, {
        profileId: bad.known.profileId,
        kind: "ban",
        note: "Posted something that looked like a threat",
      });
      return { bad, post };
    }

    it("lets a banned student appeal once, by email code", async () => {
      const { bad } = await bannedWithContent();

      await authSvc.requestAppeal(bad.email);
      await authSvc.submitAppeal(bad.email, mailer.lastCode(bad.email), "I was quoting a song lyric.");

      const rows = await admin.query(`select message, status from moderation.appeals`);
      expect(rows.rows).toEqual([{ message: "I was quoting a song lyric.", status: "open" }]);

      await authSvc.requestAppeal(bad.email);
      expect(
        await code(authSvc.submitAppeal(bad.email, mailer.lastCode(bad.email), "Second try")),
      ).toBe("already_appealed");
    });

    it("an upheld appeal restores the account, profile and content", async () => {
      const { bad, post } = await bannedWithContent();
      await authSvc.requestAppeal(bad.email);
      await authSvc.submitAppeal(bad.email, mailer.lastCode(bad.email), "It was a misunderstanding.");

      const [appeal] = (await adminSvc.appeals("open")).items;
      expect(appeal?.message).toBe("It was a misunderstanding.");
      expect(JSON.stringify(appeal)).not.toMatch(/account/i);

      await adminSvc.decideAppeal(mod, appeal!.id, "upheld", "Context shows it was a lyric quote");

      expect(await accountStatus(bad.accountId)).toBe("active");
      expect(await new PgAuthStore(authPool).isEmailBanned(hashEmail(bad.email))).toBe(false);

      const other = await student(uni1, "other");
      expect((await content.getPost(other.known, post.id)).id).toBe(post.id);
      expect((await content.getProfile(other.known, bad.known.profileId)).handle).toBe("bad");

      const done = await admin.query(`select status, decided_by from moderation.appeals`);
      expect(done.rows[0]).toEqual({ status: "upheld", decided_by: "Wanjiru" });
    });

    it("a denied appeal leaves the ban in place and cannot be decided twice", async () => {
      const { bad } = await bannedWithContent();
      await authSvc.requestAppeal(bad.email);
      await authSvc.submitAppeal(bad.email, mailer.lastCode(bad.email), "Please reconsider.");
      const [appeal] = (await adminSvc.appeals("open")).items;

      await adminSvc.decideAppeal(mod, appeal!.id, "denied", "Threat was explicit and repeated");
      expect(await accountStatus(bad.accountId)).toBe("banned");
      expect(
        await code(adminSvc.decideAppeal(mod, appeal!.id, "upheld", "Changed my mind later on")),
      ).toBe("not_found");
      expect(await accountStatus(bad.accountId)).toBe("banned");
    });

    it("does not let content deleted by the student themselves come back", async () => {
      const bad = await student(uni1, "bad");
      const mine = await content.createPost(bad.known, { body: "I deleted this" });
      await content.deletePost(bad.known, mine.id);
      await adminSvc.penalize(mod, {
        profileId: bad.known.profileId,
        kind: "ban",
        note: "Posted something that looked like a threat",
      });
      await authSvc.requestAppeal(bad.email);
      await authSvc.submitAppeal(bad.email, mailer.lastCode(bad.email), "A misunderstanding.");
      const [appeal] = (await adminSvc.appeals("open")).items;
      await adminSvc.decideAppeal(mod, appeal!.id, "upheld", "Context shows it was a quote");

      const other = await student(uni1, "other");
      expect(await code(content.getPost(other.known, mine.id))).toBe("not_found");
    });
  });
});
