import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { AccountService } from "../src/account/service.js";
import { runLifecycleSweep } from "../src/account/lifecycleStore.js";
import { AuthError, AuthService, type AuthOptions } from "../src/auth/service.js";
import {
  CapturingMailer,
  MemoryAuthStore,
  MemoryLifecycleStore,
} from "./helpers/memoryStore.js";

const OPTS: AuthOptions = {
  codeHmacKey: "test-key-test-key-test-key-test-key-0123",
  codeTtlMinutes: 10,
  maxCodesPerHour: 10,
  maxCodeAttempts: 3,
  sessionTtlDays: 400,
  termsVersion: "test-v1",
};
const SWEEP = { reverifyGraceDays: 30, purgeAfterDays: 30 };
const DAY = 24 * 60 * 60 * 1000;

const EMAIL = "jane@test.ac.ke";
const SIGNUP = { dateOfBirth: "2004-05-01", displayName: "Jane Doe" };

interface Ctx {
  db: MemoryAuthStore;
  mailer: CapturingMailer;
  auth: AuthService;
  account: AccountService;
  lifecycle: MemoryLifecycleStore;
  clock: { now: Date };
  token: string;
  accountId: string;
}

async function setup(): Promise<Ctx> {
  const db = new MemoryAuthStore();
  db.universities.push({ id: "u1", name: "Test U", emailDomain: "test.ac.ke", active: true });
  const mailer = new CapturingMailer();
  const clock = { now: new Date("2026-10-12T10:00:00Z") };
  const auth = new AuthService(db, mailer, OPTS, () => clock.now);
  const lifecycle = new MemoryLifecycleStore(db);
  const account = new AccountService(auth, db, lifecycle, () => clock.now);

  await auth.requestSignup(EMAIL);
  const session = await auth.verifySignup({
    email: EMAIL,
    code: mailer.lastCode(EMAIL),
    ...SIGNUP,
  });
  return {
    db,
    mailer,
    auth,
    account,
    lifecycle,
    clock,
    token: session.sessionToken,
    accountId: session.account.id,
  };
}

const advance = (c: Ctx, ms: number) => {
  c.clock.now = new Date(c.clock.now.getTime() + ms);
};

async function expectAuthError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AuthError);
  await expect(p).rejects.toMatchObject({ code });
}

describe("annual re-verification", () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
  });

  it("sets the first due date one year after sign-up", () => {
    expect(c.db.accountByEmail(EMAIL).reverifyDueAt.toISOString()).toBe(
      "2027-10-12T10:00:00.000Z",
    );
  });

  it("leaves accounts alone before the due date", async () => {
    advance(c, 364 * DAY);
    const r = await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);
    expect(r).toEqual({
      hiddenBannedAnonymous: 0,
      restoredAnonymous: 0,
      liftedSuspensions: 0,
      markedReadOnly: 0,
      closed: 0,
      purged: 0,
      purgedPosts: 0,
      purgedComments: 0,
      expiredCodes: 1,
      expiredSessions: 0,
      staleUploads: 0,
      warningsExpired: 0,
      reportsPurged: 0,
      actionsPurged: 0,
      penaltiesPurged: 0,
      appealsScrubbed: 0,
      auditRowsPurged: 0,
      filesDeleted: 0,
      filesFailed: 0,
      filesPending: 0,
      skipped: 0,
    });
    expect(c.db.accountByEmail(EMAIL).status).toBe("active");
  });

  it("makes an overdue account read-only", async () => {
    advance(c, 366 * DAY);
    const r = await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);
    expect(r.markedReadOnly).toBe(1);
    expect(c.db.accountByEmail(EMAIL).status).toBe("read_only");
  });

  it("lets a read-only student sign in and restore access with a code", async () => {
    advance(c, 366 * DAY);
    await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);

    await c.account.requestReverify(c.token);
    const out = await c.account.verifyReverify(c.token, c.mailer.lastCode(EMAIL));

    expect(out.status).toBe("active");
    expect(c.db.accountByEmail(EMAIL).status).toBe("active");
    expect(new Date(out.reverifyDueAt).getTime()).toBeGreaterThan(c.clock.now.getTime() + 360 * DAY);
  });

  it("does not close a re-verified account when the old grace period would have ended", async () => {
    advance(c, 366 * DAY);
    await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);
    await c.account.requestReverify(c.token);
    await c.account.verifyReverify(c.token, c.mailer.lastCode(EMAIL));

    advance(c, 60 * DAY);
    const r = await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);
    expect(r.closed).toBe(0);
    expect(c.db.accountByEmail(EMAIL).status).toBe("active");
  });

  it("rejects a wrong re-verification code", async () => {
    await c.account.requestReverify(c.token);
    const right = c.mailer.lastCode(EMAIL);
    const wrong = right === "000000" ? "000001" : "000000";
    await expectAuthError(c.account.verifyReverify(c.token, wrong), "invalid_code");
  });

  it("requires a signed-in session", async () => {
    await expectAuthError(c.account.requestReverify("not-a-token"), "unauthorized");
  });

  it("closes the account once the grace period has passed", async () => {
    advance(c, 366 * DAY);
    await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);
    const post = c.db.addPost(c.accountId, "hello");

    advance(c, 31 * DAY);
    const r = await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);

    const acc = c.db.accountByEmail(EMAIL);
    expect(r.closed).toBe(1);
    expect(acc.status).toBe("closed");
    expect(acc.closedReason).toBe("reverification_expired");
    expect(post.deletedAt).not.toBeNull();
    await expectAuthError(c.auth.authenticate(c.token), "unauthorized");
  });

  it("is idempotent", async () => {
    advance(c, 366 * DAY);
    await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);
    const again = await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);
    expect(again).toEqual({
      hiddenBannedAnonymous: 0,
      restoredAnonymous: 0,
      liftedSuspensions: 0,
      markedReadOnly: 0,
      closed: 0,
      purged: 0,
      purgedPosts: 0,
      purgedComments: 0,
      expiredCodes: 0,
      expiredSessions: 0,
      staleUploads: 0,
      warningsExpired: 0,
      reportsPurged: 0,
      actionsPurged: 0,
      penaltiesPurged: 0,
      appealsScrubbed: 0,
      auditRowsPurged: 0,
      filesDeleted: 0,
      filesFailed: 0,
      filesPending: 0,
      skipped: 0,
    });
  });
});

describe("account closure on request", () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
  });

  it("needs a fresh code, not just a session", async () => {
    await expectAuthError(c.account.confirmClose(c.token, "123456"), "invalid_code");
    expect(c.db.accountByEmail(EMAIL).status).toBe("active");
  });

  it("does not accept a login code for closing", async () => {
    await c.auth.requestLogin(EMAIL);
    const loginCode = c.mailer.lastCode(EMAIL);
    await expectAuthError(c.account.confirmClose(c.token, loginCode), "invalid_code");
    expect(c.db.accountByEmail(EMAIL).status).toBe("active");
  });

  it("closes the account, ends sessions and removes content from view at once", async () => {
    const post = c.db.addPost(c.accountId, "my post");
    await c.account.requestClose(c.token);
    await c.account.confirmClose(c.token, c.mailer.lastCode(EMAIL));

    const acc = c.db.accountByEmail(EMAIL);
    expect(acc.status).toBe("closed");
    expect(acc.closedReason).toBe("user_request");
    expect(post.deletedAt).not.toBeNull();
    await expectAuthError(c.auth.authenticate(c.token), "unauthorized");
  });

  it("stops login codes being issued after closure", async () => {
    await c.account.requestClose(c.token);
    await c.account.confirmClose(c.token, c.mailer.lastCode(EMAIL));
    const before = c.mailer.codes.length;
    await c.auth.requestLogin(EMAIL);
    expect(c.mailer.codes).toHaveLength(before);
  });

  it("refuses to close an account with an anonymous profile until that is supported", async () => {
    c.db.accountByEmail(EMAIL).hasAnonymousProfile = true;
    await c.account.requestClose(c.token);
    await expectAuthError(c.account.confirmClose(c.token, c.mailer.lastCode(EMAIL)), "not_available");
    expect(c.db.accountByEmail(EMAIL).status).toBe("active");
  });
});

describe("purge", () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
    c.db.addPost(c.accountId, "to be purged");
    await c.account.requestClose(c.token);
    await c.account.confirmClose(c.token, c.mailer.lastCode(EMAIL));
  });

  it("keeps closed accounts until the purge window has passed", async () => {
    advance(c, 29 * DAY);
    const r = await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);
    expect(r.purged).toBe(0);
    expect(c.db.posts).toHaveLength(1);
  });

  it("deletes content and personal data after the window, leaving only a tombstone", async () => {
    const id = c.accountId;
    advance(c, 31 * DAY);
    const r = await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);

    expect(r.purged).toBe(1);
    expect(c.db.posts).toHaveLength(0);
    expect(c.db.profiles.size).toBe(0);

    const acc = c.db.accounts.get(id);
    expect(acc?.email).toBe(`closed-${id}@purged.invalid`);
    expect(acc?.dateOfBirth).toBeNull();
    expect(acc?.purgedAt).not.toBeNull();
  });

  it("does not purge twice", async () => {
    advance(c, 31 * DAY);
    await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);
    const again = await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);
    expect(again.purged).toBe(0);
  });

  it("skips, and reports, accounts it cannot fully resolve", async () => {
    c.db.accountByEmail(EMAIL).hasAnonymousProfile = true;
    advance(c, 31 * DAY);
    const r = await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);
    expect(r.purged).toBe(0);
    expect(r.skipped).toBe(1);

    const acc = c.db.accountByEmail(EMAIL);
    expect(acc.purgedAt).toBeNull();
    expect(acc.email).toBe(EMAIL);
    expect([...c.db.profiles.values()].some((p) => p.accountId === acc.id)).toBe(true);

    expect(r.purgedPosts).toBe(1);
  });
});

describe("data export", () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
  });

  it("returns the account, profile and posts", async () => {
    c.db.addPost(c.accountId, "hello campus");
    const data = await c.account.exportData(c.token);
    expect(data.account.email).toBe(EMAIL);
    expect(data.profiles).toHaveLength(1);
    expect(data.posts.map((p) => p.body)).toEqual(["hello campus"]);
  });

  it("is available during the read-only grace period (graduates)", async () => {
    advance(c, 366 * DAY);
    await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);
    const data = await c.account.exportData(c.token);
    expect(data.account.status).toBe("read_only");
  });

  it("never returns a partial export for an account with an anonymous profile", async () => {
    c.db.accountByEmail(EMAIL).hasAnonymousProfile = true;
    await expectAuthError(c.account.exportData(c.token), "not_available");
  });

  it("requires a session", async () => {
    await expectAuthError(c.account.exportData("nope"), "unauthorized");
  });
});

describe("HTTP layer", () => {
  it("serves export with no-store and an attachment header", async () => {
    const c = await setup();
    const app = buildApp({ auth: c.auth, account: c.account, logger: false });
    const res = await app.inject({
      method: "GET",
      url: "/account/export",
      headers: { authorization: `Bearer ${c.token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-disposition"]).toContain("attachment");
  });

  it("requires a bearer token on account routes", async () => {
    const c = await setup();
    const app = buildApp({ auth: c.auth, account: c.account, logger: false });
    const res = await app.inject({ method: "POST", url: "/account/close/request" });
    expect(res.statusCode).toBe(401);
  });

  it("closes through the API end to end", async () => {
    const c = await setup();
    const app = buildApp({ auth: c.auth, account: c.account, logger: false });
    const headers = { authorization: `Bearer ${c.token}` };

    const req = await app.inject({ method: "POST", url: "/account/close/request", headers });
    expect(req.statusCode).toBe(202);

    const done = await app.inject({
      method: "POST",
      url: "/account/close/confirm",
      headers,
      payload: { code: c.mailer.lastCode(EMAIL) },
    });
    expect(done.statusCode).toBe(204);

    const me = await app.inject({ method: "GET", url: "/me", headers });
    expect(me.statusCode).toBe(401);
  });
});
