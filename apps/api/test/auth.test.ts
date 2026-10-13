import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashEmail } from "../src/auth/crypto.js";
import { AuthError, AuthService, type AuthOptions } from "../src/auth/service.js";
import { CapturingMailer, MemoryAuthStore } from "./helpers/memoryStore.js";

const OPTS: AuthOptions = {
  codeHmacKey: "test-key-test-key-test-key-test-key-0123",
  codeTtlMinutes: 10,
  maxCodesPerHour: 3,
  maxCodeAttempts: 3,
  sessionTtlDays: 30,
  termsVersion: "test-v1",
};

const EMAIL = "jane@test.ac.ke";
const SIGNUP = {
  dateOfBirth: "2004-05-01",
  displayName: "Jane Doe",
  course: "Computer Science",
  studyYear: 2,
};

interface Ctx {
  store: MemoryAuthStore;
  mailer: CapturingMailer;
  auth: AuthService;
  clock: { now: Date };
}

function setup(): Ctx {
  const store = new MemoryAuthStore();
  store.universities.push({
    id: "u1",
    name: "Test University",
    emailDomain: "test.ac.ke",
    active: true,
  });
  store.universities.push({
    id: "u2",
    name: "Inactive University",
    emailDomain: "later.ac.ke",
    active: false,
  });
  const mailer = new CapturingMailer();
  const clock = { now: new Date("2026-10-12T10:00:00Z") };
  const auth = new AuthService(store, mailer, OPTS, () => clock.now);
  return { store, mailer, auth, clock };
}

async function expectAuthError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AuthError);
  await expect(p).rejects.toMatchObject({ code });
}

describe("sign-up", () => {
  let c: Ctx;
  beforeEach(() => {
    c = setup();
  });

  it("creates an account, known profile and session with a valid code", async () => {
    await c.auth.requestSignup(EMAIL);
    const result = await c.auth.verifySignup({
      email: EMAIL,
      code: c.mailer.lastCode(EMAIL),
      ...SIGNUP,
    });

    expect(result.account.status).toBe("active");
    expect(result.sessionToken.length).toBeGreaterThan(30);
    expect(c.store.accounts.size).toBe(1);
    expect(c.store.profiles.size).toBe(1);

    const ctx = await c.auth.authenticate(result.sessionToken);
    expect(ctx.accountId).toBe(result.account.id);
    expect(ctx.knownProfileId).toBe(result.profile.id);
  });

  it("normalises the email case", async () => {
    await c.auth.requestSignup("  JANE@Test.AC.KE ");
    expect(c.mailer.codes[0]?.to).toBe(EMAIL);
  });

  it("rejects domains that are not on the allowlist", async () => {
    await expectAuthError(c.auth.requestSignup("a@gmail.com"), "university_not_supported");
    expect(c.mailer.codes).toHaveLength(0);
  });

  it("rejects universities that exist but are not active", async () => {
    await expectAuthError(c.auth.requestSignup("a@later.ac.ke"), "university_not_supported");
  });

  it("stores only a hash of the code and never keeps it in plaintext", async () => {
    await c.auth.requestSignup(EMAIL);
    const code = c.mailer.lastCode(EMAIL);
    const row = c.store.codes[0];
    expect(row?.codeHash.toString("utf8")).not.toContain(code);
    expect(row?.codeHash.length).toBe(32);
  });

  it("rejects under-18s without consuming the code or creating anything", async () => {
    await c.auth.requestSignup(EMAIL);
    const code = c.mailer.lastCode(EMAIL);
    await expectAuthError(
      c.auth.verifySignup({ email: EMAIL, code, ...SIGNUP, dateOfBirth: "2010-01-01" }),
      "must_be_18",
    );
    expect(c.store.accounts.size).toBe(0);
    expect(c.store.codes[0]?.consumed).toBe(false);
  });

  it("rejects an invalid date of birth", async () => {
    await c.auth.requestSignup(EMAIL);
    await expectAuthError(
      c.auth.verifySignup({
        email: EMAIL,
        code: c.mailer.lastCode(EMAIL),
        ...SIGNUP,
        dateOfBirth: "2004-02-31",
      }),
      "invalid_date_of_birth",
    );
  });

  it("rejects a wrong code", async () => {
    await c.auth.requestSignup(EMAIL);
    const wrong = c.mailer.lastCode(EMAIL) === "000000" ? "000001" : "000000";
    await expectAuthError(
      c.auth.verifySignup({ email: EMAIL, code: wrong, ...SIGNUP }),
      "invalid_code",
    );
    expect(c.store.accounts.size).toBe(0);
  });

  it("locks a code after too many wrong guesses, even if the right one follows", async () => {
    await c.auth.requestSignup(EMAIL);
    const right = c.mailer.lastCode(EMAIL);
    const wrong = right === "000000" ? "000001" : "000000";
    for (let i = 0; i < OPTS.maxCodeAttempts; i += 1) {
      await expectAuthError(
        c.auth.verifySignup({ email: EMAIL, code: wrong, ...SIGNUP }),
        "invalid_code",
      );
    }
    await expectAuthError(
      c.auth.verifySignup({ email: EMAIL, code: right, ...SIGNUP }),
      "too_many_attempts",
    );
  });

  it("rejects an expired code (10 minute lifetime)", async () => {
    await c.auth.requestSignup(EMAIL);
    const code = c.mailer.lastCode(EMAIL);
    c.clock.now = new Date(c.clock.now.getTime() + 10 * 60 * 1000 + 1000);
    await expectAuthError(c.auth.verifySignup({ email: EMAIL, code, ...SIGNUP }), "code_expired");
  });

  it("does not allow a code to be used twice", async () => {
    await c.auth.requestSignup(EMAIL);
    const code = c.mailer.lastCode(EMAIL);
    await c.auth.verifySignup({ email: EMAIL, code, ...SIGNUP });
    await expectAuthError(
      c.auth.verifySignup({ email: EMAIL, code, ...SIGNUP, displayName: "Someone Else" }),
      "invalid_code",
    );
    expect(c.store.accounts.size).toBe(1);
  });

  it("silently sends nothing for a banned email", async () => {
    c.store.bannedHashes.push(hashEmail(EMAIL));
    await expect(c.auth.requestSignup(EMAIL)).resolves.toBeUndefined();
    expect(c.mailer.codes).toHaveLength(0);
    expect(c.mailer.alreadyRegistered).toHaveLength(0);
  });

  it("tells an existing user to log in instead of sending a sign-up code", async () => {
    await c.auth.requestSignup(EMAIL);
    await c.auth.verifySignup({ email: EMAIL, code: c.mailer.lastCode(EMAIL), ...SIGNUP });
    const sent = c.mailer.codes.length;

    await expect(c.auth.requestSignup(EMAIL)).resolves.toBeUndefined();
    expect(c.mailer.alreadyRegistered).toEqual([EMAIL]);
    expect(c.mailer.codes).toHaveLength(sent);
  });

  it("limits how many codes can be requested per hour", async () => {
    for (let i = 0; i < OPTS.maxCodesPerHour; i += 1) await c.auth.requestSignup(EMAIL);
    await expectAuthError(c.auth.requestSignup(EMAIL), "too_many_requests");
  });
});

describe("login and sessions", () => {
  let c: Ctx;
  beforeEach(async () => {
    c = setup();
    await c.auth.requestSignup(EMAIL);
    await c.auth.verifySignup({ email: EMAIL, code: c.mailer.lastCode(EMAIL), ...SIGNUP });
  });

  it("logs in with a one-time code", async () => {
    await c.auth.requestLogin(EMAIL);
    const session = await c.auth.verifyLogin(EMAIL, c.mailer.lastCode(EMAIL));
    const ctx = await c.auth.authenticate(session.sessionToken);
    expect(ctx.accountId).toBe(session.account.id);
  });

  it("does not reveal whether an address has an account", async () => {
    const before = c.mailer.codes.length;
    await expect(c.auth.requestLogin("nobody@test.ac.ke")).resolves.toBeUndefined();
    expect(c.mailer.codes).toHaveLength(before);
  });

  it("does not issue login codes to banned or closed accounts", async () => {
    c.store.setStatus(EMAIL, "banned");
    const before = c.mailer.codes.length;
    await c.auth.requestLogin(EMAIL);
    expect(c.mailer.codes).toHaveLength(before);
  });

  it("cannot use a sign-up code to log in", async () => {
    const other = "other@test.ac.ke";
    await c.auth.requestSignup(other);
    await expectAuthError(c.auth.verifyLogin(other, c.mailer.lastCode(other)), "invalid_code");
  });

  it("blocks suspended accounts from signing in", async () => {
    await c.auth.requestLogin(EMAIL);
    const code = c.mailer.lastCode(EMAIL);
    c.store.setStatus(EMAIL, "suspended");
    await expectAuthError(c.auth.verifyLogin(EMAIL, code), "account_suspended");
  });

  it("ends a session on logout", async () => {
    await c.auth.requestLogin(EMAIL);
    const session = await c.auth.verifyLogin(EMAIL, c.mailer.lastCode(EMAIL));
    await c.auth.logout(session.sessionToken);
    await expectAuthError(c.auth.authenticate(session.sessionToken), "unauthorized");
  });

  it("expires sessions after the configured lifetime", async () => {
    await c.auth.requestLogin(EMAIL);
    const session = await c.auth.verifyLogin(EMAIL, c.mailer.lastCode(EMAIL));
    c.clock.now = new Date(c.clock.now.getTime() + 31 * 24 * 60 * 60 * 1000);
    await expectAuthError(c.auth.authenticate(session.sessionToken), "unauthorized");
  });

  it("cuts off a live session when the account is banned", async () => {
    await c.auth.requestLogin(EMAIL);
    const session = await c.auth.verifyLogin(EMAIL, c.mailer.lastCode(EMAIL));
    c.store.setStatus(EMAIL, "banned");
    await expectAuthError(c.auth.authenticate(session.sessionToken), "unauthorized");
  });
});

describe("HTTP layer", () => {
  let c: Ctx;
  beforeEach(() => {
    c = setup();
  });

  const post = (app: ReturnType<typeof buildApp>, url: string, payload: unknown) =>
    app.inject({ method: "POST", url, payload: payload as object });

  it("returns the same body for registered and unregistered login requests", async () => {
    const app = buildApp({ auth: c.auth, logger: false });
    await post(app, "/auth/signup/request", { email: EMAIL });
    await post(app, "/auth/signup/verify", {
      email: EMAIL,
      code: c.mailer.lastCode(EMAIL),
      confirmAge18: true,
      acceptTerms: true,
      ...SIGNUP,
    });

    const known = await post(app, "/auth/login/request", { email: EMAIL });
    const unknown = await post(app, "/auth/login/request", { email: "ghost@test.ac.ke" });
    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.body).toBe(unknown.body);
  });

  it("requires explicit age confirmation and terms acceptance", async () => {
    const app = buildApp({ auth: c.auth, logger: false });
    await post(app, "/auth/signup/request", { email: EMAIL });
    const res = await post(app, "/auth/signup/verify", {
      email: EMAIL,
      code: c.mailer.lastCode(EMAIL),
      confirmAge18: false,
      acceptTerms: true,
      ...SIGNUP,
    });
    expect(res.statusCode).toBe(400);
    expect(c.store.accounts.size).toBe(0);
  });

  it("returns 401 from /me without a valid token", async () => {
    const app = buildApp({ auth: c.auth, logger: false });
    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
    const bad = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: "Bearer nope" },
    });
    expect(bad.statusCode).toBe(401);
  });

  it("completes sign-up and reads /me with the issued token", async () => {
    const app = buildApp({ auth: c.auth, logger: false });
    await post(app, "/auth/signup/request", { email: EMAIL });
    const created = await post(app, "/auth/signup/verify", {
      email: EMAIL,
      code: c.mailer.lastCode(EMAIL),
      confirmAge18: true,
      acceptTerms: true,
      ...SIGNUP,
    });
    expect(created.statusCode).toBe(201);
    const { sessionToken } = created.json();

    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().account.status).toBe("active");
  });

  it("never exposes the date of birth or email hash in responses", async () => {
    const app = buildApp({ auth: c.auth, logger: false });
    await post(app, "/auth/signup/request", { email: EMAIL });
    const created = await post(app, "/auth/signup/verify", {
      email: EMAIL,
      code: c.mailer.lastCode(EMAIL),
      confirmAge18: true,
      acceptTerms: true,
      ...SIGNUP,
    });
    expect(created.body).not.toContain(SIGNUP.dateOfBirth);
  });
});
