import { beforeEach, describe, expect, it } from "vitest";
import { AccountService } from "../src/account/service.js";
import { runLifecycleSweep } from "../src/account/lifecycleStore.js";
import { planReminder, type ReminderCandidate } from "../src/account/reminders.js";
import { formatDeadline, reminderMessage, SmtpMailer } from "../src/auth/mailer.js";
import { AuthService, type AuthOptions } from "../src/auth/service.js";
import { loadConfig } from "../src/config.js";
import { CapturingMailer, MemoryAuthStore, MemoryLifecycleStore } from "./helpers/memoryStore.js";

const DAY = 24 * 60 * 60 * 1000;
const OPTS: AuthOptions = {
  codeHmacKey: "test-key-test-key-test-key-test-key-0123",
  codeTtlMinutes: 10,
  maxCodesPerHour: 50,
  maxCodeAttempts: 3,
  sessionTtlDays: 800,
  termsVersion: "test-v1",
};
const SWEEP = {
  reverifyGraceDays: 30,
  purgeAfterDays: 30,
  reminderDueSoonDays: [30, 7],
  reminderClosingSoonDays: [7],
};
const BASE = new Date("2026-10-12T10:00:00Z");

interface Ctx {
  db: MemoryAuthStore;
  mailer: CapturingMailer;
  auth: AuthService;
  account: AccountService;
  lifecycle: MemoryLifecycleStore;
  clock: { now: Date };
}

function make(): Ctx {
  const db = new MemoryAuthStore();
  db.universities.push({ id: "u1", name: "Test U", emailDomain: "test.ac.ke", active: true });
  const mailer = new CapturingMailer();
  const clock = { now: new Date(BASE) };
  const auth = new AuthService(db, mailer, OPTS, () => clock.now);
  const lifecycle = new MemoryLifecycleStore(db);
  const account = new AccountService(auth, db, lifecycle, () => clock.now);
  return { db, mailer, auth, account, lifecycle, clock };
}

async function addStudent(c: Ctx, email: string) {
  await c.auth.requestSignup(email);
  const s = await c.auth.verifySignup({
    email,
    code: c.mailer.lastCode(email),
    dateOfBirth: "2004-05-01",
    displayName: "Student",
  });
  return { token: s.sessionToken, accountId: s.account.id };
}

const advanceDays = (c: Ctx, days: number) => {
  c.clock.now = new Date(c.clock.now.getTime() + days * DAY);
};
const sweep = (c: Ctx) => runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now, undefined, c.mailer);
const to = (c: Ctx, email: string) => c.mailer.reminders.filter((r) => r.to === email);

const candidate = (over: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  accountId: "a1",
  email: "a@test.ac.ke",
  status: "active",
  reverifyDueAt: new Date("2026-12-01T00:00:00Z"),
  sent: [],
  ...over,
});
const planOpts = { dueSoonDays: [30, 7], closingSoonDays: [7], graceDays: 30 };

describe("planReminder", () => {
  const at = (iso: string) => new Date(iso);

  it("says nothing while the deadline is further away than the earliest threshold", () => {
    expect(planReminder(candidate(), at("2026-10-01T00:00:00Z"), planOpts)).toBeNull();
  });

  it("sends the 30 day reminder once the deadline is within 30 days", () => {
    const p = planReminder(candidate(), at("2026-11-01T00:00:00Z"), planOpts)!;
    expect(p).toMatchObject({ kind: "due_soon", thresholdDays: 30, daysLeft: 30 });
  });

  it("does not repeat a reminder, and sends the 7 day one when it comes", () => {
    const sent = [{ kind: "due_soon" as const, thresholdDays: 30 }];
    expect(planReminder(candidate({ sent }), at("2026-11-10T00:00:00Z"), planOpts)).toBeNull();
    const p = planReminder(candidate({ sent }), at("2026-11-25T00:00:00Z"), planOpts)!;
    expect(p).toMatchObject({ thresholdDays: 7, daysLeft: 6 });
  });

  it("sends only the most urgent one when several were missed", () => {
    const p = planReminder(candidate(), at("2026-11-27T00:00:00Z"), planOpts)!;
    expect(p.thresholdDays).toBe(7);
  });

  it("does not send a due reminder at or after the deadline", () => {
    expect(planReminder(candidate(), at("2026-12-01T00:00:00Z"), planOpts)).toBeNull();
    expect(planReminder(candidate(), at("2026-12-02T00:00:00Z"), planOpts)).toBeNull();
  });

  it("warns a read-only account about the closing date, not the original deadline", () => {
    const c = candidate({ status: "read_only", reverifyDueAt: new Date("2026-10-01T00:00:00Z") });
    expect(planReminder(c, at("2026-10-20T00:00:00Z"), planOpts)).toBeNull();
    const p = planReminder(c, at("2026-10-26T00:00:00Z"), planOpts)!;
    expect(p).toMatchObject({ kind: "closing_soon", thresholdDays: 7, daysLeft: 5 });
    expect(p.deadline.toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });
});

describe("reminder emails in the sweep", () => {
  let c: Ctx;
  beforeEach(() => {
    c = make();
  });

  it("sends nothing to a new account, and only once per threshold", async () => {
    await addStudent(c, "jane@test.ac.ke");
    expect((await sweep(c)).remindersSent).toBe(0);

    advanceDays(c, 365 - 30);
    const first = await sweep(c);
    expect(first.remindersSent).toBe(1);
    expect(to(c, "jane@test.ac.ke")[0]!.reminder).toMatchObject({ kind: "due_soon", daysLeft: 30 });

    advanceDays(c, 1);
    expect((await sweep(c)).remindersSent).toBe(0);
    expect(to(c, "jane@test.ac.ke")).toHaveLength(1);
  });

  it("sends the 7 day reminder later, then the closing reminder after the account goes read-only", async () => {
    await addStudent(c, "jane@test.ac.ke");
    advanceDays(c, 365 - 30);
    await sweep(c);
    advanceDays(c, 24);
    await sweep(c);
    expect(to(c, "jane@test.ac.ke").map((r) => r.reminder.daysLeft)).toEqual([30, 6]);

    advanceDays(c, 7);
    const overdue = await sweep(c);
    expect(overdue.markedReadOnly).toBe(1);
    expect(overdue.remindersSent).toBe(0);

    advanceDays(c, 24);
    const closing = await sweep(c);
    expect(closing.remindersSent).toBe(1);
    const last = to(c, "jane@test.ac.ke").at(-1)!.reminder;
    expect(last.kind).toBe("closing_soon");
    expect(last.daysLeft).toBeGreaterThan(0);
    expect(last.daysLeft).toBeLessThanOrEqual(7);
  });

  it("starts again after a successful re-verification", async () => {
    const { token } = await addStudent(c, "jane@test.ac.ke");
    advanceDays(c, 365 - 20);
    await sweep(c);
    expect(to(c, "jane@test.ac.ke")).toHaveLength(1);

    await c.account.requestReverify(token);
    await c.account.verifyReverify(token, c.mailer.lastCode("jane@test.ac.ke"));
    advanceDays(c, 1);
    expect((await sweep(c)).remindersSent).toBe(0);

    const nextDue = c.db.accountByEmail("jane@test.ac.ke").reverifyDueAt;
    c.clock.now = new Date(nextDue.getTime() - 29 * DAY);
    expect((await sweep(c)).remindersSent).toBe(1);
    expect(to(c, "jane@test.ac.ke")).toHaveLength(2);
  });

  it("leaves a failed send to be tried again, and keeps going for everyone else", async () => {
    await addStudent(c, "bad@test.ac.ke");
    await addStudent(c, "good@test.ac.ke");
    c.mailer.failReminderFor.add("bad@test.ac.ke");
    advanceDays(c, 365 - 10);

    const first = await sweep(c);
    expect(first).toMatchObject({ remindersSent: 1, remindersFailed: 1 });
    expect(to(c, "good@test.ac.ke")).toHaveLength(1);

    c.mailer.failReminderFor.clear();
    const second = await sweep(c);
    expect(second).toMatchObject({ remindersSent: 1, remindersFailed: 0 });
    expect(to(c, "bad@test.ac.ke")).toHaveLength(1);
    expect(to(c, "good@test.ac.ke")).toHaveLength(1);
  });

  it("does not remind closed or suspended accounts", async () => {
    const gone = await addStudent(c, "gone@test.ac.ke");
    await addStudent(c, "paused@test.ac.ke");
    c.db.setStatus("paused@test.ac.ke", "suspended");
    c.db.setStatus("gone@test.ac.ke", "closed");
    void gone;
    advanceDays(c, 365 - 10);
    expect((await sweep(c)).remindersSent).toBe(0);
  });

  it("caps how many it sends in one run and carries on next time", async () => {
    for (const n of ["a", "b", "c"]) await addStudent(c, `${n}@test.ac.ke`);
    advanceDays(c, 365 - 10);
    const opts = { ...SWEEP, reminderMaxPerRun: 2 };
    const one = await runLifecycleSweep(c.lifecycle, opts, c.clock.now, undefined, c.mailer);
    expect(one.remindersSent).toBe(2);
    const two = await runLifecycleSweep(c.lifecycle, opts, c.clock.now, undefined, c.mailer);
    expect(two.remindersSent).toBe(1);
    const three = await runLifecycleSweep(c.lifecycle, opts, c.clock.now, undefined, c.mailer);
    expect(three.remindersSent).toBe(0);
  });

  it("does not run without a mailer, and empty thresholds switch reminders off", async () => {
    await addStudent(c, "jane@test.ac.ke");
    advanceDays(c, 365 - 10);
    const none = await runLifecycleSweep(c.lifecycle, SWEEP, c.clock.now);
    expect(none.remindersSent).toBe(0);
    const off = await runLifecycleSweep(
      c.lifecycle,
      { ...SWEEP, reminderDueSoonDays: [], reminderClosingSoonDays: [] },
      c.clock.now,
      undefined,
      c.mailer,
    );
    expect(off.remindersSent).toBe(0);
    expect(c.mailer.reminders).toHaveLength(0);
  });

  it("deletes its own records after the retention period", async () => {
    await addStudent(c, "jane@test.ac.ke");
    advanceDays(c, 365 - 10);
    await sweep(c);
    expect(c.lifecycle.reminderRows).toHaveLength(1);
    advanceDays(c, 401);
    const r = await sweep(c);
    expect(r.remindersPurged).toBe(1);
    expect(c.lifecycle.reminderRows).toHaveLength(0);
  });
});

describe("reminder message", () => {
  const r = {
    kind: "due_soon" as const,
    daysLeft: 7,
    deadline: new Date("2026-11-13T10:00:00Z"),
    graceDays: 30,
    purgeDays: 30,
  };

  it("names the date, the steps in the app and what happens next, with no links or code", () => {
    const m = reminderMessage(r);
    expect(m.subject).toBe("Moku: confirm your student email by 13 November 2026");
    expect(m.text).toContain("in 7 days");
    expect(m.text).toContain("Confirm your email again");
    expect(m.text).toContain("30 days after that");
    expect(m.text).toContain("download your data");
    expect(m.text).not.toMatch(/https?:\/\//i);
    expect(m.text).not.toMatch(/\b\d{6}\b/);
  });

  it("uses the singular for one day and writes the closing notice for read-only accounts", () => {
    expect(reminderMessage({ ...r, daysLeft: 1 }).text).toContain("in 1 day.");
    const m = reminderMessage({ ...r, kind: "closing_soon", daysLeft: 3 });
    expect(m.subject).toBe("Moku: your account will close on 13 November 2026");
    expect(m.text).toContain("read-only");
    expect(m.text).toContain("Confirm your email (needed)");
  });

  it("formats dates the same on every machine", () => {
    expect(formatDeadline(new Date("2027-01-05T23:59:00Z"))).toBe("5 January 2027");
  });

  it("goes out over SMTP as plain text and fails with one generic error", async () => {
    const sent: { to: string; subject: string; text: string }[] = [];
    const ok = new SmtpMailer({ sendMail: async (m) => void sent.push(m) }, "no-reply@example.test");
    await ok.sendReverifyReminder("jane@usiu.ac.ke", r);
    expect(sent[0]!.to).toBe("jane@usiu.ac.ke");

    const bad = new SmtpMailer(
      {
        sendMail: async () => {
          throw new Error("550 jane@usiu.ac.ke rejected");
        },
      },
      "no-reply@example.test",
    );
    await expect(bad.sendReverifyReminder("jane@usiu.ac.ke", r)).rejects.toMatchObject({
      code: "email_unavailable",
    });
  });
});

describe("reminder settings", () => {
  const base = { DATABASE_URL: "postgres://x", CODE_HMAC_KEY: "k".repeat(32) };

  it("defaults to 30 and 7 days before, and 7 before closing", () => {
    const c = loadConfig(base);
    expect(c.REVERIFY_REMINDER_DAYS).toEqual([30, 7]);
    expect(c.CLOSURE_REMINDER_DAYS).toEqual([7]);
    expect(c.REMINDER_MAX_PER_RUN).toBe(500);
  });

  it("accepts a list, an empty list to switch them off, and refuses nonsense", () => {
    expect(loadConfig({ ...base, REVERIFY_REMINDER_DAYS: "14, 3, 14" }).REVERIFY_REMINDER_DAYS).toEqual([14, 3]);
    expect(loadConfig({ ...base, REVERIFY_REMINDER_DAYS: "" }).REVERIFY_REMINDER_DAYS).toEqual([]);
    expect(() => loadConfig({ ...base, REVERIFY_REMINDER_DAYS: "soon" })).toThrow();
    expect(() => loadConfig({ ...base, REVERIFY_REMINDER_DAYS: "0" })).toThrow();
    expect(() => loadConfig({ ...base, CLOSURE_REMINDER_DAYS: "90" })).toThrow();
  });
});
