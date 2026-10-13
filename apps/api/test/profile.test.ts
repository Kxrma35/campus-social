import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { DEFAULT_PROFILE_OPTIONS, ProfileService } from "../src/profile/service.js";
import { CapturingMailer, MemoryAuthStore } from "./helpers/memoryStore.js";

const here = dirname(fileURLToPath(import.meta.url));
const DAY = 24 * 60 * 60 * 1000;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}

interface World {
  db: MemoryAuthStore;
  mailer: CapturingMailer;
  auth: AuthService;
  profile: ProfileService;
  clock: { now: Date };
  token: string;
  accountId: string;
  profileId: string;
}

async function world(): Promise<World> {
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
  const profile = new ProfileService(auth, db, DEFAULT_PROFILE_OPTIONS, () => clock.now);

  await auth.requestSignup("jane@test.ac.ke");
  const s = await auth.verifySignup({
    email: "jane@test.ac.ke",
    code: mailer.lastCode("jane@test.ac.ke"),
    dateOfBirth: "2004-05-01",
    displayName: "Jane Doe",
    course: "Computer Science",
    studyYear: 2,
  });
  return {
    db,
    mailer,
    auth,
    profile,
    clock,
    token: s.sessionToken,
    accountId: s.account.id,
    profileId: s.profile.id,
  };
}

describe("correcting profile details (G4)", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  it("returns the current details", async () => {
    const p = await w.profile.get(w.token);
    expect(p).toMatchObject({
      profileId: w.profileId,
      displayName: "Jane Doe",
      course: "Computer Science",
      studyYear: 2,
    });
    expect(p.handle).toMatch(/^jane_doe_\d{4}$/);
  });

  it("changes the name and refreshes the handle so the old name stops showing", async () => {
    const before = await w.profile.get(w.token);
    const after = await w.profile.update(w.token, { displayName: "  Janet   Mwangi " });

    expect(after.displayName).toBe("Janet Mwangi");
    expect(after.handle).toMatch(/^janet_mwangi_\d{4}$/);
    expect(after.handle).not.toBe(before.handle);
    expect(after.handle).not.toContain("doe");
    expect(after.course).toBe("Computer Science");
  });

  it("leaves the handle alone when only course or year change", async () => {
    const before = await w.profile.get(w.token);
    const after = await w.profile.update(w.token, { course: "Law", studyYear: 3 });
    expect(after).toMatchObject({ course: "Law", studyYear: 3, handle: before.handle });
  });

  it("can clear the course and the year", async () => {
    const a = await w.profile.update(w.token, { course: null, studyYear: null });
    expect(a).toMatchObject({ course: null, studyYear: null });
    const b = await w.profile.update(w.token, { course: "   " });
    expect(b.course).toBeNull();
  });

  it("does not use up the allowance when nothing actually changes", async () => {
    for (let i = 0; i < 10; i += 1) {
      await w.profile.update(w.token, { displayName: "Jane Doe", course: "Computer Science" });
    }
    const p = w.db.profiles.get(w.profileId)!;
    expect(p.editsInWindow ?? 0).toBe(0);
    expect((await w.profile.update(w.token, { studyYear: 4 })).studyYear).toBe(4);
  });

  it("allows 5 real edits in 30 days, then refuses, then allows again", async () => {
    for (let year = 1; year <= 5; year += 1) {
      await w.profile.update(w.token, { studyYear: year === 2 ? 6 : year });
    }
    expect(await code(w.profile.update(w.token, { studyYear: 7 }))).toBe("too_many_edits");

    w.clock.now = new Date(w.clock.now.getTime() + 31 * DAY);
    expect(await code(w.profile.update(w.token, { studyYear: 7 }))).toBe("ok");
  });

  it("validates every field", async () => {
    expect(await code(w.profile.update(w.token, { displayName: "   " }))).toBe("invalid_name");
    expect(await code(w.profile.update(w.token, { displayName: "x".repeat(81) }))).toBe("invalid_name");
    expect(await code(w.profile.update(w.token, { studyYear: 0 }))).toBe("invalid_year");
    expect(await code(w.profile.update(w.token, { studyYear: 9 }))).toBe("invalid_year");
    expect(await code(w.profile.update(w.token, { studyYear: 2.5 }))).toBe("invalid_year");
    expect(await code(w.profile.update(w.token, { course: "x".repeat(121) }))).toBe("invalid_course");
  });

  it("retries when the regenerated handle collides", async () => {
    let calls = 0;
    const real = w.db.updateKnownProfile.bind(w.db);
    w.db.updateKnownProfile = async (input) => {
      calls += 1;
      return calls < 3 ? "handle_taken" : real(input);
    };
    const out = await w.profile.update(w.token, { displayName: "Janet Mwangi" });
    expect(calls).toBe(3);
    expect(out.displayName).toBe("Janet Mwangi");
  });

  it("works for a read-only account, since correcting your own data should not need re-verification", async () => {
    w.db.accounts.get(w.accountId)!.status = "read_only";
    const out = await w.profile.update(w.token, { course: "Medicine" });
    expect(out.course).toBe("Medicine");
  });

  it("is refused for banned, suspended and closed accounts", async () => {
    for (const status of ["banned", "suspended", "closed"] as const) {
      w.db.accounts.get(w.accountId)!.status = status;
      expect(await code(w.profile.update(w.token, { course: "x" })), status).toBe("unauthorized");
    }
  });

  it("requires a session", async () => {
    expect(await code(w.profile.get("nope"))).toBe("unauthorized");
    expect(await code(w.profile.update("nope", { course: "x" }))).toBe("unauthorized");
  });

  it("ignores a profile id smuggled into the change", async () => {
    const other = "11111111-1111-4111-8111-111111111111";
    w.db.profiles.set(other, {
      id: other,
      accountId: "someone-else",
      kind: "known",
      handle: "bob_1234",
      displayName: "Bob Student",
      deletedAt: null,
    });
    await w.profile.update(w.token, { displayName: "Janet Mwangi", profileId: other } as never);

    expect(w.db.profiles.get(other)?.displayName).toBe("Bob Student");
    expect(w.db.profiles.get(w.profileId)?.displayName).toBe("Janet Mwangi");
  });

  it("can never be pointed at an anonymous profile", async () => {
    w.db.profiles.set("anon-1", {
      id: "anon-1",
      accountId: w.accountId,
      kind: "anonymous",
      handle: "quiet_fox_1",
      displayName: null,
      deletedAt: null,
    });
    const result = await w.db.updateKnownProfile({
      profileId: "anon-1",
      now: w.clock.now,
      set: { displayName: "Jane Doe", course: "Law" },
      maxEdits: 5,
      windowDays: 30,
    });
    expect(result).toBe("not_found");
    expect(w.db.profiles.get("anon-1")?.displayName).toBeNull();
  });
});

describe("profile routes", () => {
  async function http() {
    const w = await world();
    const app = buildApp({ auth: w.auth, profile: w.profile, logger: false });
    const headers = { authorization: `Bearer ${w.token}` };
    return { w, app, headers };
  }

  it("reads and updates, with no-store caching", async () => {
    const { app, headers } = await http();

    const got = await app.inject({ method: "GET", url: "/me/profile", headers });
    expect(got.statusCode).toBe(200);
    expect(got.headers["cache-control"]).toBe("no-store");

    const patched = await app.inject({
      method: "PATCH",
      url: "/me/profile",
      headers,
      payload: { displayName: "Janet Mwangi", studyYear: 3 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ displayName: "Janet Mwangi", studyYear: 3 });
  });

  it("rejects fields a student must not edit, instead of ignoring them", async () => {
    const { app, headers, w } = await http();
    for (const payload of [
      { email: "someone@else.ac.ke" },
      { dateOfBirth: "1990-01-01" },
      { handle: "admin" },
      { status: "active" },
      { kind: "anonymous" },
      { profileId: "11111111-1111-4111-8111-111111111111" },
      { displayName: "Jane Doe", accountId: w.accountId },
    ]) {
      const res = await app.inject({ method: "PATCH", url: "/me/profile", headers, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("rejects an empty change", async () => {
    const { app, headers } = await http();
    const res = await app.inject({ method: "PATCH", url: "/me/profile", headers, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("requires a token", async () => {
    const { app } = await http();
    expect((await app.inject({ method: "GET", url: "/me/profile" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "PATCH", url: "/me/profile", payload: { course: "x" } })).statusCode,
    ).toBe(401);
  });
});

describe("profile migration (0009)", () => {
  const sql = readFileSync(join(here, "../../../db/migrations/0009_profile_edit_and_export.sql"), "utf8");

  it("the export function never selects a reporter, a free-text report detail about you, or a moderator name", () => {
    const about = sql.slice(sql.indexOf("'reportsAboutYourContent'"), sql.indexOf("'penalties'"));
    expect(about).not.toMatch(/reporter_account_id/);
    expect(about).not.toMatch(/r\.detail/);
    expect(sql).not.toMatch(/a\.moderator|resolved_by|decided_by/);
  });

  it("is granted to the lifecycle role only", () => {
    expect(sql).toMatch(/revoke all on function moderation\.export_account_records\(uuid, uuid\[\]\) from public/);
    expect(sql).toMatch(/grant execute on function moderation\.export_account_records\(uuid, uuid\[\]\)\s+to account_lifecycle/);
  });
});
