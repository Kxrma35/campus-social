import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgAdminStore } from "../src/admin/pgStore.js";
import { AdminService, DEFAULT_ADMIN_OPTIONS } from "../src/admin/service.js";
import type { Moderator } from "../src/admin/store.js";
import { PgLifecycleStore } from "../src/account/pgLifecycleStore.js";
import { runLifecycleSweep } from "../src/account/lifecycleStore.js";
import { AccountService } from "../src/account/service.js";
import { PgAuthStore } from "../src/auth/pgStore.js";
import { AuthService } from "../src/auth/service.js";
import { AuthActorResolver } from "../src/content/actor.js";
import { PgContentStore } from "../src/content/pgStore.js";
import { ContentService, DEFAULT_CONTENT_OPTIONS } from "../src/content/service.js";
import type { Actor } from "../src/content/types.js";
import { BlindIndexer, LinkCrypto } from "../src/identity/linkCrypto.js";
import { DEFAULT_IDENTITY_OPTIONS, IdentityService } from "../src/identity/service.js";
import { PgReportStore, ReportService } from "../src/moderation/reports.js";
import { CapturingMailer } from "./helpers/memoryStore.js";
import { MemoryPhotoStore } from "./helpers/memoryContent.js";

const password = process.env.TEST_PG_PASSWORD;
const host = process.env.TEST_PG_HOST ?? "127.0.0.1";
const port = Number(process.env.TEST_PG_PORT ?? 5432);
const database = process.env.TEST_PG_DB ?? "campus_social";

const suite = password ? describe : describe.skip;
const DAY = 24 * 60 * 60 * 1000;
const SWEEP = { reverifyGraceDays: 30, purgeAfterDays: 30 };
const b64 = () => randomBytes(32).toString("base64");

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
  email: string;
  token: string;
  accountId: string;
  knownProfileId: string;
}

suite("Anonymous profiles (PostgreSQL)", () => {
  let admin: pg.Pool;
  let authPool: pg.Pool;
  let appPool: pg.Pool;
  let modPool: pg.Pool;
  let lifePool: pg.Pool;
  let tsPool: pg.Pool;

  let encKeys: string;
  let blindKey: string;
  let crypto: LinkCrypto;
  let mailer: CapturingMailer;
  let clock: { now: Date };
  let authStore: PgAuthStore;
  let auth: AuthService;
  let identity: IdentityService;
  let actors: AuthActorResolver;
  let content: ContentService;
  let reports: ReportService;
  let adminSvc: AdminService;
  let lifecycle: PgLifecycleStore;
  let account: AccountService;
  let uni: string;
  const mod: Moderator = { id: "m1", name: "Wanjiru" };

  beforeAll(() => {
    admin = pool("postgres");
    authPool = pool("auth_service");
    appPool = pool("app_api");
    modPool = pool("moderator");
    lifePool = pool("account_lifecycle");
    tsPool = pool("trust_safety");
  });

  afterAll(async () => {
    await Promise.all(
      [admin, authPool, appPool, modPool, lifePool, tsPool].map((p) => p?.end()),
    );
  });

  beforeEach(async () => {
    await admin.query(
      `truncate accounts, profiles, email_codes, sessions, banned_emails, universities,
                photo_uploads, notifications, moderation.reports, moderation.actions,
                moderation.penalties, moderation.appeals, moderation.moderators,
                identity.lookup_audit cascade`,
    );
    const u = await admin.query(
      `insert into universities (name, email_domain, active) values ('One', 'test.ac.ke', true) returning id`,
    );
    uni = u.rows[0].id;

    encKeys = `1:${b64()}`;
    blindKey = b64();
    crypto = new LinkCrypto(encKeys, blindKey);
    clock = { now: new Date("2026-10-12T10:17:42Z") };
    mailer = new CapturingMailer();

    authStore = new PgAuthStore(authPool);
    auth = new AuthService(
      authStore,
      mailer,
      {
        codeHmacKey: "anonymous-key-anonymous-key-0123456789",
        codeTtlMinutes: 10,
        maxCodesPerHour: 100,
        maxCodeAttempts: 3,
        sessionTtlDays: 400,
        termsVersion: "t",
      },
      () => clock.now,
    );
    identity = new IdentityService(
      auth,
      authStore,
      crypto,
      { ...DEFAULT_IDENTITY_OPTIONS, minAccountAgeDays: 0 },
      () => clock.now,
    );
    actors = new AuthActorResolver(auth, { store: authStore, crypto });

    const reportStore = new PgReportStore(appPool);
    content = new ContentService(
      new PgContentStore(appPool),
      new MemoryPhotoStore(),
      { ...DEFAULT_CONTENT_OPTIONS, maxPostsPerHour: 1000, maxCommentsPerHour: 1000 },
      () => clock.now,
      { flagForReview: (kind, id) => reportStore.fileAutoFlag(kind, id) },
    );
    reports = new ReportService(reportStore);

    const indexer = new BlindIndexer(blindKey);
    adminSvc = new AdminService(
      new PgAdminStore(modPool),
      { ...DEFAULT_ADMIN_OPTIONS, blindIndexFor: (id) => indexer.indexFor(id) },
      () => clock.now,
    );

    lifecycle = new PgLifecycleStore(lifePool, {
      decryptAnonymousProfileId: (enc, accountId) => crypto.decrypt(enc, accountId),
    });
    account = new AccountService(auth, authStore, lifecycle, () => clock.now);
  });

  async function student(handleName: string): Promise<Student> {
    const email = `${handleName}@test.ac.ke`;
    await auth.requestSignup(email);
    const s = await auth.verifySignup({
      email,
      code: mailer.lastCode(email),
      dateOfBirth: "2004-05-01",
      displayName: `${handleName[0]!.toUpperCase()}${handleName.slice(1)} Student`,
    });
    return {
      email,
      token: s.sessionToken,
      accountId: s.account.id,
      knownProfileId: s.profile.id,
    };
  }

  async function withAnonymous(handleName: string) {
    const s = await student(handleName);
    const created = await identity.createAnonymous(s.token, { acknowledged: true });
    const anon = await actors.resolve(s.token, "anonymous");
    const known = await actors.resolve(s.token, "known");
    return { ...s, anonProfileId: created.profile.profileId, anon, known, handle: created.profile.handle };
  }

  const status = async (accountId: string) =>
    (await admin.query(`select status from accounts where id = $1`, [accountId])).rows[0]
      .status as string;

  const sweep = () => runLifecycleSweep(lifecycle, SWEEP, clock.now);

  describe("creation and storage", () => {
    it("stores an encrypted link, a matching blind index and a detached profile", async () => {
      const s = await student("alice");
      const out = await identity.createAnonymous(s.token, { acknowledged: true });
      const id = out.profile.profileId;

      const link = await admin.query(
        `select anon_profile_enc, anon_blind_index, key_version
           from identity.anonymous_links where account_id = $1`,
        [s.accountId],
      );
      const row = link.rows[0];
      expect(row.key_version).toBe(1);
      expect(row.anon_profile_enc.toString("latin1")).not.toContain(id);
      expect(crypto.decrypt(row.anon_profile_enc, s.accountId)).toBe(id);
      expect(row.anon_blind_index.equals(crypto.blindIndex(id))).toBe(true);

      const p = await admin.query(
        `select kind, display_name, course, study_year, avatar_key, handle,
                (created_at = date_trunc('day', created_at at time zone 'UTC') at time zone 'UTC') as midnight
           from profiles where id = $1`,
        [id],
      );
      expect(p.rows[0]).toMatchObject({
        kind: "anonymous",
        display_name: null,
        course: null,
        study_year: null,
        midnight: true,
      });
      expect(p.rows[0].handle).toMatch(/^[a-z]+_[a-z]+_\d{4}$/);
      expect(p.rows[0].avatar_key).toMatch(/^gen:/);
    });

    it("allows exactly one anonymous profile per account, atomically", async () => {
      const s = await student("alice");
      await identity.createAnonymous(s.token, { acknowledged: true });
      expect(await code(identity.createAnonymous(s.token, { acknowledged: true }))).toBe(
        "already_exists",
      );

      const n = await admin.query(`select count(*)::int n from profiles where kind = 'anonymous'`);
      expect(n.rows[0].n).toBe(1);
    });

    it("keeps new accounts locked out until the configured age", async () => {
      const strict = new IdentityService(
        auth,
        authStore,
        crypto,
        { minAccountAgeDays: 3 },
        () => clock.now,
      );
      const s = await student("alice");
      expect(await code(strict.createAnonymous(s.token, { acknowledged: true }))).toBe(
        "anonymous_locked",
      );
      clock.now = new Date(clock.now.getTime() + 4 * DAY);
      expect(await code(strict.createAnonymous(s.token, { acknowledged: true }))).toBe("ok");
    });

    it("stays locked while the account has a warning", async () => {
      const s = await student("alice");
      await adminSvc.penalize(mod, {
        profileId: s.knownProfileId,
        kind: "warning",
        note: "Repeated insults in comments",
      });
      expect(await code(identity.createAnonymous(s.token, { acknowledged: true }))).toBe(
        "anonymous_locked",
      );
    });

    it("rotates the encryption key without breaking existing links", async () => {
      const a = await withAnonymous("alice");

      const rotatedKeys = `${encKeys},2:${b64()}`;
      crypto = new LinkCrypto(rotatedKeys, blindKey);
      identity = new IdentityService(
        auth,
        authStore,
        crypto,
        { ...DEFAULT_IDENTITY_OPTIONS, minAccountAgeDays: 0 },
        () => clock.now,
      );
      actors = new AuthActorResolver(auth, { store: authStore, crypto });

      expect((await actors.resolve(a.token, "anonymous")).profileId).toBe(a.anonProfileId);

      const b = await student("bob");
      await identity.createAnonymous(b.token, { acknowledged: true });
      const v = await admin.query(
        `select key_version from identity.anonymous_links where account_id = $1`,
        [b.accountId],
      );
      expect(v.rows[0].key_version).toBe(2);
    });
  });

  describe("acting as the anonymous profile", () => {
    it("posts as anonymous and stores nothing that points at the account", async () => {
      const a = await withAnonymous("alice");
      const bob = await student("bob");
      const bobActor = await actors.resolve(bob.token, "known");

      const post = await content.createPost(a.anon, { body: "a quiet thought", confirmedAnonymous: true });
      expect(post.author).toMatchObject({ kind: "anonymous", profileId: a.anonProfileId, displayName: null });

      const stored = await admin.query(`select author_profile_id from posts where id = $1`, [post.id]);
      expect(stored.rows[0].author_profile_id).toBe(a.anonProfileId);
      expect(stored.rows[0].author_profile_id).not.toBe(a.knownProfileId);

      const feed = JSON.stringify(await content.campusFeed(bobActor, {}));
      expect(feed).toContain("a quiet thought");
      for (const secret of [a.accountId, a.knownProfileId, a.email, "Alice Student"]) {
        expect(feed).not.toContain(secret);
      }
    });

    it("rounds anonymous times to the hour while known posts keep exact times", async () => {
      const a = await withAnonymous("alice");
      const anon = await content.createPost(a.anon, { body: "x", confirmedAnonymous: true });
      const known = await content.createPost(a.known, { body: "y" });
      expect(anon.createdAt).toBe("2026-10-12T10:00:00.000Z");
      expect(known.createdAt).toBe("2026-10-12T10:17:42.000Z");
    });

    it("keeps the two profiles' follows and notifications separate", async () => {
      const a = await withAnonymous("alice");
      const bob = await student("bob");
      const bobActor = await actors.resolve(bob.token, "known");

      await content.follow(bobActor, a.anonProfileId);
      expect((await content.notifications(a.anon, {})).items).toHaveLength(1);
      expect((await content.notifications(a.known, {})).items).toHaveLength(0);
      expect((await content.myFollowers(a.known, {})).items).toHaveLength(0);
      expect((await content.getProfile(bobActor, a.anonProfileId)).followerCount).toBe(1);
      expect((await content.getProfile(bobActor, a.knownProfileId)).followerCount).toBe(0);
    });

    it("never lets a tampered or swapped link resolve to someone's profile", async () => {
      const a = await withAnonymous("alice");
      const b = await withAnonymous("bob");

      const rows = await admin.query(
        `select account_id, anon_profile_enc from identity.anonymous_links`,
      );
      const byAccount = new Map(rows.rows.map((r) => [r.account_id, r.anon_profile_enc as Buffer]));
      await admin.query(
        `update identity.anonymous_links set anon_profile_enc = $2 where account_id = $1`,
        [a.accountId, byAccount.get(b.accountId)],
      );

      await expect(actors.resolve(a.token, "anonymous")).rejects.toThrow();

      await admin.query(
        `update identity.anonymous_links set anon_profile_enc = $2 where account_id = $1`,
        [a.accountId, byAccount.get(a.accountId)],
      );
      expect((await actors.resolve(a.token, "anonymous")).profileId).toBe(a.anonProfileId);
    });
  });

  describe("reports and penalties", () => {
    it("ties an anonymous report to the right person inside the database", async () => {
      const a = await withAnonymous("alice");
      const author = await student("carol");
      const authorActor = await actors.resolve(author.token, "known");
      const post = await content.createPost(authorActor, { body: "reportable" });

      await reports.report(a.anon, { targetKind: "post", targetId: post.id, reason: "harassment" });
      const row = await admin.query(
        `select reporter_account_id from moderation.reports where target_id = $1`,
        [post.id],
      );
      expect(row.rows[0].reporter_account_id).toBe(a.accountId);

      await reports.report(a.known, { targetKind: "post", targetId: post.id, reason: "harassment" });
      const n = await admin.query(`select count(*)::int n from moderation.reports where target_id = $1`, [post.id]);
      expect(n.rows[0].n).toBe(1);
    });

    it("refuses an anonymous report with a forged blind index", async () => {
      const a = await withAnonymous("alice");
      const author = await student("carol");
      const post = await content.createPost(await actors.resolve(author.token, "known"), { body: "x" });

      const forged: Actor = { ...a.anon, blindIndex: randomBytes(32) };
      expect(
        await code(reports.report(forged, { targetKind: "post", targetId: post.id, reason: "other" })),
      ).toBe("not_found");
    });

    it("bans from the anonymous profile: both profiles hidden, email blocked", async () => {
      const a = await withAnonymous("alice");
      const bob = await student("bob");
      const bobActor = await actors.resolve(bob.token, "known");
      const known = await content.createPost(a.known, { body: "known post" });
      const anon = await content.createPost(a.anon, { body: "anon post", confirmedAnonymous: true });

      await adminSvc.penalize(mod, {
        profileId: a.anonProfileId,
        kind: "ban",
        note: "Posted credible threats repeatedly",
      });

      expect(await status(a.accountId)).toBe("banned");
      expect(await code(content.getPost(bobActor, known.id))).toBe("not_found");
      expect(await code(content.getPost(bobActor, anon.id))).toBe("not_found");
      expect(await authStore.isEmailBanned(
        (await import("../src/auth/crypto.js")).hashEmail(a.email),
      )).toBe(true);
    });

    it("bans from the known profile: anonymous content is hidden by the next sweep, then restored on appeal", async () => {
      const a = await withAnonymous("alice");
      const bob = await student("bob");
      const bobActor = await actors.resolve(bob.token, "known");
      const known = await content.createPost(a.known, { body: "known post" });
      const anon = await content.createPost(a.anon, { body: "anon post", confirmedAnonymous: true });

      await adminSvc.penalize(mod, {
        profileId: a.knownProfileId,
        kind: "ban",
        note: "Sharing intimate images without consent",
      });

      expect(await code(content.getPost(bobActor, known.id))).toBe("not_found");
      expect(await code(content.getPost(bobActor, anon.id))).toBe("ok");

      const hide = await sweep();
      expect(hide.hiddenBannedAnonymous).toBe(1);
      expect(await code(content.getPost(bobActor, anon.id))).toBe("not_found");
      expect((await sweep()).hiddenBannedAnonymous).toBe(0);

      await auth.requestAppeal(a.email);
      await auth.submitAppeal(a.email, mailer.lastCode(a.email), "It was a misunderstanding.");
      const [appeal] = (await adminSvc.appeals("open")).items;
      await adminSvc.decideAppeal(mod, appeal!.id, "upheld", "Context shows it was misreported");

      expect(await status(a.accountId)).toBe("active");
      expect(await code(content.getPost(bobActor, known.id))).toBe("ok");
      expect(await code(content.getPost(bobActor, anon.id))).toBe("not_found");
      const restore = await sweep();
      expect(restore.restoredAnonymous).toBe(1);
      expect(await code(content.getPost(bobActor, anon.id))).toBe("ok");
    });

    it("warns, then reports the strike on the account without revealing it to the moderator", async () => {
      const a = await withAnonymous("alice");
      await adminSvc.penalize(mod, {
        profileId: a.anonProfileId,
        kind: "warning",
        note: "Repeated insults in comments",
      });
      const acc = await admin.query(`select strike_count from accounts where id = $1`, [a.accountId]);
      expect(acc.rows[0].strike_count).toBe(1);
    });
  });

  describe("closure, purge and export with an anonymous profile", () => {
    it("exports both profiles", async () => {
      const a = await withAnonymous("alice");
      await content.createPost(a.known, { body: "known post" });
      await content.createPost(a.anon, { body: "anon post", confirmedAnonymous: true });

      const data = await account.exportData(a.token);
      expect(data.profiles.map((p) => p.kind).sort()).toEqual(["anonymous", "known"]);
      expect(data.posts.map((p) => `${p.profile}:${p.body}`).sort()).toEqual([
        "anonymous:anon post",
        "known:known post",
      ]);
    });

    it("closes on request, then purges both profiles and the link", async () => {
      const a = await withAnonymous("alice");
      const bob = await student("bob");
      const bobActor = await actors.resolve(bob.token, "known");
      const anon = await content.createPost(a.anon, { body: "anon post", confirmedAnonymous: true });
      await content.createPost(a.known, { body: "known post" });
      const bobsPost = await content.createPost(bobActor, { body: "bob stays" });

      await account.requestClose(a.token);
      await account.confirmClose(a.token, mailer.lastCode(a.email));
      expect(await status(a.accountId)).toBe("closed");
      expect(await code(content.getPost(bobActor, anon.id))).toBe("not_found");

      clock.now = new Date(clock.now.getTime() + 31 * DAY);
      const r = await sweep();
      expect(r.purged).toBe(1);
      expect(r.skipped).toBe(0);

      const count = async (sql: string, args: unknown[] = []) =>
        (await admin.query(sql, args)).rows[0].n as number;
      expect(await count(`select count(*)::int n from profiles where id = any($1)`, [[a.knownProfileId, a.anonProfileId]])).toBe(0);
      expect(await count(`select count(*)::int n from posts where author_profile_id = any($1)`, [[a.knownProfileId, a.anonProfileId]])).toBe(0);
      expect(await count(`select count(*)::int n from identity.anonymous_links where account_id = $1`, [a.accountId])).toBe(0);
      expect(await count(`select count(*)::int n from posts where id = $1`, [bobsPost.id])).toBe(1);
    });

    it("skips and reports an account it cannot resolve, leaving it intact", async () => {
      const a = await withAnonymous("alice");
      await content.createPost(a.anon, { body: "anon post", confirmedAnonymous: true });
      await account.requestClose(a.token).catch(() => undefined);
      await account.confirmClose(a.token, mailer.lastCode(a.email));

      const keyless = new PgLifecycleStore(lifePool);
      clock.now = new Date(clock.now.getTime() + 31 * DAY);
      const r = await runLifecycleSweep(keyless, SWEEP, clock.now);
      expect(r.purged).toBe(0);
      expect(r.skipped).toBeGreaterThan(0);

      const still = await admin.query(
        `select count(*)::int n from identity.anonymous_links where account_id = $1`,
        [a.accountId],
      );
      expect(still.rows[0].n).toBe(1);
    });
  });

  describe("unmasking by trust & safety", () => {
    const unmask = (
      blind: Buffer,
      o: { actor?: string; reason?: string; approvedBy?: string | null; caseRef?: string | null } = {},
    ) =>
      tsPool.query(`select * from identity.unmask_profile_identity($1, $2, $3, $4, $5, $6)`, [
        blind,
        o.actor ?? "Alice TS",
        o.reason ?? "confirmed_threat",
        "Report R-8841: explicit threat against a named student",
        o.caseRef === undefined ? "R-8841" : o.caseRef,
        o.approvedBy === undefined ? "Bob TS" : o.approvedBy,
      ]);

    const auditRows = async () =>
      (await admin.query(`select * from identity.lookup_audit order by id`)).rows;

    it("returns the person's identity and writes an audit row with the real login", async () => {
      const a = await withAnonymous("alice");
      const r = await unmask(crypto.blindIndex(a.anonProfileId));

      expect(r.rows).toEqual([
        {
          out_account_id: a.accountId,
          out_email: a.email,
          out_status: "active",
          out_known_handle: expect.stringMatching(/^alice_student_\d{4}$/),
          out_known_name: "Alice Student",
        },
      ]);

      const audit = await auditRows();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor: "Alice TS",
        actor_role: "trust_safety",
        reason_code: "confirmed_threat",
        case_ref: "R-8841",
        approved_by: "Bob TS",
      });
    });

    it("refuses a non-court reason without a different second approver, and records nothing", async () => {
      const a = await withAnonymous("alice");
      const blind = crypto.blindIndex(a.anonProfileId);

      for (const approvedBy of [null, "", "  ", "Alice TS", "alice ts"]) {
        await expect(unmask(blind, { approvedBy })).rejects.toMatchObject({ code: "TS001" });
      }
      expect(await auditRows()).toHaveLength(0);
    });

    it("accepts a court order without a second approver", async () => {
      const a = await withAnonymous("alice");
      const r = await unmask(crypto.blindIndex(a.anonProfileId), {
        reason: "court_order",
        approvedBy: null,
        caseRef: "HC/2026/114",
      });
      expect(r.rows[0].out_email).toBe(a.email);
      expect((await auditRows())[0]).toMatchObject({ reason_code: "court_order", case_ref: "HC/2026/114" });
    });

    it("audits a lookup that finds nothing", async () => {
      const r = await unmask(randomBytes(32));
      expect(r.rowCount).toBe(0);
      expect(await auditRows()).toHaveLength(1);
    });

    it("rejects an unknown reason and a thin justification", async () => {
      const a = await withAnonymous("alice");
      await expect(
        unmask(crypto.blindIndex(a.anonProfileId), { reason: "curiosity" }),
      ).rejects.toThrow(/check constraint/);
      await expect(
        tsPool.query(`select * from identity.unmask_profile_identity($1, 'x', 'court_order', 'short')`, [
          crypto.blindIndex(a.anonProfileId),
        ]),
      ).rejects.toThrow(/check constraint/);
    });

    it("cannot bypass the approval rule through the bare function", async () => {
      await expect(
        tsPool.query(
          `select identity.unmask_profile($1, 'x', 'confirmed_threat', 'long enough justification text')`,
          [randomBytes(32)],
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it("cannot read accounts directly and cannot alter the audit log", async () => {
      const a = await withAnonymous("alice");
      await unmask(crypto.blindIndex(a.anonProfileId));

      await expect(tsPool.query(`select email from accounts`)).rejects.toThrow(/permission denied/);
      await expect(tsPool.query(`select * from identity.anonymous_links`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(tsPool.query(`update identity.lookup_audit set actor = 'x'`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(tsPool.query(`delete from identity.lookup_audit`)).rejects.toThrow(
        /permission denied/,
      );
      const visible = await tsPool.query(`select count(*)::int n from identity.lookup_audit`);
      expect(visible.rows[0].n).toBe(1);
    });

    it("is unavailable to every other role", async () => {
      const args = [randomBytes(32), "x", "court_order", "a long enough justification text", null, null];
      for (const [name, p] of [
        ["app_api", appPool],
        ["moderator", modPool],
        ["auth_service", authPool],
        ["account_lifecycle", lifePool],
      ] as const) {
        await expect(
          p.query(`select * from identity.unmask_profile_identity($1,$2,$3,$4,$5,$6)`, args),
          name,
        ).rejects.toThrow(/permission denied/);
      }
    });

    it("moderators can penalise an anonymous profile but never learn who owns it", async () => {
      const a = await withAnonymous("alice");
      await adminSvc.penalize(mod, {
        profileId: a.anonProfileId,
        kind: "warning",
        note: "Repeated insults in comments",
      });
      await expect(modPool.query(`select * from identity.anonymous_links`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(modPool.query(`select * from accounts`)).rejects.toThrow(/permission denied/);
      await expect(
        modPool.query(`select identity.apply_penalty_to_account(gen_random_uuid(),'ban',null,null,'{}')`),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
