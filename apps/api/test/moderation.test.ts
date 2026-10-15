import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { buildAdminApp } from "../src/admin/app.js";
import { AdminService, DEFAULT_ADMIN_OPTIONS, type AdminOptions } from "../src/admin/service.js";
import type {
  AdminStore,
  AppealRow,
  Moderator,
  QueueRow,
  TargetDetail,
} from "../src/admin/store.js";
import { runLifecycleSweep } from "../src/account/lifecycleStore.js";
import { hashToken } from "../src/auth/crypto.js";
import { AuthService } from "../src/auth/service.js";
import { ContentService, DEFAULT_CONTENT_OPTIONS } from "../src/content/service.js";
import type { Actor } from "../src/content/types.js";
import { buildSupportInfo, suggestsSelfHarm } from "../src/moderation/crisis.js";
import { ReportService, type FileReportInput, type ReportStore } from "../src/moderation/reports.js";
import {
  CapturingMailer,
  MemoryAuthStore,
  MemoryLifecycleStore,
} from "./helpers/memoryStore.js";
import { MemoryContentStore, MemoryPhotoStore } from "./helpers/memoryContent.js";

const here = dirname(fileURLToPath(import.meta.url));
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}

describe("self-harm phrase check", () => {
  it("flags clear statements", () => {
    for (const t of [
      "I want to die",
      "i'm going to kill myself",
      "thinking about suicide tonight",
      "I've been cutting myself",
      "nobody would care, they're better off without me",
      "I don't want to be here anymore",
      "I just can't go on",
      "self-harm again",
    ]) {
      expect(suggestsSelfHarm(t), t).toBe(true);
    }
  });

  it("leaves ordinary text alone", () => {
    for (const t of [
      "this exam is killing me, lol",
      "the new cafeteria menu is great",
      "my phone died, anyone have a charger",
      "going to the library to study",
      "that lecture was dead boring",
    ]) {
      expect(suggestsSelfHarm(t), t).toBe(false);
    }
  });

  it("never invents helpline numbers: resources come only from configuration", () => {
    expect(buildSupportInfo().resources).toEqual([]);
    const configured = buildSupportInfo([{ name: "Campus counselling", contact: "ext 100" }]);
    expect(configured.resources).toEqual([{ name: "Campus counselling", contact: "ext 100" }]);
    expect(configured.message.length).toBeGreaterThan(20);
  });
});

describe("crisis flagging on posts and comments", () => {
  function setup(hooks: { fail?: boolean } = {}) {
    const store = new MemoryContentStore();
    const flagged: { kind: string; id: string }[] = [];
    const errors: unknown[] = [];
    const svc = new ContentService(
      store,
      new MemoryPhotoStore(),
      DEFAULT_CONTENT_OPTIONS,
      () => new Date("2026-10-12T10:00:00Z"),
      {
        flagForReview: async (kind, id) => {
          if (hooks.fail) throw new Error("db down");
          flagged.push({ kind, id });
        },
        support: buildSupportInfo([{ name: "Campus counselling", contact: "ext 100" }]),
        onError: (e) => errors.push(e),
      },
    );
    const alice: Actor = {
      profileId: store.addProfile({ handle: "alice" }),
      kind: "known",
      canWrite: true,
    };
    const bob: Actor = {
      profileId: store.addProfile({ handle: "bob" }),
      kind: "known",
      canWrite: true,
    };
    return { svc, flagged, errors, alice, bob };
  }

  it("flags the post and returns support info to the author", async () => {
    const c = setup();
    const post = await c.svc.createPost(c.alice, { body: "I just want to die" });
    expect(c.flagged).toEqual([{ kind: "post", id: post.id }]);
    expect(post.support?.resources[0]?.name).toBe("Campus counselling");
  });

  it("does not flag or add support info to ordinary posts", async () => {
    const c = setup();
    const post = await c.svc.createPost(c.alice, { body: "lovely weather today" });
    expect(c.flagged).toHaveLength(0);
    expect(post.support).toBeUndefined();
  });

  it("flags comments too", async () => {
    const c = setup();
    const post = await c.svc.createPost(c.bob, { body: "how is everyone" });
    const comment = await c.svc.createComment(c.alice, post.id, "honestly I want to die");
    expect(c.flagged).toEqual([{ kind: "comment", id: comment.id }]);
    expect(comment.support).toBeDefined();
  });

  it("keeps the post and reports the error when flagging fails", async () => {
    const c = setup({ fail: true });
    const post = await c.svc.createPost(c.alice, { body: "I want to die" });
    expect(post.body).toBe("I want to die");
    expect(c.errors).toHaveLength(1);
    expect(post.support).toBeDefined();
  });

  it("applies the same check when a post is edited afterwards", async () => {
    const c = setup();
    const post = await c.svc.createPost(c.alice, { body: "lovely weather today" });
    expect(c.flagged).toHaveLength(0);

    const edited = await c.svc.editPost(c.alice, post.id, "I want to die");
    expect(c.flagged).toEqual([{ kind: "post", id: post.id }]);
    expect(edited.support?.resources[0]?.name).toBe("Campus counselling");
    expect((await c.svc.getPost(c.bob, post.id)).support).toBeUndefined();
  });

  it("does not flag an ordinary edit", async () => {
    const c = setup();
    const post = await c.svc.createPost(c.alice, { body: "first" });
    const edited = await c.svc.editPost(c.alice, post.id, "second, fixed a typo");
    expect(c.flagged).toHaveLength(0);
    expect(edited.support).toBeUndefined();
  });

  it("never exposes support info on later reads", async () => {
    const c = setup();
    const post = await c.svc.createPost(c.alice, { body: "I want to die" });
    const read = await c.svc.getPost(c.bob, post.id);
    expect(read.support).toBeUndefined();
  });
});

describe("ReportService", () => {
  function setup() {
    const filed: FileReportInput[] = [];
    const store: ReportStore = {
      fileReport: async (i) => {
        filed.push(i);
        return { isNew: true, autoHidden: false };
      },
      fileAutoFlag: async () => undefined,
    };
    return { svc: new ReportService(store), filed };
  }
  const known: Actor = { profileId: "p1", kind: "known", canWrite: true };
  const target = { targetKind: "post" as const, targetId: "t1", reason: "harassment" as const };

  it("passes the reporter profile and never an account", async () => {
    const c = setup();
    await c.svc.report(known, { ...target, detail: "  rude  " });
    expect(c.filed[0]).toMatchObject({
      reporterProfileId: "p1",
      reporterBlindIndex: null,
      detail: "rude",
    });
    expect(JSON.stringify(c.filed[0])).not.toMatch(/account/i);
  });

  it("answers identically whatever happened, so counts are not revealed", async () => {
    const a = setup();
    const first = await a.svc.report(known, target);
    const second = await a.svc.report(known, target);
    expect(first).toEqual(second);
    expect(first).toEqual({ status: "received" });
  });

  it("refuses read-only accounts", async () => {
    const c = setup();
    expect(await code(c.svc.report({ ...known, canWrite: false }, target))).toBe("read_only");
  });

  it("refuses anonymous reporters without a blind index", async () => {
    const c = setup();
    const anon: Actor = { profileId: "a1", kind: "anonymous", canWrite: true };
    expect(await code(c.svc.report(anon, target))).toBe("not_available");
    expect(c.filed).toHaveLength(0);
  });

  it("passes the blind index for anonymous reporters", async () => {
    const c = setup();
    const anon: Actor = {
      profileId: "a1",
      kind: "anonymous",
      canWrite: true,
      blindIndex: Buffer.from("ab", "hex"),
    };
    await c.svc.report(anon, target);
    expect(c.filed[0]?.reporterBlindIndex?.toString("hex")).toBe("ab");
  });
});

class FakeAdminStore implements AdminStore {
  moderators = new Map<string, Moderator>();
  queueRows: QueueRow[] = [];
  profileKinds = new Map<string, "known" | "anonymous">();
  penalties: Parameters<AdminStore["penalize"]>[0][] = [];
  resolved: Parameters<AdminStore["resolveTarget"]>[0][] = [];
  appeals: AppealRow[] = [];
  decided: Parameters<AdminStore["decideAppeal"]>[0][] = [];

  async findModeratorByTokenHash(hash: Buffer) {
    return this.moderators.get(hash.toString("hex")) ?? null;
  }
  async queue() {
    return this.queueRows;
  }
  async targetDetail(): Promise<TargetDetail | null> {
    return null;
  }
  async resolveTarget(i: Parameters<AdminStore["resolveTarget"]>[0]) {
    this.resolved.push(i);
    return { reportsClosed: 1, contentHidden: i.outcome === "uphold", contentRestored: false };
  }
  async profileKind(id: string) {
    return this.profileKinds.get(id) ?? null;
  }
  async penalize(i: Parameters<AdminStore["penalize"]>[0]) {
    this.penalties.push(i);
  }
  async listAppeals() {
    return this.appeals;
  }
  async decideAppeal(i: Parameters<AdminStore["decideAppeal"]>[0]) {
    this.decided.push(i);
    return i.id !== "missing";
  }
  async photoStorageKey() {
    return null;
  }
}

describe("AdminService", () => {
  const mod: Moderator = { id: "m1", name: "Wanjiru" };
  const NOW = new Date("2026-10-12T10:00:00Z");
  let store: FakeAdminStore;

  const make = (opts: Partial<AdminOptions> = {}) =>
    new AdminService(store, { ...DEFAULT_ADMIN_OPTIONS, ...opts }, () => NOW);

  beforeEach(() => {
    store = new FakeAdminStore();
    store.profileKinds.set("known-1", "known");
    store.profileKinds.set("anon-1", "anonymous");
  });

  it("authenticates moderators by token hash and rejects unknown tokens", async () => {
    store.moderators.set(hashToken("mod_secret").toString("hex"), mod);
    expect(await make().authenticate("mod_secret")).toEqual(mod);
    expect(await code(make().authenticate("wrong"))).toBe("unauthorized");
  });

  it("adds SLA due times: urgent in 1 hour, others in 24", async () => {
    const mk = (urgent: boolean, ageHours: number): QueueRow => ({
      targetKind: "post",
      targetId: "t",
      urgent,
      userReports: 1,
      autoFlags: 0,
      reasons: { threat: 1 },
      oldestReportAt: new Date(NOW.getTime() - ageHours * HOUR),
      preview: null,
    });
    store.queueRows = [mk(true, 0.5), mk(true, 2), mk(false, 23), mk(false, 25)];
    const { items } = await make().queue({});
    expect(items.map((i) => i.overdue)).toEqual([false, true, false, true]);
    expect(new Date(items[0]!.dueAt).getTime() - new Date(items[0]!.oldestReportAt).getTime()).toBe(
      HOUR,
    );
    expect(new Date(items[2]!.dueAt).getTime() - new Date(items[2]!.oldestReportAt).getTime()).toBe(
      24 * HOUR,
    );
  });

  it("requires a reason of at least 10 characters for every penalty", async () => {
    expect(
      await code(make().penalize(mod, { profileId: "known-1", kind: "warning", note: "short" })),
    ).toBe("note_required");
    expect(store.penalties).toHaveLength(0);
  });

  it("applies a warning to a known profile with no blind index", async () => {
    await make().penalize(mod, {
      profileId: "known-1",
      kind: "warning",
      note: "Repeated insults in comments",
    });
    expect(store.penalties[0]).toMatchObject({
      profileKind: "known",
      blindIndex: null,
      kind: "warning",
      endsAt: null,
      moderator: "Wanjiru",
    });
  });

  it("validates suspension lengths", async () => {
    const note = "Targeted harassment of a classmate";
    const call = (endsAt: Date | null) =>
      code(make().penalize(mod, { profileId: "known-1", kind: "suspension", endsAt, note }));

    expect(await call(null)).toBe("ends_at_required");
    expect(await call(new Date(NOW.getTime() + 10 * 60 * 1000))).toBe("invalid_ends_at");
    expect(await call(new Date(NOW.getTime() + 31 * DAY))).toBe("invalid_ends_at");
    expect(await call(new Date(NOW.getTime() + 7 * DAY))).toBe("ok");
    expect(store.penalties).toHaveLength(1);
  });

  it("rejects an end date on warnings and bans", async () => {
    const note = "A long enough recorded reason";
    const endsAt = new Date(NOW.getTime() + DAY);
    expect(await code(make().penalize(mod, { profileId: "known-1", kind: "ban", endsAt, note }))).toBe(
      "invalid_ends_at",
    );
    expect(
      await code(make().penalize(mod, { profileId: "known-1", kind: "warning", endsAt, note })),
    ).toBe("invalid_ends_at");
  });

  it("refuses penalties against anonymous profiles until a blind index exists", async () => {
    expect(
      await code(
        make().penalize(mod, { profileId: "anon-1", kind: "ban", note: "Posted threats repeatedly" }),
      ),
    ).toBe("not_available");
    expect(store.penalties).toHaveLength(0);
  });

  it("computes the blind index for anonymous profiles when configured", async () => {
    const svc = make({ blindIndexFor: (id) => Buffer.from(`idx-${id}`) });
    await svc.penalize(mod, { profileId: "anon-1", kind: "ban", note: "Posted threats repeatedly" });
    expect(store.penalties[0]?.blindIndex?.toString()).toBe("idx-anon-1");
    expect(store.penalties[0]?.profileKind).toBe("anonymous");
  });

  it("404s for unknown profiles", async () => {
    expect(
      await code(make().penalize(mod, { profileId: "nope", kind: "warning", note: "A long enough reason" })),
    ).toBe("not_found");
  });

  it("records the moderator on resolution", async () => {
    await make().resolve(mod, "post", "t1", "uphold", " confirmed harassment ");
    expect(store.resolved[0]).toMatchObject({
      outcome: "uphold",
      moderator: "Wanjiru",
      note: "confirmed harassment",
    });
  });

  it("requires a reason when deciding an appeal and 404s for unknown appeals", async () => {
    expect(await code(make().decideAppeal(mod, "a1", "upheld", "ok"))).toBe("note_required");
    expect(
      await code(make().decideAppeal(mod, "missing", "denied", "Evidence is clear and consistent")),
    ).toBe("not_found");
    expect(
      await code(make().decideAppeal(mod, "a1", "upheld", "Context shows this was a misreport")),
    ).toBe("ok");
  });
});

describe("admin HTTP app", () => {
  function http() {
    const store = new FakeAdminStore();
    store.moderators.set(hashToken("mod_token").toString("hex"), { id: "m1", name: "Wanjiru" });
    store.profileKinds.set("11111111-1111-4111-8111-111111111111", "known");
    const app = buildAdminApp({
      admin: new AdminService(store, DEFAULT_ADMIN_OPTIONS),
      photos: new MemoryPhotoStore(),
      logger: false,
    });
    return { app, store };
  }
  const auth = { authorization: "Bearer mod_token" };
  const pid = "11111111-1111-4111-8111-111111111111";

  it("rejects missing and wrong tokens on every route", async () => {
    const { app } = http();
    const routes: [string, string][] = [
      ["GET", "/admin/queue"],
      ["GET", `/admin/targets/post/${pid}`],
      ["POST", `/admin/targets/post/${pid}/resolve`],
      ["POST", `/admin/profiles/${pid}/penalties`],
      ["GET", "/admin/appeals"],
      ["POST", `/admin/appeals/${pid}/decision`],
      ["GET", `/admin/photos/${pid}`],
    ];
    for (const [method, url] of routes) {
      const none = await app.inject({ method: method as "GET", url });
      expect(none.statusCode, `${method} ${url}`).toBe(401);
      const bad = await app.inject({
        method: method as "GET",
        url,
        headers: { authorization: "Bearer wrong" },
      });
      expect(bad.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("does not accept a student-style token", async () => {
    const { app } = http();
    const res = await app.inject({
      method: "GET",
      url: "/admin/queue",
      headers: { authorization: "Bearer some-student-session-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns the queue for a valid moderator", async () => {
    const { app } = http();
    const res = await app.inject({ method: "GET", url: "/admin/queue", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it("validates penalty bodies strictly", async () => {
    const { app, store } = http();
    const bad = await app.inject({
      method: "POST",
      url: `/admin/profiles/${pid}/penalties`,
      headers: auth,
      payload: { kind: "ban", note: "A long enough recorded reason", accountId: "x" },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({
      method: "POST",
      url: `/admin/profiles/${pid}/penalties`,
      headers: auth,
      payload: { kind: "warning", note: "A long enough recorded reason" },
    });
    expect(ok.statusCode).toBe(201);
    expect(store.penalties).toHaveLength(1);
  });

  it("rejects non-uuid ids and unknown target kinds", async () => {
    const { app } = http();
    expect(
      (await app.inject({ method: "GET", url: "/admin/targets/post/nope", headers: auth })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: `/admin/targets/user/${pid}`, headers: auth }))
        .statusCode,
    ).toBe(400);
  });
});

describe("student appeals", () => {
  const EMAIL = "banned@test.ac.ke";
  function setup() {
    const db = new MemoryAuthStore();
    db.universities.push({ id: "u1", name: "Test", emailDomain: "test.ac.ke", active: true });
    const mailer = new CapturingMailer();
    const clock = { now: new Date("2026-10-12T10:00:00Z") };
    const auth = new AuthService(
      db,
      mailer,
      {
        codeHmacKey: "k".repeat(40),
        codeTtlMinutes: 10,
        maxCodesPerHour: 20,
        maxCodeAttempts: 3,
        sessionTtlDays: 30,
        termsVersion: "t",
      },
      () => clock.now,
    );
    return { db, mailer, auth, clock };
  }

  async function bannedStudent(c: ReturnType<typeof setup>) {
    await c.auth.requestSignup(EMAIL);
    await c.auth.verifySignup({
      email: EMAIL,
      code: c.mailer.lastCode(EMAIL),
      dateOfBirth: "2004-05-01",
      displayName: "Banned B",
    });
    c.db.setStatus(EMAIL, "banned");
  }

  it("sends a code only to banned accounts, without revealing which are banned", async () => {
    const c = setup();
    await bannedStudent(c);
    const before = c.mailer.codes.length;

    await expect(c.auth.requestAppeal(EMAIL)).resolves.toBeUndefined();
    expect(c.mailer.codes).toHaveLength(before + 1);
    expect(c.mailer.codes.at(-1)?.purpose).toBe("appeal");

    await expect(c.auth.requestAppeal("ghost@test.ac.ke")).resolves.toBeUndefined();
    expect(c.mailer.codes).toHaveLength(before + 1);
  });

  it("does not send appeal codes to accounts in good standing", async () => {
    const c = setup();
    await c.auth.requestSignup("fine@test.ac.ke");
    await c.auth.verifySignup({
      email: "fine@test.ac.ke",
      code: c.mailer.lastCode("fine@test.ac.ke"),
      dateOfBirth: "2004-05-01",
      displayName: "Fine F",
    });
    const before = c.mailer.codes.length;
    await c.auth.requestAppeal("fine@test.ac.ke");
    expect(c.mailer.codes).toHaveLength(before);
  });

  it("accepts exactly one appeal per account", async () => {
    const c = setup();
    await bannedStudent(c);

    await c.auth.requestAppeal(EMAIL);
    await c.auth.submitAppeal(EMAIL, c.mailer.lastCode(EMAIL), "I was quoting a film, not threatening.");
    expect(c.db.appeals.size).toBe(1);

    await c.auth.requestAppeal(EMAIL);
    expect(
      await code(c.auth.submitAppeal(EMAIL, c.mailer.lastCode(EMAIL), "Please reconsider.")),
    ).toBe("already_appealed");
  });

  it("needs a valid code and a sensible message", async () => {
    const c = setup();
    await bannedStudent(c);
    await c.auth.requestAppeal(EMAIL);
    const real = c.mailer.lastCode(EMAIL);
    const wrong = real === "000000" ? "000001" : "000000";
    expect(await code(c.auth.submitAppeal(EMAIL, wrong, "hello"))).toBe("invalid_code");
    expect(c.db.appeals.size).toBe(0);
    expect(
      await code(c.auth.submitAppeal(EMAIL, c.mailer.lastCode(EMAIL), "   ")),
    ).toBe("invalid_message");
    expect(
      await code(c.auth.submitAppeal(EMAIL, c.mailer.lastCode(EMAIL), "x".repeat(2001))),
    ).toBe("invalid_message");
  });

  it("cannot use a login code to appeal", async () => {
    const c = setup();
    await bannedStudent(c);
    c.db.setStatus(EMAIL, "active");
    await c.auth.requestLogin(EMAIL);
    const loginCode = c.mailer.lastCode(EMAIL);
    c.db.setStatus(EMAIL, "banned");
    expect(await code(c.auth.submitAppeal(EMAIL, loginCode, "Please"))).toBe("invalid_code");
  });
});

describe("suspension lifting in the lifecycle sweep", () => {
  it("lifts suspensions that have ended and leaves running ones alone", async () => {
    const db = new MemoryAuthStore();
    db.universities.push({ id: "u1", name: "T", emailDomain: "test.ac.ke", active: true });
    const mailer = new CapturingMailer();
    const now = new Date("2026-10-12T10:00:00Z");
    const auth = new AuthService(
      db,
      mailer,
      {
        codeHmacKey: "k".repeat(40),
        codeTtlMinutes: 10,
        maxCodesPerHour: 20,
        maxCodeAttempts: 3,
        sessionTtlDays: 30,
        termsVersion: "t",
      },
      () => now,
    );

    for (const who of ["ended", "running"]) {
      const email = `${who}@test.ac.ke`;
      await auth.requestSignup(email);
      await auth.verifySignup({
        email,
        code: mailer.lastCode(email),
        dateOfBirth: "2004-05-01",
        displayName: who,
      });
    }
    const ended = db.accountByEmail("ended@test.ac.ke");
    ended.status = "suspended";
    ended.suspensionEndsAt = new Date(now.getTime() - HOUR);
    const running = db.accountByEmail("running@test.ac.ke");
    running.status = "suspended";
    running.suspensionEndsAt = new Date(now.getTime() + DAY);

    const result = await runLifecycleSweep(
      new MemoryLifecycleStore(db),
      { reverifyGraceDays: 30, purgeAfterDays: 30 },
      now,
    );

    expect(result.liftedSuspensions).toBe(1);
    expect(ended.status).toBe("active");
    expect(running.status).toBe("suspended");
  });
});

describe("moderation migration (0005)", () => {
  const sql = readFileSync(join(here, "../../../db/migrations/0005_moderation.sql"), "utf8");

  it("takes table-level access to reports away from app_api", () => {
    expect(sql).toMatch(/revoke select, insert on moderation\.reports from app_api/);
  });

  it("keeps reporter_account_id out of every moderator grant", () => {
    const grants = sql
      .split("\n")
      .filter((l) => /^\s*grant\b/i.test(l) || /^\s{2,}on moderation\.reports/.test(l))
      .join("\n");
    const columnGrants = [...sql.matchAll(/grant (?:select|update) \(([^)]*)\)\s+on moderation\.reports to moderator/g)];
    expect(columnGrants.length).toBeGreaterThanOrEqual(2);
    for (const m of columnGrants) expect(m[1]).not.toContain("reporter_account_id");
    expect(grants).not.toMatch(/grant select on moderation\.reports to moderator/);
  });

  it("hides banned content with a reason so an upheld appeal can restore it", () => {
    expect(sql).toMatch(/hidden_reason = 'account_banned'/);
    expect(sql).toMatch(/hidden_reason = 'account_banned'[\s\S]*author_profile_id in/);
  });

  it("limits automatic flags to self-harm on posts and comments", () => {
    expect(sql).toMatch(/p_reason <> 'self_harm' or p_target_kind not in \('post', 'comment'\)/);
  });

  it("does not grant the core penalty function to any role", () => {
    expect(sql).toMatch(
      /revoke all on function identity\.apply_penalty_to_account\(uuid, text, uuid, timestamptz, uuid\[\]\) from public/,
    );
    expect(sql).not.toMatch(/grant execute on function identity\.apply_penalty_to_account/);
  });
});
