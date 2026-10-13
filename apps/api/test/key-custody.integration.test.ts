import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgLifecycleStore } from "../src/account/pgLifecycleStore.js";
import { runLifecycleSweep } from "../src/account/lifecycleStore.js";
import { AccountService } from "../src/account/service.js";
import { PgAuthStore } from "../src/auth/pgStore.js";
import { AuthService } from "../src/auth/service.js";
import { AuthActorResolver } from "../src/content/actor.js";
import { BlindIndexer, LinkCrypto } from "../src/identity/linkCrypto.js";
import { DEFAULT_IDENTITY_OPTIONS, IdentityService } from "../src/identity/service.js";
import { rotateLinks, verifyLinks } from "../src/identity/rotation.js";
import { PgReportStore, ReportService } from "../src/moderation/reports.js";
import { PgContentStore } from "../src/content/pgStore.js";
import { ContentService, DEFAULT_CONTENT_OPTIONS } from "../src/content/service.js";
import { revokeSessions } from "../src/security/sessions.js";
import { CapturingMailer } from "./helpers/memoryStore.js";
import { MemoryPhotoStore } from "./helpers/memoryContent.js";

const password = process.env.TEST_PG_PASSWORD;
const host = process.env.TEST_PG_HOST ?? "127.0.0.1";
const port = Number(process.env.TEST_PG_PORT ?? 5432);
const database = process.env.TEST_PG_DB ?? "campus_social";

const suite = password ? describe : describe.skip;
const b64 = () => randomBytes(32).toString("base64");

function pool(user: string) {
  return new pg.Pool({ host, port, database, user, password, max: 4 });
}

interface Student {
  email: string;
  token: string;
  accountId: string;
  anonProfileId: string;
}

suite("Key custody and containment tools (PostgreSQL)", () => {
  let owner: pg.Pool;
  let authPool: pg.Pool;
  let appPool: pg.Pool;
  let lifePool: pg.Pool;
  let tsPool: pg.Pool;

  let k1: string;
  let k2: string;
  let blindKey: string;
  let oldCrypto: LinkCrypto;
  let mailer: CapturingMailer;
  let clock: { now: Date };
  let auth: AuthService;
  let authStore: PgAuthStore;
  let identity: IdentityService;

  beforeAll(() => {
    owner = pool("postgres");
    authPool = pool("auth_service");
    appPool = pool("app_api");
    lifePool = pool("account_lifecycle");
    tsPool = pool("trust_safety");
  });

  afterAll(async () => {
    await Promise.all([owner, authPool, appPool, lifePool, tsPool].map((p) => p?.end()));
  });

  beforeEach(async () => {
    await owner.query(
      `truncate accounts, profiles, email_codes, sessions, banned_emails, universities,
                photo_uploads, notifications, storage_deletions, moderation.reports,
                moderation.actions, moderation.penalties, moderation.appeals,
                moderation.legal_holds, identity.lookup_audit, identity.lookup_audit_purges cascade`,
    );
    await owner.query(
      `insert into universities (name, email_domain, active) values ('One', 'test.ac.ke', true)`,
    );

    k1 = b64();
    k2 = b64();
    blindKey = b64();
    oldCrypto = new LinkCrypto(`1:${k1}`, blindKey);
    clock = { now: new Date("2026-10-12T10:00:00Z") };
    mailer = new CapturingMailer();
    authStore = new PgAuthStore(authPool);
    auth = new AuthService(
      authStore,
      mailer,
      {
        codeHmacKey: "custody-key-custody-key-custody-key-0123456789",
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
      oldCrypto,
      { ...DEFAULT_IDENTITY_OPTIONS, minAccountAgeDays: 0 },
      () => clock.now,
    );
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
    const made = await identity.createAnonymous(s.sessionToken, { acknowledged: true });
    return {
      email,
      token: s.sessionToken,
      accountId: s.account.id,
      anonProfileId: made.profile.profileId,
    };
  }

  const linkRows = async () =>
    (
      await owner.query(
        `select account_id, anon_profile_enc, anon_blind_index, key_version
           from identity.anonymous_links order by account_id`,
      )
    ).rows;

  const resolverFor = (crypto: LinkCrypto) => new AuthActorResolver(auth, { store: authStore, crypto });

  describe("verifying the keys against the database", () => {
    it("reports every link healthy, by key version", async () => {
      await student("alice");
      await student("bob");
      await student("carol");

      const a = await verifyLinks(owner, oldCrypto);
      expect(a).toMatchObject({ total: 3, healthy: 3, byBlobVersion: { 1: 3 } });
      expect(a.problems).toEqual([]);
    });

    it("fails clearly when the wrong keys are held, and when a version is missing", async () => {
      await student("alice");

      const wrong = await verifyLinks(owner, new LinkCrypto(`1:${b64()}`, blindKey));
      expect(wrong.healthy).toBe(0);
      expect(wrong.problems[0]?.problem).toBe("cannot_decrypt");

      const onlyNew = await verifyLinks(owner, new LinkCrypto(`2:${k2}`, blindKey));
      expect(onlyNew.problems[0]).toMatchObject({
        problem: "cannot_decrypt",
        detail: expect.stringMatching(/no link key for version 1/),
      });
    });

    it("pinpoints a single tampered or swapped row and leaves the rest healthy", async () => {
      const a = await student("alice");
      const b = await student("bob");
      await student("carol");

      const rows = await linkRows();
      const ra = rows.find((r) => r.account_id === a.accountId)!;
      const rb = rows.find((r) => r.account_id === b.accountId)!;
      await owner.query(`update identity.anonymous_links set anon_profile_enc = $2 where account_id = $1`, [
        a.accountId,
        rb.anon_profile_enc,
      ]);
      await owner.query(`update identity.anonymous_links set anon_profile_enc = $2 where account_id = $1`, [
        b.accountId,
        ra.anon_profile_enc,
      ]);

      const out = await verifyLinks(owner, oldCrypto);
      expect(out.healthy).toBe(1);
      expect(out.problems.map((p) => p.accountId).sort()).toEqual([a.accountId, b.accountId].sort());
    });

    it("notices a blind index that no longer matches, and a profile that is gone", async () => {
      const a = await student("alice");
      const b = await student("bob");
      await owner.query(`update identity.anonymous_links set anon_blind_index = $2 where account_id = $1`, [
        a.accountId,
        randomBytes(32),
      ]);
      await owner.query(`delete from profiles where id = $1`, [b.anonProfileId]);

      const out = await verifyLinks(owner, oldCrypto);
      const kinds = Object.fromEntries(out.problems.map((p) => [p.accountId, p.problem]));
      expect(kinds[a.accountId]).toBe("blind_index_mismatch");
      expect(kinds[b.accountId]).toBe("profile_missing");
    });
  });

  describe("rotating the encryption key", () => {
    it("a dry run changes nothing", async () => {
      await student("alice");
      await student("bob");
      const before = await linkRows();
      const both = new LinkCrypto(`1:${k1},2:${k2}`, blindKey);

      const out = await rotateLinks(owner, { crypto: both, apply: false });
      expect(out).toMatchObject({ applied: false, reason: "dry_run", rowsChanged: 2, reencrypted: 2 });
      expect(await linkRows()).toEqual(before);
    });

    it("re-encrypts everything under the new key, and the old key alone then fails", async () => {
      const a = await student("alice");
      const b = await student("bob");
      const both = new LinkCrypto(`1:${k1},2:${k2}`, blindKey);

      const out = await rotateLinks(owner, { crypto: both, apply: true });
      expect(out).toMatchObject({ applied: true, rowsChanged: 2, reencrypted: 2, reindexed: 0 });

      for (const r of await linkRows()) {
        expect(r.key_version).toBe(2);
        expect(r.anon_profile_enc[0]).toBe(2);
      }

      const onlyNew = new LinkCrypto(`2:${k2}`, blindKey);
      expect(await verifyLinks(owner, onlyNew)).toMatchObject({ total: 2, healthy: 2 });
      const actor = await resolverFor(onlyNew).resolve(a.token, "anonymous");
      expect(actor.profileId).toBe(a.anonProfileId);
      expect((await resolverFor(onlyNew).resolve(b.token, "anonymous")).profileId).toBe(b.anonProfileId);

      const onlyOld = await verifyLinks(owner, oldCrypto);
      expect(onlyOld.healthy).toBe(0);
    });

    it("is repeatable: a second run has nothing to do", async () => {
      await student("alice");
      const both = new LinkCrypto(`1:${k1},2:${k2}`, blindKey);
      await rotateLinks(owner, { crypto: both, apply: true });
      const again = await rotateLinks(owner, { crypto: both, apply: true });
      expect(again).toMatchObject({ applied: false, reason: "nothing_to_do", rowsChanged: 0 });
    });

    it("writes NOTHING if any single link fails verification", async () => {
      await student("alice");
      const b = await student("bob");
      await student("carol");
      await owner.query(
        `update identity.anonymous_links
            set anon_profile_enc = set_byte(anon_profile_enc, 20, 255) where account_id = $1`,
        [b.accountId],
      );
      const before = await linkRows();
      const both = new LinkCrypto(`1:${k1},2:${k2}`, blindKey);

      const out = await rotateLinks(owner, { crypto: both, apply: true });
      expect(out).toMatchObject({ applied: false, reason: "verification_failed", rowsChanged: 0 });
      expect(out.before.problems).toHaveLength(1);
      expect(await linkRows()).toEqual(before);
    });

    it("refuses when a needed old key is missing, rather than losing links", async () => {
      await student("alice");
      const before = await linkRows();
      const onlyNew = new LinkCrypto(`2:${k2}`, blindKey);
      const out = await rotateLinks(owner, { crypto: onlyNew, apply: true });
      expect(out.applied).toBe(false);
      expect(out.reason).toBe("verification_failed");
      expect(await linkRows()).toEqual(before);
    });

    it("keeps the system working end to end after rotation", async () => {
      const a = await student("alice");
      const both = new LinkCrypto(`1:${k1},2:${k2}`, blindKey);
      await rotateLinks(owner, { crypto: both, apply: true });

      const crypto2 = new LinkCrypto(`2:${k2}`, blindKey);
      const actors = resolverFor(crypto2);
      const content = new ContentService(
        new PgContentStore(appPool),
        new MemoryPhotoStore(),
        { ...DEFAULT_CONTENT_OPTIONS, maxPostsPerHour: 100 },
        () => clock.now,
      );
      const anon = await actors.resolve(a.token, "anonymous");
      const post = await content.createPost(anon, { body: "after rotation", confirmedAnonymous: true });
      expect(post.author.kind).toBe("anonymous");

      const r = await tsPool.query(
        `select * from identity.unmask_profile_identity($1, 'Alice TS', 'court_order',
                'Court order HC/2026/114 supplied by counsel for this test', 'HC/2026/114', null)`,
        [crypto2.blindIndex(a.anonProfileId)],
      );
      expect(r.rows[0].out_email).toBe(a.email);
    });
  });

  describe("rotating the blind-index key", () => {
    it("recomputes every index, and only the new key then verifies", async () => {
      const a = await student("alice");
      await student("bob");
      const before = await linkRows();
      const newBlindKey = b64();
      const both = new LinkCrypto(`1:${k1}`, blindKey);

      const out = await rotateLinks(owner, {
        crypto: both,
        apply: true,
        newBlind: new BlindIndexer(newBlindKey),
      });
      expect(out).toMatchObject({ applied: true, reindexed: 2, reencrypted: 0 });

      const after = await linkRows();
      for (let i = 0; i < before.length; i += 1) {
        expect(after[i].anon_blind_index.equals(before[i].anon_blind_index)).toBe(false);
      }

      const fresh = new LinkCrypto(`1:${k1}`, newBlindKey);
      expect(await verifyLinks(owner, fresh)).toMatchObject({ healthy: 2, problems: [] });
      const stale = await verifyLinks(owner, oldCrypto);
      expect(stale.problems.map((p) => p.problem)).toEqual([
        "blind_index_mismatch",
        "blind_index_mismatch",
      ]);

      const reports = new ReportService(new PgReportStore(appPool));
      const author = await student("carol");
      const content = new ContentService(
        new PgContentStore(appPool),
        new MemoryPhotoStore(),
        { ...DEFAULT_CONTENT_OPTIONS, maxPostsPerHour: 100 },
        () => clock.now,
      );
      const carolKnown = await resolverFor(fresh).resolve(author.token, "known");
      const post = await content.createPost(carolKnown, { body: "reportable" });
      const anonNew = await resolverFor(fresh).resolve(a.token, "anonymous");
      await expect(
        reports.report(anonNew, { targetKind: "post", targetId: post.id, reason: "other" }),
      ).resolves.toEqual({ status: "received" });
      const anonOld = await resolverFor(oldCrypto).resolve(a.token, "anonymous");
      await expect(
        reports.report(anonOld, { targetKind: "post", targetId: post.id, reason: "hate" }),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("when a link cannot be opened (a lost or wrong key)", () => {
    const lost = () => new LinkCrypto(`1:${b64()}`, blindKey);

    async function plainStudent(name: string) {
      const email = `${name}@test.ac.ke`;
      await auth.requestSignup(email);
      const s = await auth.verifySignup({
        email,
        code: mailer.lastCode(email),
        dateOfBirth: "2004-05-01",
        displayName: `${name} Student`,
      });
      return { email, token: s.sessionToken, accountId: s.account.id };
    }

    it("acting as the profile is a clean 503, and the known profile still works", async () => {
      const a = await student("alice");
      const resolver = resolverFor(lost());

      await expect(resolver.resolve(a.token, "anonymous")).rejects.toMatchObject({
        code: "anonymous_unavailable",
        httpStatus: 503,
      });
      await expect(resolver.resolve(a.token, "known")).resolves.toMatchObject({ kind: "known" });
    });

    it("/me/profiles degrades instead of failing", async () => {
      const a = await student("alice");
      const broken = new IdentityService(
        auth,
        authStore,
        lost(),
        { ...DEFAULT_IDENTITY_OPTIONS, minAccountAgeDays: 0 },
        () => clock.now,
      );
      const mine = await broken.myProfiles(a.token);
      expect(mine.anonymous).toBeNull();
      expect(mine.anonymousEligibility).toEqual({ status: "unavailable" });
      expect(mine.known.profileId).toBeTruthy();
    });

    it("closing and exporting that account is refused cleanly, and nothing is half done", async () => {
      const a = await student("alice");
      const lifecycle = new PgLifecycleStore(lifePool, {
        decryptAnonymousProfileId: (enc, id) => lost().decrypt(enc, id),
      });
      const account = new AccountService(auth, authStore, lifecycle, () => clock.now);

      await expect(account.exportData(a.token)).rejects.toMatchObject({ code: "not_available" });

      await account.requestClose(a.token);
      await expect(
        account.confirmClose(a.token, mailer.lastCode(a.email)),
      ).rejects.toMatchObject({ code: "not_available" });

      const row = await owner.query(`select status from accounts where id = $1`, [a.accountId]);
      expect(row.rows[0].status).toBe("active");
    });

    it("the maintenance job reports an unreadable link and still processes everyone else", async () => {
      const broken = await student("alice");
      const fine = await plainStudent("bob");

      await owner.query(
        `update accounts set status = 'closed', closed_at = $1, closed_reason = 'user_request'
          where id = any($2)`,
        [new Date("2026-06-01T00:00:00Z"), [broken.accountId, fine.accountId]],
      );

      const lifecycle = new PgLifecycleStore(lifePool, {
        decryptAnonymousProfileId: (enc, id) => lost().decrypt(enc, id),
      });

      const result = await runLifecycleSweep(
        lifecycle,
        { reverifyGraceDays: 30, purgeAfterDays: 30 },
        clock.now,
      );

      expect(result.purged).toBe(1);
      expect(result.skipped).toBeGreaterThanOrEqual(1);

      const rows = await owner.query(
        `select id, purged_at is not null as purged from accounts where id = any($1)`,
        [[broken.accountId, fine.accountId]],
      );
      const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r.purged]));
      expect(byId[fine.accountId]).toBe(true);
      expect(byId[broken.accountId]).toBe(false);
      const link = await owner.query(
        `select count(*)::int n from identity.anonymous_links where account_id = $1`,
        [broken.accountId],
      );
      expect(link.rows[0].n).toBe(1);
    });

    it("the ban cleanup and appeal restore passes also skip it without aborting", async () => {
      const a = await student("alice");
      const b = await plainStudent("bob");
      await owner.query(`update accounts set status = 'banned' where id = $1`, [a.accountId]);
      await owner.query(`update accounts set status = 'banned' where id = $1`, [b.accountId]);

      const lifecycle = new PgLifecycleStore(lifePool, {
        decryptAnonymousProfileId: (enc, id) => lost().decrypt(enc, id),
      });
      const hide = await lifecycle.hideBannedAnonymousContent(clock.now);
      expect(hide.skipped).toBe(1);

      await owner.query(`update accounts set status = 'active' where id = $1`, [a.accountId]);
      const restore = await lifecycle.restoreUnbannedAnonymousContent();
      expect(restore.skipped).toBe(1);
    });

    it("a later run with the right keys finishes what was skipped", async () => {
      const a = await student("alice");
      await owner.query(
        `update accounts set status = 'closed', closed_at = $1, closed_reason = 'user_request'
          where id = $2`,
        [new Date("2026-06-01T00:00:00Z"), a.accountId],
      );
      const opts = { reverifyGraceDays: 30, purgeAfterDays: 30 };

      const wrong = new PgLifecycleStore(lifePool, {
        decryptAnonymousProfileId: (enc, id) => lost().decrypt(enc, id),
      });
      expect((await runLifecycleSweep(wrong, opts, clock.now)).purged).toBe(0);

      const right = new PgLifecycleStore(lifePool, {
        decryptAnonymousProfileId: (enc, id) => oldCrypto.decrypt(enc, id),
      });
      expect((await runLifecycleSweep(right, opts, clock.now)).purged).toBe(1);
      const link = await owner.query(`select count(*)::int n from identity.anonymous_links`);
      expect(link.rows[0].n).toBe(0);
    });
  });

  describe("what still works without the encryption key (the runbook's claim)", () => {
    it("penalising and unmasking by profile id need only the blind-index key", async () => {
      const a = await student("alice");
      const onlyBlind = new BlindIndexer(blindKey);

      const r = await tsPool.query(
        `select * from identity.unmask_profile_identity($1, 'Alice TS', 'court_order',
                'Court order HC/2026/114 supplied by counsel for this test', 'HC/2026/114', null)`,
        [onlyBlind.indexFor(a.anonProfileId)],
      );
      expect(r.rows[0].out_email).toBe(a.email);

      const modPool = pool("moderator");
      try {
        const action = await owner.query(
          `insert into moderation.actions (kind, moderator) values ('warn', 'Wanjiru') returning id`,
        );
        await modPool.query(
          `select identity.apply_penalty_for_profile($1, 'warning', $2, null, $3)`,
          [onlyBlind.indexFor(a.anonProfileId), action.rows[0].id, a.anonProfileId],
        );
        const acc = await owner.query(`select strike_count from accounts where id = $1`, [a.accountId]);
        expect(acc.rows[0].strike_count).toBe(1);
      } finally {
        await modPool.end();
      }
    });
  });

  describe("revoking sessions", () => {
    it("signs everyone out at once, and they can sign back in", async () => {
      const a = await student("alice");
      const b = await student("bob");
      await expect(auth.authenticate(a.token)).resolves.toBeTruthy();

      const n = await revokeSessions(lifePool, { all: true });
      expect(n).toBeGreaterThanOrEqual(2);
      await expect(auth.authenticate(a.token)).rejects.toMatchObject({ code: "unauthorized" });
      await expect(auth.authenticate(b.token)).rejects.toMatchObject({ code: "unauthorized" });

      await auth.requestLogin(a.email);
      const again = await auth.verifyLogin(a.email, mailer.lastCode(a.email));
      await expect(auth.authenticate(again.sessionToken)).resolves.toBeTruthy();
    });

    it("can target one account and leaves the others signed in", async () => {
      const a = await student("alice");
      const b = await student("bob");

      const n = await revokeSessions(lifePool, { accountEmail: "  ALICE@test.ac.ke " });
      expect(n).toBe(1);
      await expect(auth.authenticate(a.token)).rejects.toMatchObject({ code: "unauthorized" });
      await expect(auth.authenticate(b.token)).resolves.toBeTruthy();
    });

    it("changes nothing but sessions, and is safe to repeat", async () => {
      await student("alice");
      const accountsBefore = (await owner.query(`select count(*)::int n from accounts`)).rows[0].n;
      const profilesBefore = (await owner.query(`select count(*)::int n from profiles`)).rows[0].n;

      await revokeSessions(lifePool, { all: true });
      expect(await revokeSessions(lifePool, { all: true })).toBe(0);

      expect((await owner.query(`select count(*)::int n from accounts`)).rows[0].n).toBe(accountsBefore);
      expect((await owner.query(`select count(*)::int n from profiles`)).rows[0].n).toBe(profilesBefore);
    });

    it("does nothing for an email that has no account", async () => {
      await student("alice");
      expect(await revokeSessions(lifePool, { accountEmail: "nobody@test.ac.ke" })).toBe(0);
    });
  });
});
