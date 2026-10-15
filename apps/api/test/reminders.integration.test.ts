import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runLifecycleSweep, type SweepOptions } from "../src/account/lifecycleStore.js";
import { PgLifecycleStore } from "../src/account/pgLifecycleStore.js";
import { CapturingMailer } from "./helpers/memoryStore.js";

const password = process.env.TEST_PG_PASSWORD;
const host = process.env.TEST_PG_HOST ?? "127.0.0.1";
const port = Number(process.env.TEST_PG_PORT ?? 5432);
const database = process.env.TEST_PG_DB ?? "campus_social";

const suite = password ? describe : describe.skip;
const DAY = 24 * 60 * 60 * 1000;
const SWEEP: SweepOptions = {
  reverifyGraceDays: 30,
  purgeAfterDays: 30,
  reminderDueSoonDays: [30, 7],
  reminderClosingSoonDays: [7],
};
const NOW = new Date("2026-10-12T10:00:00Z");

function pool(user: string) {
  return new pg.Pool({ host, port, database, user, password, max: 4 });
}

suite("Reverification reminders (PostgreSQL)", () => {
  let admin: pg.Pool;
  let life: pg.Pool;
  let app: pg.Pool;
  let uni: string;
  let mailer: CapturingMailer;
  let store: PgLifecycleStore;

  beforeAll(() => {
    admin = pool("postgres");
    life = pool("account_lifecycle");
    app = pool("app_api");
  });

  afterAll(async () => {
    await Promise.all([admin?.end(), life?.end(), app?.end()]);
  });

  beforeEach(async () => {
    await admin.query(`truncate accounts, universities cascade`);
    const u = await admin.query(
      `insert into universities (name, email_domain, active) values ('Test U', 'test.ac.ke', true) returning id`,
    );
    uni = u.rows[0].id;
    mailer = new CapturingMailer();
    store = new PgLifecycleStore(life);
  });

  async function account(email: string, status: string, dueInDays: number): Promise<string> {
    const due = new Date(NOW.getTime() + dueInDays * DAY);
    const r = await admin.query(
      `insert into accounts (university_id, email, date_of_birth, terms_accepted_at, terms_version,
                             status, email_verified_at, last_reverified_at, reverify_due_at)
       values ($1, $2, '2004-05-01', $3, 'v', $4, $3, $3, $5) returning id`,
      [uni, email, NOW, status, due],
    );
    return r.rows[0].id;
  }

  const run = (now: Date = NOW) => runLifecycleSweep(store, SWEEP, now, undefined, mailer);
  const rows = async () =>
    (await admin.query(`select kind, threshold_days from account_reminders order by sent_at, kind`)).rows;

  it("reminds an active account inside the window once, and records it", async () => {
    await account("soon@test.ac.ke", "active", 20);
    await account("later@test.ac.ke", "active", 200);

    const first = await run();
    expect(first.remindersSent).toBe(1);
    expect(mailer.reminders.map((r) => r.to)).toEqual(["soon@test.ac.ke"]);
    expect(mailer.reminders[0]!.reminder).toMatchObject({ kind: "due_soon", daysLeft: 20 });
    expect(await rows()).toEqual([{ kind: "due_soon", threshold_days: 30 }]);

    const second = await run();
    expect(second.remindersSent).toBe(0);
    expect(mailer.reminders).toHaveLength(1);
  });

  it("sends the next threshold later, in the same cycle", async () => {
    await account("soon@test.ac.ke", "active", 20);
    await run();
    await run(new Date(NOW.getTime() + 15 * DAY));
    expect(mailer.reminders.map((r) => r.reminder.daysLeft)).toEqual([20, 5]);
    expect(await rows()).toEqual([
      { kind: "due_soon", threshold_days: 30 },
      { kind: "due_soon", threshold_days: 7 },
    ]);
  });

  it("starts a fresh cycle when the due date moves", async () => {
    const id = await account("soon@test.ac.ke", "active", 20);
    await run();
    await admin.query(`update accounts set reverify_due_at = $2 where id = $1`, [
      id,
      new Date(NOW.getTime() + 25 * DAY),
    ]);
    const again = await run();
    expect(again.remindersSent).toBe(1);
    expect(await rows()).toHaveLength(2);
  });

  it("warns a read-only account about closure and ignores other statuses", async () => {
    await account("ro@test.ac.ke", "read_only", -25);
    await account("closed@test.ac.ke", "closed", 10);
    await account("susp@test.ac.ke", "suspended", 10);
    await account("banned@test.ac.ke", "banned", 10);
    const r = await run();
    expect(r.remindersSent).toBe(1);
    expect(mailer.reminders[0]!.to).toBe("ro@test.ac.ke");
    expect(mailer.reminders[0]!.reminder.kind).toBe("closing_soon");
    expect(mailer.reminders[0]!.reminder.daysLeft).toBe(5);
  });

  it("does not record a reminder that failed to send", async () => {
    await account("bad@test.ac.ke", "active", 10);
    mailer.failReminderFor.add("bad@test.ac.ke");
    const r = await run();
    expect(r).toMatchObject({ remindersSent: 0, remindersFailed: 1 });
    expect(await rows()).toHaveLength(0);
  });

  it("deletes old reminder records, and keeps recent ones", async () => {
    const a = await account("old@test.ac.ke", "active", 200);
    const b = await account("new@test.ac.ke", "active", 200);
    await admin.query(
      `insert into account_reminders (account_id, kind, threshold_days, cycle_due_at, sent_at) values
         ($1, 'due_soon', 30, $3, $4), ($2, 'due_soon', 30, $3, $5)`,
      [a, b, new Date(NOW.getTime() - 400 * DAY), new Date(NOW.getTime() - 401 * DAY), new Date(NOW.getTime() - 10 * DAY)],
    );
    const r = await run();
    expect(r.remindersPurged).toBe(1);
    expect(r.remindersSent).toBe(0);
    const left = await admin.query(`select account_id from account_reminders`);
    expect(left.rows.map((x) => x.account_id)).toContain(b);
    expect(left.rows.map((x) => x.account_id)).not.toContain(a);
  });

  it("is only reachable by the maintenance role", async () => {
    await expect(app.query(`select * from account_reminders`)).rejects.toThrow(/permission denied/);
    await expect(app.query(`delete from account_reminders`)).rejects.toThrow(/permission denied/);
    await life.query(`select count(*) from account_reminders`);
  });

  it("holds no message text, only which reminder went to which account", async () => {
    const cols = await admin.query(
      `select column_name from information_schema.columns where table_name = 'account_reminders' order by 1`,
    );
    expect(cols.rows.map((c) => c.column_name)).toEqual([
      "account_id",
      "cycle_due_at",
      "kind",
      "sent_at",
      "threshold_days",
    ]);
  });
});
