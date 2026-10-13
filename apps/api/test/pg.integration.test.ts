import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgLifecycleStore } from "../src/account/pgLifecycleStore.js";
import { runLifecycleSweep } from "../src/account/lifecycleStore.js";
import { AccountService } from "../src/account/service.js";
import { hashEmail } from "../src/auth/crypto.js";
import { PgAuthStore } from "../src/auth/pgStore.js";
import { AuthError, AuthService } from "../src/auth/service.js";
import { CapturingMailer } from "./helpers/memoryStore.js";

const password = process.env.TEST_PG_PASSWORD;
const host = process.env.TEST_PG_HOST ?? "127.0.0.1";
const port = Number(process.env.TEST_PG_PORT ?? 5432);
const database = process.env.TEST_PG_DB ?? "campus_social";

const suite = password ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;
const EMAIL = "jane@test.ac.ke";
const SIGNUP = { dateOfBirth: "2004-05-01", displayName: "Jane Doe" };
const SWEEP = { reverifyGraceDays: 30, purgeAfterDays: 30 };

function pool(user: string) {
  return new pg.Pool({ host, port, database, user, password, max: 4 });
}

suite("PostgreSQL stores", () => {
  let admin: pg.Pool;
  let authPool: pg.Pool;
  let lifePool: pg.Pool;
  let universityId: string;

  let clock: { now: Date };
  let mailer: CapturingMailer;
  let auth: AuthService;
  let account: AccountService;
  let lifecycle: PgLifecycleStore;
  let authStore: PgAuthStore;

  beforeAll(async () => {
    admin = pool("postgres");
    authPool = pool("auth_service");
    lifePool = pool("account_lifecycle");
  });

  afterAll(async () => {
    await Promise.all([admin?.end(), authPool?.end(), lifePool?.end()]);
  });

  beforeEach(async () => {
    await admin.query(
      `truncate accounts, profiles, email_codes, sessions, banned_emails, universities cascade`,
    );
    const u = await admin.query(
      `insert into universities (name, email_domain, active)
       values ('Test University', 'test.ac.ke', true) returning id`,
    );
    universityId = u.rows[0].id;

    clock = { now: new Date("2026-10-12T10:00:00Z") };
    mailer = new CapturingMailer();
    authStore = new PgAuthStore(authPool);
    lifecycle = new PgLifecycleStore(lifePool);
    auth = new AuthService(
      authStore,
      mailer,
      {
        codeHmacKey: "integration-key-integration-key-0123456789",
        codeTtlMinutes: 10,
        maxCodesPerHour: 20,
        maxCodeAttempts: 3,
        sessionTtlDays: 400,
        termsVersion: "it-v1",
      },
      () => clock.now,
    );
    account = new AccountService(auth, authStore, lifecycle, () => clock.now);
  });

  async function signUp(email = EMAIL, displayName = "Jane Doe") {
    await auth.requestSignup(email);
    return auth.verifySignup({
      email,
      code: mailer.lastCode(email),
      dateOfBirth: SIGNUP.dateOfBirth,
      displayName,
    });
  }

  async function addPost(profileId: string, body: string) {
    const r = await admin.query(
      `insert into posts (author_profile_id, body) values ($1, $2) returning id`,
      [profileId, body],
    );
    const key = `${randomUUID()}.jpg`;
    await admin.query(
      `insert into photo_uploads (profile_id, storage_key, width, height, attached_at)
       values ($1, $2, 10, 10, now())`,
      [profileId, key],
    );
    await admin.query(
      `insert into post_photos (post_id, position, storage_key, width, height) values ($1, 0, $2, 10, 10)`,
      [r.rows[0].id, key],
    );
    return r.rows[0].id as string;
  }

  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };

  describe("sign-up and login (PgAuthStore, auth_service role)", () => {
    it("creates account, known profile and owner link in one transaction", async () => {
      const s = await signUp();

      const acc = await admin.query(
        `select email, status, terms_version, reverify_due_at, created_at,
                to_char(date_of_birth,'YYYY-MM-DD') dob
           from accounts where id = $1`,
        [s.account.id],
      );
      expect(new Date(acc.rows[0].created_at).toISOString()).toBe(clock.now.toISOString());
      expect(acc.rows[0]).toMatchObject({
        email: EMAIL,
        status: "active",
        terms_version: "it-v1",
        dob: "2004-05-01",
      });
      expect(new Date(acc.rows[0].reverify_due_at).toISOString()).toBe("2027-10-12T10:00:00.000Z");

      const owner = await admin.query(
        `select profile_id from identity.known_profile_owner where account_id = $1`,
        [s.account.id],
      );
      expect(owner.rows[0].profile_id).toBe(s.profile.id);

      const prof = await admin.query(`select kind, display_name from profiles where id = $1`, [
        s.profile.id,
      ]);
      expect(prof.rows[0]).toMatchObject({ kind: "known", display_name: "Jane Doe" });
    });

    it("authenticates the issued token, logs in by code, and logs out", async () => {
      const s = await signUp();
      expect((await auth.authenticate(s.sessionToken)).email).toBe(EMAIL);

      await auth.requestLogin(EMAIL);
      const login = await auth.verifyLogin(EMAIL, mailer.lastCode(EMAIL));
      expect((await auth.authenticate(login.sessionToken)).accountId).toBe(s.account.id);

      await auth.logout(login.sessionToken);
      await expect(auth.authenticate(login.sessionToken)).rejects.toMatchObject({
        code: "unauthorized",
      });
    });

    it("stores only hashed codes and tokens", async () => {
      const s = await signUp();
      const code = mailer.codes[0]?.code ?? "";
      const codes = await admin.query(`select code_hash from email_codes`);
      expect(codes.rows[0].code_hash.toString("utf8")).not.toContain(code);
      const sess = await admin.query(`select refresh_hash from sessions`);
      expect(sess.rows[0].refresh_hash.toString("utf8")).not.toContain(s.sessionToken);
    });

    it("locks a code after too many wrong guesses", async () => {
      await auth.requestSignup(EMAIL);
      const right = mailer.lastCode(EMAIL);
      const wrong = right === "000000" ? "000001" : "000000";
      for (let i = 0; i < 3; i += 1) {
        await expect(
          auth.verifySignup({ email: EMAIL, code: wrong, ...SIGNUP }),
        ).rejects.toMatchObject({ code: "invalid_code" });
      }
      await expect(
        auth.verifySignup({ email: EMAIL, code: right, ...SIGNUP }),
      ).rejects.toMatchObject({ code: "too_many_attempts" });
    });

    it("rejects an expired code", async () => {
      await auth.requestSignup(EMAIL);
      const code = mailer.lastCode(EMAIL);
      advance(11 * 60 * 1000);
      await expect(auth.verifySignup({ email: EMAIL, code, ...SIGNUP })).rejects.toMatchObject({
        code: "code_expired",
      });
    });

    it("maps unique violations to email_taken and handle_taken", async () => {
      const s = await signUp();
      const base = {
        universityId,
        dateOfBirth: "2004-05-01",
        termsVersion: "t",
        now: clock.now,
        reverifyDueAt: new Date(clock.now.getTime() + 365 * DAY),
      };

      const sameEmail = await authStore.createAccountWithKnownProfile({
        ...base,
        email: EMAIL,
        profile: { handle: "other_handle_1", displayName: "X", course: null, studyYear: null },
      });
      expect(sameEmail).toEqual({ kind: "email_taken" });

      const handleRow = await admin.query(`select handle from profiles where id = $1`, [
        s.profile.id,
      ]);
      const sameHandle = await authStore.createAccountWithKnownProfile({
        ...base,
        email: "new@test.ac.ke",
        profile: {
          handle: handleRow.rows[0].handle,
          displayName: "Y",
          course: null,
          studyYear: null,
        },
      });
      expect(sameHandle).toEqual({ kind: "handle_taken" });

      const accounts = await admin.query(`select count(*)::int n from accounts`);
      const profiles = await admin.query(`select count(*)::int n from profiles`);
      expect(accounts.rows[0].n).toBe(1);
      expect(profiles.rows[0].n).toBe(1);
    });

    it("blocks a banned email using the hash written by the database", async () => {
      const s = await signUp();
      const anon = await admin.query(
        `insert into profiles (kind, university_id, handle) values ('anonymous', $1, 'quiet_fox_1') returning id`,
        [universityId],
      );
      await admin.query(
        `insert into identity.anonymous_links (account_id, anon_profile_enc, anon_blind_index)
         values ($1, '\\xdead', '\\xbeef')`,
        [s.account.id],
      );
      expect(anon.rowCount).toBe(1);
      const action = await admin.query(
        `insert into moderation.actions (kind, moderator) values ('ban', 'mod-1') returning id`,
      );
      await admin.query(`select identity.apply_penalty_for_profile('\\xbeef', 'ban', $1)`, [
        action.rows[0].id,
      ]);

      expect(await authStore.isEmailBanned(hashEmail(EMAIL))).toBe(true);
      const before = mailer.codes.length;
      await expect(auth.requestSignup(EMAIL)).resolves.toBeUndefined();
      expect(mailer.codes).toHaveLength(before);
    });
  });

  describe("re-verification, closure and purge (PgLifecycleStore, account_lifecycle role)", () => {
    it("marks overdue accounts read-only, then closes them after the grace period", async () => {
      const s = await signUp();
      const postId = await addPost(s.profile.id, "hello");

      advance(366 * DAY);
      const first = await runLifecycleSweep(lifecycle, SWEEP, clock.now);
      expect(first.markedReadOnly).toBe(1);
      expect((await auth.authenticate(s.sessionToken)).status).toBe("read_only");

      advance(31 * DAY);
      const second = await runLifecycleSweep(lifecycle, SWEEP, clock.now);
      expect(second.closed).toBe(1);

      const acc = await admin.query(`select status, closed_reason from accounts where id = $1`, [
        s.account.id,
      ]);
      expect(acc.rows[0]).toMatchObject({
        status: "closed",
        closed_reason: "reverification_expired",
      });
      const post = await admin.query(`select deleted_at from posts where id = $1`, [postId]);
      expect(post.rows[0].deleted_at).not.toBeNull();
      await expect(auth.authenticate(s.sessionToken)).rejects.toMatchObject({
        code: "unauthorized",
      });
    });

    it("lets a read-only student re-verify and return to active", async () => {
      const s = await signUp();
      advance(366 * DAY);
      await runLifecycleSweep(lifecycle, SWEEP, clock.now);

      await account.requestReverify(s.sessionToken);
      const out = await account.verifyReverify(s.sessionToken, mailer.lastCode(EMAIL));
      expect(out.status).toBe("active");

      const acc = await admin.query(`select status, reverify_due_at from accounts where id = $1`, [
        s.account.id,
      ]);
      expect(acc.rows[0].status).toBe("active");
      expect(new Date(acc.rows[0].reverify_due_at).getTime()).toBeGreaterThan(
        clock.now.getTime() + 360 * DAY,
      );
    });

    it("closes on request with a code and ends the session", async () => {
      const s = await signUp();
      await account.requestClose(s.sessionToken);
      await account.confirmClose(s.sessionToken, mailer.lastCode(EMAIL));

      const acc = await admin.query(`select status, closed_reason from accounts where id = $1`, [
        s.account.id,
      ]);
      expect(acc.rows[0]).toMatchObject({ status: "closed", closed_reason: "user_request" });
      await expect(auth.authenticate(s.sessionToken)).rejects.toBeInstanceOf(AuthError);
    });

    it("purges content, profiles and links but keeps a tombstone", async () => {
      const s = await signUp();
      const other = await signUp("sam@test.ac.ke", "Sam Roe");
      await addPost(s.profile.id, "to be purged");
      const otherPost = await addPost(other.profile.id, "stays");

      await admin.query(`insert into follows values ($1, $2)`, [s.profile.id, other.profile.id]);
      await admin.query(`insert into follows values ($1, $2)`, [other.profile.id, s.profile.id]);
      await admin.query(
        `insert into comments (post_id, author_profile_id, body) values ($1, $2, 'c')`,
        [otherPost, s.profile.id],
      );
      await admin.query(
        `insert into notifications (profile_id, kind) values ($1, 'x')`,
        [s.profile.id],
      );

      await account.requestClose(s.sessionToken);
      await account.confirmClose(s.sessionToken, mailer.lastCode(EMAIL));
      advance(31 * DAY);
      const r = await runLifecycleSweep(lifecycle, SWEEP, clock.now);
      expect(r.purged).toBe(1);

      const count = async (sql: string, args: unknown[] = []) =>
        (await admin.query(sql, args)).rows[0].n as number;
      expect(await count(`select count(*)::int n from profiles where id = $1`, [s.profile.id])).toBe(0);
      expect(
        await count(`select count(*)::int n from posts where author_profile_id = $1`, [s.profile.id]),
      ).toBe(0);
      expect(await count(`select count(*)::int n from follows`)).toBe(0);
      expect(await count(`select count(*)::int n from comments`)).toBe(0);
      expect(await count(`select count(*)::int n from notifications`)).toBe(0);
      expect(
        await count(`select count(*)::int n from sessions where account_id = $1`, [s.account.id]),
      ).toBe(0);
      expect(
        await count(`select count(*)::int n from email_codes where email = $1`, [EMAIL]),
      ).toBe(0);

      expect(await count(`select count(*)::int n from posts where id = $1`, [otherPost])).toBe(1);
      expect(
        await count(`select count(*)::int n from profiles where id = $1`, [other.profile.id]),
      ).toBe(1);

      const tomb = await admin.query(
        `select email, date_of_birth, purged_at, status from accounts where id = $1`,
        [s.account.id],
      );
      expect(tomb.rows[0].email).toBe(`closed-${s.account.id}@purged.invalid`);
      expect(tomb.rows[0].date_of_birth).toBeNull();
      expect(tomb.rows[0].purged_at).not.toBeNull();
      expect(tomb.rows[0].status).toBe("closed");

      const again = await runLifecycleSweep(lifecycle, SWEEP, clock.now);
      expect(again.purged).toBe(0);
    });

    it("keeps moderation records referencing a purged account", async () => {
      const s = await signUp();
      const reporter = await signUp("sam@test.ac.ke", "Sam Roe");
      const postId = await addPost(s.profile.id, "reported");
      await admin.query(
        `insert into moderation.reports (target_kind, target_id, reason, reporter_account_id)
         values ('post', $1, 'harassment', $2)`,
        [postId, reporter.account.id],
      );
      await admin.query(
        `insert into moderation.appeals (account_id, message) values ($1, 'please review')`,
        [s.account.id],
      );

      await account.requestClose(s.sessionToken);
      await account.confirmClose(s.sessionToken, mailer.lastCode(EMAIL));
      advance(31 * DAY);
      await runLifecycleSweep(lifecycle, SWEEP, clock.now);

      const appeals = await admin.query(`select count(*)::int n from moderation.appeals`);
      expect(appeals.rows[0].n).toBe(1);
    });

    it("exports account, profile and posts as JSON", async () => {
      const s = await signUp();
      await addPost(s.profile.id, "hello campus");
      const data = await account.exportData(s.sessionToken);

      expect(data.account.email).toBe(EMAIL);
      expect(data.account.dateOfBirth).toBe("2004-05-01");
      expect(data.profiles).toHaveLength(1);
      expect(data.posts).toEqual([
        expect.objectContaining({
          profile: "known",
          body: "hello campus",
          photos: [expect.objectContaining({ url: expect.stringMatching(/^\/photos\//) })],
        }),
      ]);
    });

    it("refuses to close or export an account with an anonymous link and no resolver", async () => {
      const s = await signUp();
      await admin.query(
        `insert into identity.anonymous_links (account_id, anon_profile_enc, anon_blind_index)
         values ($1, '\\x01', '\\x02')`,
        [s.account.id],
      );

      await expect(account.exportData(s.sessionToken)).rejects.toMatchObject({
        code: "not_available",
      });
      await account.requestClose(s.sessionToken);
      await expect(
        account.confirmClose(s.sessionToken, mailer.lastCode(EMAIL)),
      ).rejects.toMatchObject({ code: "not_available" });

      const acc = await admin.query(`select status from accounts where id = $1`, [s.account.id]);
      expect(acc.rows[0].status).toBe("active");
    });
  });

  describe("role privileges", () => {
    it("auth_service cannot read or delete content", async () => {
      await expect(authPool.query(`select * from posts`)).rejects.toThrow(/permission denied/);
      await expect(authPool.query(`delete from profiles`)).rejects.toThrow(/permission denied/);
    });

    it("auth_service can look up an account's anonymous link but never reverse it", async () => {
      const s = await signUp();
      await admin.query(
        `insert into identity.anonymous_links (account_id, anon_profile_enc, anon_blind_index)
         values ($1, '\\x01', '\\x02')`,
        [s.account.id],
      );

      const forward = await authPool.query(
        `select anon_profile_enc from identity.anonymous_links where account_id = $1`,
        [s.account.id],
      );
      expect(forward.rowCount).toBe(1);

      await expect(
        authPool.query(`select account_id from identity.anonymous_links where anon_blind_index = '\\x02'`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        authPool.query(`select anon_blind_index from identity.anonymous_links`),
      ).rejects.toThrow(/permission denied/);
      await expect(authPool.query(`select * from identity.anonymous_links`)).rejects.toThrow(
        /permission denied/,
      );
    });

    it("account_lifecycle cannot reverse-look-up anonymous links either", async () => {
      await expect(
        lifePool.query(`select account_id from identity.anonymous_links where anon_blind_index = '\\x02'`),
      ).rejects.toThrow(/permission denied/);
    });

    it("account_lifecycle cannot touch the unmask audit log", async () => {
      await expect(lifePool.query(`select * from identity.lookup_audit`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(lifePool.query(`select * from moderation.reports`)).rejects.toThrow(
        /permission denied/,
      );
    });

    it("account_lifecycle cannot create accounts or sessions", async () => {
      await expect(
        lifePool.query(
          `insert into sessions (account_id, refresh_hash, expires_at) values (gen_random_uuid(), '\\x01', now())`,
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
