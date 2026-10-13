import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { runLifecycleSweep } from "../src/account/lifecycleStore.js";
import { AccountService } from "../src/account/service.js";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { AuthActorResolver } from "../src/content/actor.js";
import { ContentService, DEFAULT_CONTENT_OPTIONS } from "../src/content/service.js";
import { generateAnonymousIdentity } from "../src/identity/handles.js";
import { BlindIndexer, LinkCrypto } from "../src/identity/linkCrypto.js";
import {
  ANONYMITY_NOTICE,
  DEFAULT_IDENTITY_OPTIONS,
  IdentityService,
} from "../src/identity/service.js";
import {
  CapturingMailer,
  MemoryAuthStore,
  MemoryLifecycleStore,
} from "./helpers/memoryStore.js";
import { MemoryContentStore, MemoryPhotoStore } from "./helpers/memoryContent.js";

const here = dirname(fileURLToPath(import.meta.url));
const DAY = 24 * 60 * 60 * 1000;
const b64 = () => randomBytes(32).toString("base64");

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}

describe("LinkCrypto", () => {
  const k1 = b64();
  const blind = b64();
  const account = randomUUID();
  const profile = randomUUID();

  it("round-trips a profile id", () => {
    const c = new LinkCrypto(`1:${k1}`, blind);
    const { blob, keyVersion } = c.encrypt(profile, account);
    expect(keyVersion).toBe(1);
    expect(c.decrypt(blob, account)).toBe(profile);
  });

  it("never stores the profile id in the clear", () => {
    const c = new LinkCrypto(`1:${k1}`, blind);
    const { blob } = c.encrypt(profile, account);
    expect(blob.toString("latin1")).not.toContain(profile);
    expect(blob.toString("hex")).not.toContain(Buffer.from(profile).toString("hex"));
  });

  it("uses a fresh IV, so the same profile never produces the same ciphertext", () => {
    const c = new LinkCrypto(`1:${k1}`, blind);
    const a = c.encrypt(profile, account).blob;
    const b = c.encrypt(profile, account).blob;
    expect(a.equals(b)).toBe(false);
    expect(c.decrypt(a, account)).toBe(c.decrypt(b, account));
  });

  it("refuses a blob moved onto another account", () => {
    const c = new LinkCrypto(`1:${k1}`, blind);
    const { blob } = c.encrypt(profile, account);
    expect(() => c.decrypt(blob, randomUUID())).toThrow();
  });

  it("refuses a tampered blob", () => {
    const c = new LinkCrypto(`1:${k1}`, blind);
    const { blob } = c.encrypt(profile, account);
    for (const i of [0, 5, 20, blob.length - 1]) {
      const bad = Buffer.from(blob);
      bad[i] = bad[i]! ^ 0xff;
      expect(() => c.decrypt(bad, account), `byte ${i}`).toThrow();
    }
    expect(() => c.decrypt(blob.subarray(0, 10), account)).toThrow();
  });

  it("refuses to decrypt with a different key", () => {
    const a = new LinkCrypto(`1:${k1}`, blind);
    const b = new LinkCrypto(`1:${b64()}`, blind);
    const { blob } = a.encrypt(profile, account);
    expect(() => b.decrypt(blob, account)).toThrow();
  });

  it("rotates: new data uses the newest key while old data still decrypts", () => {
    const k2 = b64();
    const old = new LinkCrypto(`1:${k1}`, blind);
    const oldBlob = old.encrypt(profile, account).blob;

    const rotated = new LinkCrypto(`1:${k1}, 2:${k2}`, blind);
    expect(rotated.decrypt(oldBlob, account)).toBe(profile);

    const fresh = rotated.encrypt(profile, account);
    expect(fresh.keyVersion).toBe(2);
    expect(fresh.blob[0]).toBe(2);
    expect(rotated.decrypt(fresh.blob, account)).toBe(profile);

    const retired = new LinkCrypto(`2:${k2}`, blind);
    expect(retired.decrypt(fresh.blob, account)).toBe(profile);
    expect(() => retired.decrypt(oldBlob, account)).toThrow(/no link key for version 1/);
  });

  it("validates keys", () => {
    expect(() => new LinkCrypto(`1:${randomBytes(16).toString("base64")}`, blind)).toThrow(/32 bytes/);
    expect(() => new LinkCrypto(k1, blind)).toThrow(/must look like/);
    expect(() => new LinkCrypto(`1:${k1},1:${b64()}`, blind)).toThrow(/duplicate/);
    expect(() => new LinkCrypto("", blind)).toThrow();
    expect(() => new LinkCrypto(`1:${k1}`, randomBytes(8).toString("base64"))).toThrow(/32 bytes/);
  });

  it("derives a stable, key-dependent blind index that differs per profile", () => {
    const c = new LinkCrypto(`1:${k1}`, blind);
    const a = c.blindIndex(profile);
    expect(c.blindIndex(profile).equals(a)).toBe(true);
    expect(a).toHaveLength(32);
    expect(c.blindIndex(randomUUID()).equals(a)).toBe(false);
    expect(new LinkCrypto(`1:${k1}`, b64()).blindIndex(profile).equals(a)).toBe(false);
  });

  it("gives the admin service's BlindIndexer the same values without the encryption key", () => {
    const c = new LinkCrypto(`1:${k1}`, blind);
    const indexer = new BlindIndexer(blind);
    expect(indexer.indexFor(profile).equals(c.blindIndex(profile))).toBe(true);
  });
});

describe("generateAnonymousIdentity", () => {
  it("produces word_word_number handles and a generated avatar key", () => {
    for (let i = 0; i < 50; i += 1) {
      const id = generateAnonymousIdentity();
      expect(id.handle).toMatch(/^[a-z]+_[a-z]+_\d{4}$/);
      expect(id.avatarKey).toMatch(/^gen:\d{1,2}:\d$/);
    }
  });

  it("is not constant", () => {
    const seen = new Set(Array.from({ length: 40 }, () => generateAnonymousIdentity().handle));
    expect(seen.size).toBeGreaterThan(30);
  });
});

interface World {
  db: MemoryAuthStore;
  mailer: CapturingMailer;
  auth: AuthService;
  crypto: LinkCrypto;
  identity: IdentityService;
  clock: { now: Date };
}

function world(opts: { minAge?: number } = {}): World {
  const db = new MemoryAuthStore();
  db.universities.push({ id: "u1", name: "Test U", emailDomain: "test.ac.ke", active: true });
  const mailer = new CapturingMailer();
  const clock = { now: new Date("2026-10-12T10:00:00Z") };
  const auth = new AuthService(
    db,
    mailer,
    {
      codeHmacKey: "k".repeat(40),
      codeTtlMinutes: 10,
      maxCodesPerHour: 50,
      maxCodeAttempts: 3,
      sessionTtlDays: 400,
      termsVersion: "t",
    },
    () => clock.now,
  );
  const crypto = new LinkCrypto(`1:${b64()}`, b64());
  const identity = new IdentityService(
    auth,
    db,
    crypto,
    { ...DEFAULT_IDENTITY_OPTIONS, minAccountAgeDays: opts.minAge ?? 3 },
    () => clock.now,
  );
  return { db, mailer, auth, crypto, identity, clock };
}

async function signUp(w: World, email = "jane@test.ac.ke", name = "Jane Doe") {
  await w.auth.requestSignup(email);
  return w.auth.verifySignup({
    email,
    code: w.mailer.lastCode(email),
    dateOfBirth: "2004-05-01",
    displayName: name,
  });
}

describe("creating the anonymous profile", () => {
  let w: World;
  beforeEach(() => {
    w = world();
  });

  it("is locked while the account is new, and says when it unlocks", async () => {
    const s = await signUp(w);
    const mine = await w.identity.myProfiles(s.sessionToken);
    expect(mine.anonymousEligibility).toEqual({
      status: "locked_new_account",
      unlocksAt: "2026-10-15T10:00:00.000Z",
    });
    expect(await code(w.identity.createAnonymous(s.sessionToken, { acknowledged: true }))).toBe(
      "anonymous_locked",
    );
    expect(w.db.accounts.get(s.account.id)?.anonLink).toBeNull();
  });

  it("unlocks after a few days", async () => {
    const s = await signUp(w);
    w.clock.now = new Date(w.clock.now.getTime() + 3 * DAY);
    const mine = await w.identity.myProfiles(s.sessionToken);
    expect(mine.anonymousEligibility.status).toBe("available");
  });

  it("stays locked while the account has a warning", async () => {
    const s = await signUp(w);
    w.clock.now = new Date(w.clock.now.getTime() + 10 * DAY);
    w.db.accounts.get(s.account.id)!.strikeCount = 1;
    expect(await code(w.identity.createAnonymous(s.sessionToken, { acknowledged: true }))).toBe(
      "anonymous_locked",
    );
    expect((await w.identity.myProfiles(s.sessionToken)).anonymousEligibility.status).toBe(
      "locked_strikes",
    );
  });

  it("stays locked for read-only accounts", async () => {
    const s = await signUp(w);
    w.clock.now = new Date(w.clock.now.getTime() + 10 * DAY);
    w.db.accounts.get(s.account.id)!.status = "read_only";
    expect((await w.identity.myProfiles(s.sessionToken)).anonymousEligibility.status).toBe(
      "locked_account_state",
    );
  });

  async function unlocked() {
    const s = await signUp(w);
    w.clock.now = new Date(w.clock.now.getTime() + 4 * DAY);
    return s;
  }

  it("requires the acknowledgement to be explicitly true", async () => {
    const s = await unlocked();
    expect(await code(w.identity.createAnonymous(s.sessionToken, { acknowledged: false }))).toBe(
      "acknowledgement_required",
    );
    expect(w.db.accounts.get(s.account.id)?.anonLink).toBeNull();
  });

  it("creates the profile, shows the honest notice, and stores only an encrypted link", async () => {
    const s = await unlocked();
    const out = await w.identity.createAnonymous(s.sessionToken, { acknowledged: true });

    expect(out.notice).toBe(ANONYMITY_NOTICE);
    expect(out.notice).toContain("We can, if you seriously break the rules");
    expect(out.profile.handle).toMatch(/^[a-z]+_[a-z]+_\d{4}$/);

    const blob = w.db.accounts.get(s.account.id)!.anonLink!;
    expect(w.crypto.decrypt(blob, s.account.id)).toBe(out.profile.profileId);
    expect(blob.toString("latin1")).not.toContain(out.profile.profileId);
  });

  it("returns nothing that ties the profile to the account", async () => {
    const s = await unlocked();
    const out = await w.identity.createAnonymous(s.sessionToken, { acknowledged: true });
    const json = JSON.stringify(out);
    expect(json).not.toContain(s.account.id);
    expect(json).not.toContain(s.profile.id);
    expect(json).not.toContain("jane");
    expect(json).not.toMatch(/Jane/i);
    expect(out.profile.handle).not.toMatch(/jane|doe/i);
  });

  it("allows only one anonymous profile per account", async () => {
    const s = await unlocked();
    await w.identity.createAnonymous(s.sessionToken, { acknowledged: true });
    expect(await code(w.identity.createAnonymous(s.sessionToken, { acknowledged: true }))).toBe(
      "already_exists",
    );
    expect([...w.db.profiles.values()].filter((p) => p.kind === "anonymous")).toHaveLength(1);
  });

  it("retries when a generated handle is already taken", async () => {
    const s = await unlocked();
    let calls = 0;
    const real = w.db.createAnonymousProfile.bind(w.db);
    w.db.createAnonymousProfile = async (input) => {
      calls += 1;
      return calls < 3 ? "handle_taken" : real(input);
    };
    const out = await w.identity.createAnonymous(s.sessionToken, { acknowledged: true });
    expect(calls).toBe(3);
    expect(out.profile.profileId).toBeTruthy();
  });

  it("myProfiles lists the student's own two profiles and nothing else", async () => {
    const s = await unlocked();
    const created = await w.identity.createAnonymous(s.sessionToken, { acknowledged: true });
    const mine = await w.identity.myProfiles(s.sessionToken);

    expect(mine.known.profileId).toBe(s.profile.id);
    expect(mine.anonymous?.profileId).toBe(created.profile.profileId);
    expect(mine.anonymous?.handle).toBe(created.profile.handle);
    expect(mine.anonymousEligibility.status).toBe("exists");
    expect(mine.notice).toBe(ANONYMITY_NOTICE);
  });

  it("requires a session", async () => {
    expect(await code(w.identity.myProfiles("nope"))).toBe("unauthorized");
    expect(await code(w.identity.createAnonymous("nope", { acknowledged: true }))).toBe(
      "unauthorized",
    );
  });
});

describe("AuthActorResolver with anonymous support", () => {
  let w: World;
  beforeEach(() => {
    w = world({ minAge: 0 });
  });

  async function student() {
    const s = await signUp(w);
    const created = await w.identity.createAnonymous(s.sessionToken, { acknowledged: true });
    return { s, anonId: created.profile.profileId };
  }

  it("resolves the known profile as before", async () => {
    const { s } = await student();
    const r = new AuthActorResolver(w.auth, { store: w.db, crypto: w.crypto });
    const a = await r.resolve(s.sessionToken, "known");
    expect(a).toMatchObject({ profileId: s.profile.id, kind: "known", canWrite: true });
    expect(a.blindIndex).toBeUndefined();
  });

  it("resolves the anonymous profile from the encrypted link, with a blind index", async () => {
    const { s, anonId } = await student();
    const r = new AuthActorResolver(w.auth, { store: w.db, crypto: w.crypto });
    const a = await r.resolve(s.sessionToken, "anonymous");

    expect(a.profileId).toBe(anonId);
    expect(a.kind).toBe("anonymous");
    expect(a.blindIndex?.equals(w.crypto.blindIndex(anonId))).toBe(true);
    expect(JSON.stringify({ ...a, blindIndex: undefined })).not.toContain(s.account.id);
  });

  it("answers 404 when the student has no anonymous profile yet", async () => {
    const s = await signUp(w);
    const r = new AuthActorResolver(w.auth, { store: w.db, crypto: w.crypto });
    expect(await code(r.resolve(s.sessionToken, "anonymous"))).toBe("no_anonymous_profile");
  });

  it("answers 501 when the link keys are not configured", async () => {
    const { s } = await student();
    const r = new AuthActorResolver(w.auth);
    expect(await code(r.resolve(s.sessionToken, "anonymous"))).toBe("not_available");
    expect(await code(r.resolve(s.sessionToken, "known"))).toBe("ok");
  });

  it("cannot write while the account is read-only", async () => {
    const { s } = await student();
    w.db.accounts.get(s.account.id)!.status = "read_only";
    const r = new AuthActorResolver(w.auth, { store: w.db, crypto: w.crypto });
    expect((await r.resolve(s.sessionToken, "anonymous")).canWrite).toBe(false);
  });

  it("fails cleanly, not wrongly and not with a crash, when a link blob has been tampered with", async () => {
    const { s } = await student();
    const acc = w.db.accounts.get(s.account.id)!;
    const bad = Buffer.from(acc.anonLink!);
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 0xff;
    acc.anonLink = bad;
    const r = new AuthActorResolver(w.auth, { store: w.db, crypto: w.crypto });

    await expect(r.resolve(s.sessionToken, "anonymous")).rejects.toMatchObject({
      code: "anonymous_unavailable",
      httpStatus: 503,
    });
    await expect(r.resolve(s.sessionToken, "known")).resolves.toMatchObject({ kind: "known" });
  });

  it("degrades /me/profiles instead of failing when the link cannot be opened", async () => {
    const { s } = await student();
    const acc = w.db.accounts.get(s.account.id)!;
    const bad = Buffer.from(acc.anonLink!);
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 0xff;
    acc.anonLink = bad;

    const mine = await w.identity.myProfiles(s.sessionToken);
    expect(mine.known.profileId).toBe(s.profile.id);
    expect(mine.anonymous).toBeNull();
    expect(mine.anonymousEligibility).toEqual({ status: "unavailable" });
  });

  it("does not hand one student another student's anonymous profile", async () => {
    const a = await student();
    const bToken = (await signUp(w, "other@test.ac.ke", "Other O")).sessionToken;
    const bAcc = [...w.db.accounts.values()].find((x) => x.email === "other@test.ac.ke")!;
    bAcc.anonLink = w.db.accounts.get(a.s.account.id)!.anonLink;
    bAcc.hasAnonymousProfile = true;

    const r = new AuthActorResolver(w.auth, { store: w.db, crypto: w.crypto });
    await expect(r.resolve(bToken, "anonymous")).rejects.toThrow();
  });
});

describe("anonymous posting over HTTP", () => {
  async function stack() {
    const w = world({ minAge: 0 });
    const content = new MemoryContentStore();
    const svc = new ContentService(
      content,
      new MemoryPhotoStore(),
      DEFAULT_CONTENT_OPTIONS,
      () => w.clock.now,
    );
    const actors = new AuthActorResolver(w.auth, { store: w.db, crypto: w.crypto });
    const app = buildApp({
      auth: w.auth,
      identity: w.identity,
      content: { service: svc, actors },
      logger: false,
    });

    const alice = await signUp(w, "alice@test.ac.ke", "Alice Anderson");
    const bob = await signUp(w, "bob@test.ac.ke", "Bob Brown");
    content.addProfile({ id: alice.profile.id, handle: "alice", displayName: "Alice Anderson" });
    content.addProfile({ id: bob.profile.id, handle: "bob", displayName: "Bob Brown" });
    return { w, app, content, alice, bob };
  }

  const bearer = (t: string, extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${t}`,
    ...extra,
  });

  it("creates the profile, then posts anonymously with confirmation", async () => {
    const { app, content, alice, bob, w } = await stack();

    const made = await app.inject({
      method: "POST",
      url: "/profiles/anonymous",
      headers: bearer(alice.sessionToken),
      payload: { acknowledged: true },
    });
    expect(made.statusCode).toBe(201);
    expect(made.headers["cache-control"]).toBe("no-store");
    const anonId: string = made.json().profile.profileId;
    content.addProfile({
      id: anonId,
      kind: "anonymous",
      handle: made.json().profile.handle,
    });

    const anonHeaders = bearer(alice.sessionToken, { "x-acting-as": "anonymous" });
    const first = await app.inject({
      method: "POST",
      url: "/posts",
      headers: anonHeaders,
      payload: { body: "a secret thought" },
    });
    expect(first.statusCode).toBe(409);
    expect(first.json().error).toBe("confirmation_required");

    const posted = await app.inject({
      method: "POST",
      url: "/posts",
      headers: anonHeaders,
      payload: { body: "a secret thought", confirmedAnonymous: true },
    });
    expect(posted.statusCode).toBe(201);
    expect(posted.json().author).toMatchObject({
      kind: "anonymous",
      profileId: anonId,
      displayName: null,
    });
    expect(posted.json().createdAt).toBe("2026-10-12T10:00:00.000Z");

    const feed = await app.inject({
      method: "GET",
      url: "/feed",
      headers: bearer(bob.sessionToken),
    });
    const seen = JSON.stringify(feed.json());
    expect(seen).toContain("a secret thought");
    expect(seen).not.toContain(alice.profile.id);
    expect(seen).not.toContain(alice.account.id);
    expect(seen).not.toMatch(/alice/i);
    expect(w.db.accounts.size).toBe(2);
  });

  it("keeps a student's two profiles' notifications and follows apart", async () => {
    const { app, content, alice, bob } = await stack();
    const made = await app.inject({
      method: "POST",
      url: "/profiles/anonymous",
      headers: bearer(alice.sessionToken),
      payload: { acknowledged: true },
    });
    const anonId: string = made.json().profile.profileId;
    content.addProfile({ id: anonId, kind: "anonymous", handle: made.json().profile.handle });

    const anonPost = await app.inject({
      method: "POST",
      url: "/posts",
      headers: bearer(alice.sessionToken, { "x-acting-as": "anonymous" }),
      payload: { body: "anon", confirmedAnonymous: true },
    });
    await app.inject({
      method: "PUT",
      url: `/posts/${anonPost.json().id}/reaction`,
      headers: bearer(bob.sessionToken),
    });

    const asAnon = await app.inject({
      method: "GET",
      url: "/notifications",
      headers: bearer(alice.sessionToken, { "x-acting-as": "anonymous" }),
    });
    const asKnown = await app.inject({
      method: "GET",
      url: "/notifications",
      headers: bearer(alice.sessionToken),
    });
    expect(asAnon.json().items).toHaveLength(1);
    expect(asKnown.json().items).toHaveLength(0);
  });

  it("refuses acting as anonymous before the profile exists", async () => {
    const { app, alice } = await stack();
    const res = await app.inject({
      method: "GET",
      url: "/feed",
      headers: bearer(alice.sessionToken, { "x-acting-as": "anonymous" }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("no_anonymous_profile");
  });

  it("requires the acknowledgement field", async () => {
    const { app, alice } = await stack();
    const res = await app.inject({
      method: "POST",
      url: "/profiles/anonymous",
      headers: bearer(alice.sessionToken),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /me/profiles is no-store and only describes the caller", async () => {
    const { app, alice, bob } = await stack();
    const res = await app.inject({
      method: "GET",
      url: "/me/profiles",
      headers: bearer(alice.sessionToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(res.json())).not.toContain(bob.profile.id);
  });
});

describe("lifecycle with a configured resolver", () => {
  async function setup() {
    const w = world({ minAge: 0 });
    const lifecycle = new MemoryLifecycleStore(w.db, { canResolveAnonymous: true });
    const account = new AccountService(w.auth, w.db, lifecycle, () => w.clock.now);
    const s = await signUp(w);
    const created = await w.identity.createAnonymous(s.sessionToken, { acknowledged: true });
    const knownPost = w.db.addPostAs(s.profile.id, "known post");
    const anonPost = w.db.addPostAs(created.profile.profileId, "anon post");
    return { w, lifecycle, account, s, created, knownPost, anonPost };
  }
  const SWEEP = { reverifyGraceDays: 30, purgeAfterDays: 30 };

  it("closes, then purges, both profiles", async () => {
    const x = await setup();
    await x.account.requestClose(x.s.sessionToken);
    await x.account.confirmClose(x.s.sessionToken, x.w.mailer.lastCode("jane@test.ac.ke"));
    expect(x.knownPost.deletedAt).not.toBeNull();
    expect(x.anonPost.deletedAt).not.toBeNull();

    x.w.clock.now = new Date(x.w.clock.now.getTime() + 31 * DAY);
    const r = await runLifecycleSweep(x.lifecycle, SWEEP, x.w.clock.now);
    expect(r.purged).toBe(1);
    expect(r.skipped).toBe(0);
    expect(x.w.db.posts).toHaveLength(0);
    expect([...x.w.db.profiles.values()]).toHaveLength(0);
  });

  it("exports both profiles' posts", async () => {
    const x = await setup();
    const data = await x.account.exportData(x.s.sessionToken);
    expect(data.profiles.map((p) => p.kind).sort()).toEqual(["anonymous", "known"]);
    expect(data.posts.map((p) => p.body).sort()).toEqual(["anon post", "known post"]);
  });

  it("hides a banned account's anonymous content, and restores it after an upheld appeal", async () => {
    const x = await setup();
    x.w.db.setStatus("jane@test.ac.ke", "banned");

    const hide = await runLifecycleSweep(x.lifecycle, SWEEP, x.w.clock.now);
    expect(hide.hiddenBannedAnonymous).toBe(1);
    expect(x.anonPost.hidden).toBe(true);
    expect(x.anonPost.hiddenReason).toBe("account_banned");
    expect(x.w.db.profiles.get(x.created.profile.profileId)?.deletedAt).not.toBeNull();

    const again = await runLifecycleSweep(x.lifecycle, SWEEP, x.w.clock.now);
    expect(again.hiddenBannedAnonymous).toBe(0);

    x.w.db.setStatus("jane@test.ac.ke", "active");
    const restore = await runLifecycleSweep(x.lifecycle, SWEEP, x.w.clock.now);
    expect(restore.restoredAnonymous).toBe(1);
    expect(x.anonPost.hidden).toBe(false);
    expect(x.w.db.profiles.get(x.created.profile.profileId)?.deletedAt).toBeNull();
  });

  it("reports accounts it cannot resolve instead of half-handling them", async () => {
    const x = await setup();
    const blind = new MemoryLifecycleStore(x.w.db, { canResolveAnonymous: false });
    x.w.db.setStatus("jane@test.ac.ke", "banned");
    const r = await runLifecycleSweep(blind, SWEEP, x.w.clock.now);
    expect(r.skipped).toBeGreaterThan(0);
    expect(x.anonPost.hidden).toBeFalsy();
  });
});

describe("anonymous migration (0006)", () => {
  const sql = readFileSync(join(here, "../../../db/migrations/0006_anonymous.sql"), "utf8");

  it("enforces the second-approver rule in the database", () => {
    expect(sql).toMatch(/p_reason_code <> 'court_order'/);
    expect(sql).toMatch(/lower\(trim\(p_approved_by\)\) = lower\(trim\(p_actor\)\)/);
    expect(sql).toMatch(/errcode = 'TS001'/);
  });

  it("checks the approver before any lookup happens", () => {
    const approver = sql.indexOf("TS001");
    const lookup = sql.indexOf("identity.unmask_profile(\n    p_blind_index");
    expect(approver).toBeGreaterThan(0);
    expect(lookup).toBeGreaterThan(approver);
  });

  it("removes direct access to the bare unmask function from trust_safety", () => {
    expect(sql).toMatch(
      /revoke execute on function identity\.unmask_profile\(bytea, text, text, text, text, text\)\s+from trust_safety/,
    );
  });

  it("grants the wrapper to trust_safety only", () => {
    expect(sql).toMatch(/grant execute on function identity\.unmask_profile_identity[\s\S]*to trust_safety/);
    expect(sql).not.toMatch(/to (app_api|moderator|auth_service|account_lifecycle)\b[\s\S]{0,5};[\s\S]*unmask_profile_identity/);
  });

  it("does not hand the lifecycle role any access to the blind index column", () => {
    expect(sql).not.toMatch(/anon_blind_index/);
  });
});

describe("key hygiene in source", () => {
  const src = (p: string) => readFileSync(join(here, "..", "src", p), "utf8");

  it("the admin service entry point loads only the blind-index key", () => {
    const admin = src("admin/index.ts");
    expect(admin).toMatch(/LINK_BLIND_INDEX_KEY/);
    expect(admin).not.toMatch(/LINK_ENCRYPTION_KEYS/);
    expect(admin).not.toMatch(/LinkCrypto\b(?!\.)/);
  });

  it("never logs key material or ciphertext", () => {
    for (const f of ["identity/linkCrypto.ts", "identity/service.ts", "content/actor.ts"]) {
      expect(src(f), f).not.toMatch(/console\.|logger\.|app\.log/);
    }
  });
});
