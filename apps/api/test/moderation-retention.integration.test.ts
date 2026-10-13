import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgLifecycleStore } from "../src/account/pgLifecycleStore.js";
import { runLifecycleSweep } from "../src/account/lifecycleStore.js";
import { PgAuthStore } from "../src/auth/pgStore.js";
import { AuthService } from "../src/auth/service.js";
import { CapturingMailer } from "./helpers/memoryStore.js";

const password = process.env.TEST_PG_PASSWORD;
const host = process.env.TEST_PG_HOST ?? "127.0.0.1";
const port = Number(process.env.TEST_PG_PORT ?? 5432);
const database = process.env.TEST_PG_DB ?? "campus_social";

const suite = password ? describe : describe.skip;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-12T10:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

const DEFAULTS = {
  now: NOW,
  dismissedReportDays: 90,
  resolvedRecordDays: 365,
  appealRecordDays: 365,
  warningMonths: 12,
  auditLogYears: 3,
};

function pool(user: string) {
  return new pg.Pool({ host, port, database, user, password, max: 4 });
}

suite("Moderation record retention (PostgreSQL)", () => {
  let admin: pg.Pool;
  let lifePool: pg.Pool;
  let appPool: pg.Pool;
  let authPool: pg.Pool;
  let modPool: pg.Pool;
  let tsPool: pg.Pool;
  let lifecycle: PgLifecycleStore;
  let uni: string;
  let seq = 0;

  beforeAll(() => {
    admin = pool("postgres");
    lifePool = pool("account_lifecycle");
    appPool = pool("app_api");
    authPool = pool("auth_service");
    modPool = pool("moderator");
    tsPool = pool("trust_safety");
  });

  afterAll(async () => {
    await Promise.all([admin, lifePool, appPool, authPool, modPool, tsPool].map((p) => p?.end()));
  });

  beforeEach(async () => {
    await admin.query(
      `truncate accounts, profiles, email_codes, sessions, banned_emails, universities,
                photo_uploads, notifications, storage_deletions, moderation.reports,
                moderation.actions, moderation.penalties, moderation.appeals,
                moderation.legal_holds, moderation.moderators,
                identity.lookup_audit, identity.lookup_audit_purges cascade`,
    );
    const u = await admin.query(
      `insert into universities (name, email_domain, active) values ('One', 'test.ac.ke', true) returning id`,
    );
    uni = u.rows[0].id;
    lifecycle = new PgLifecycleStore(lifePool);
  });

  async function account(opts: { status?: string; strikes?: number } = {}) {
    seq += 1;
    const r = await admin.query(
      `insert into accounts (university_id, email, terms_accepted_at, terms_version,
                             email_verified_at, last_reverified_at, reverify_due_at,
                             status, strike_count, created_at)
       values ($1, $2, $3, 't', $3, $3, $4, $5, $6, $3) returning id, email`,
      [
        uni,
        `student${seq}@test.ac.ke`,
        ago(900),
        new Date(NOW.getTime() + 300 * DAY),
        opts.status ?? "active",
        opts.strikes ?? 0,
      ],
    );
    return { id: r.rows[0].id as string, email: r.rows[0].email as string };
  }

  async function report(o: {
    status: "open" | "dismissed" | "actioned";
    resolvedDaysAgo?: number;
    target?: { kind: "post" | "comment" | "profile"; id: string };
    reporter: string;
    createdDaysAgo?: number;
  }) {
    const target = o.target ?? { kind: "post" as const, id: randomUUID() };
    const r = await admin.query(
      `insert into moderation.reports
         (target_kind, target_id, reason, reporter_account_id, status, created_at, resolved_at, source)
       values ($1::report_target, $2, 'harassment', $3, $4::report_status, $5, $6, 'user')
       returning id`,
      [
        target.kind,
        target.id,
        o.reporter,
        o.status,
        ago(o.createdDaysAgo ?? (o.resolvedDaysAgo ?? 0) + 1),
        o.resolvedDaysAgo === undefined ? null : ago(o.resolvedDaysAgo),
      ],
    );
    return { id: r.rows[0].id as string, target };
  }

  async function action(o: {
    daysAgo: number;
    reportId?: string;
    target?: { kind: "post" | "comment" | "profile"; id: string };
  }) {
    const r = await admin.query(
      `insert into moderation.actions (kind, moderator, report_id, target_kind, target_id, created_at)
       values ('close_report', 'Wanjiru', $1, $2::report_target, $3, $4) returning id`,
      [o.reportId ?? null, o.target?.kind ?? null, o.target?.id ?? null, ago(o.daysAgo)],
    );
    return r.rows[0].id as string;
  }

  async function penalty(o: {
    accountId: string;
    kind: "warning" | "suspension" | "ban";
    startedDaysAgo: number;
    endedDaysAgo?: number;
    actionId?: string;
  }) {
    const r = await admin.query(
      `insert into moderation.penalties (account_id, kind, starts_at, ends_at, action_id, created_at)
       values ($1, $2, $3, $4, $5, $3) returning id`,
      [
        o.accountId,
        o.kind,
        ago(o.startedDaysAgo),
        o.endedDaysAgo === undefined ? null : ago(o.endedDaysAgo),
        o.actionId ?? null,
      ],
    );
    return r.rows[0].id as string;
  }

  async function appeal(o: {
    accountId: string;
    status: "open" | "upheld" | "denied";
    decidedDaysAgo?: number;
  }) {
    const r = await admin.query(
      `insert into moderation.appeals
         (account_id, message, status, created_at, decided_at, decided_by, decision_note)
       values ($1, 'I was quoting a film', $2, $3, $4, $5, $6) returning id`,
      [
        o.accountId,
        o.status,
        ago((o.decidedDaysAgo ?? 0) + 5),
        o.decidedDaysAgo === undefined ? null : ago(o.decidedDaysAgo),
        o.decidedDaysAgo === undefined ? null : "Wanjiru",
        o.decidedDaysAgo === undefined ? null : "Explicit and repeated",
      ],
    );
    return r.rows[0].id as string;
  }

  async function audit(daysAgo: number, caseRef: string | null = null) {
    await admin.query(
      `insert into identity.lookup_audit
         (looked_up_at, actor, actor_role, reason_code, reason_detail, case_ref)
       values ($1, 'Alice TS', 'trust_safety', 'confirmed_threat',
               'Explicit threat against a named student, reviewed by two staff', $2)`,
      [ago(daysAgo), caseRef],
    );
  }

  const count = async (sql: string, args: unknown[] = []) =>
    (await admin.query(sql, args)).rows[0].n as number;
  const run = (over: Partial<typeof DEFAULTS> = {}) =>
    lifecycle.purgeModerationRecords({ ...DEFAULTS, ...over });
  const hold = async (o: {
    scope: "target" | "account" | "audit_case";
    kind?: string;
    id?: string;
    accountId?: string;
    caseRef?: string;
  }) => {
    const r = await admin.query(
      `insert into moderation.legal_holds
         (scope, target_kind, target_id, account_id, case_ref, reason, placed_by)
       values ($1, $2::report_target, $3, $4, $5, 'Court order HC/2026/114', 'Bob K.')
       returning id`,
      [o.scope, o.kind ?? null, o.id ?? null, o.accountId ?? null, o.caseRef ?? null],
    );
    return r.rows[0].id as string;
  };

  describe("reports", () => {
    it("deletes dismissed reports after 90 days, not before", async () => {
      const a = await account();
      const young = await report({ status: "dismissed", resolvedDaysAgo: 89, reporter: a.id });
      const old = await report({ status: "dismissed", resolvedDaysAgo: 91, reporter: a.id });

      const r = await run();
      expect(r.reportsPurged).toBe(1);
      const left = await admin.query(`select id from moderation.reports`);
      expect(left.rows.map((x) => x.id)).toEqual([young.id]);
      expect(left.rows.map((x) => x.id)).not.toContain(old.id);
    });

    it("keeps upheld reports for a year", async () => {
      const a = await account();
      await report({ status: "actioned", resolvedDaysAgo: 364, reporter: a.id });
      await report({ status: "actioned", resolvedDaysAgo: 366, reporter: a.id });

      const r = await run();
      expect(r.reportsPurged).toBe(1);
      expect(await count(`select count(*)::int n from moderation.reports`)).toBe(1);
    });

    it("never deletes an open report, however old", async () => {
      const a = await account();
      await report({ status: "open", createdDaysAgo: 2000, reporter: a.id });
      const r = await run();
      expect(r.reportsPurged).toBe(0);
      expect(await count(`select count(*)::int n from moderation.reports`)).toBe(1);
    });

    it("keeps the action when its report is deleted, and drops the link", async () => {
      const a = await account();
      const rep = await report({ status: "dismissed", resolvedDaysAgo: 100, reporter: a.id });
      const actionId = await action({ daysAgo: 100, reportId: rep.id, target: rep.target });

      await run();
      expect(await count(`select count(*)::int n from moderation.reports`)).toBe(0);
      const act = await admin.query(`select report_id from moderation.actions where id = $1`, [actionId]);
      expect(act.rows).toEqual([{ report_id: null }]);
    });

    it("keeps reports about a target under hold, and deletes them once released", async () => {
      const a = await account();
      const rep = await report({ status: "dismissed", resolvedDaysAgo: 200, reporter: a.id });
      const holdId = await hold({ scope: "target", kind: rep.target.kind, id: rep.target.id });

      expect((await run()).reportsPurged).toBe(0);
      expect(await count(`select count(*)::int n from moderation.reports`)).toBe(1);

      await admin.query(`update moderation.legal_holds set released_at = now() where id = $1`, [holdId]);
      expect((await run()).reportsPurged).toBe(1);
    });

    it("does not let a hold on one target protect another", async () => {
      const a = await account();
      const held = await report({ status: "dismissed", resolvedDaysAgo: 200, reporter: a.id });
      await report({ status: "dismissed", resolvedDaysAgo: 200, reporter: a.id });
      await hold({ scope: "target", kind: held.target.kind, id: held.target.id });

      expect((await run()).reportsPurged).toBe(1);
      const left = await admin.query(`select id from moderation.reports`);
      expect(left.rows.map((x) => x.id)).toEqual([held.id]);
    });
  });

  describe("actions and penalties", () => {
    it("deletes actions after a year and keeps younger ones", async () => {
      await action({ daysAgo: 364 });
      await action({ daysAgo: 366 });
      const r = await run();
      expect(r.actionsPurged).toBe(1);
      expect(await count(`select count(*)::int n from moderation.actions`)).toBe(1);
    });

    it("keeps a ban in force, and the action behind it, however old", async () => {
      const a = await account({ status: "banned" });
      const actionId = await action({ daysAgo: 1000 });
      const pen = await penalty({
        accountId: a.id,
        kind: "ban",
        startedDaysAgo: 1000,
        actionId,
      });

      const r = await run();
      expect(r.penaltiesPurged).toBe(0);
      expect(r.actionsPurged).toBe(0);
      expect(await count(`select count(*)::int n from moderation.penalties where id = $1`, [pen])).toBe(1);
      expect(await count(`select count(*)::int n from moderation.actions where id = $1`, [actionId])).toBe(1);
    });

    it("deletes a ban and its action once the ban ended more than a year ago", async () => {
      const a = await account();
      const actionId = await action({ daysAgo: 1000 });
      await penalty({
        accountId: a.id,
        kind: "ban",
        startedDaysAgo: 1000,
        endedDaysAgo: 400,
        actionId,
      });

      const r = await run();
      expect(r.penaltiesPurged).toBe(1);
      expect(r.actionsPurged).toBe(1);
    });

    it("keeps a ban that ended less than a year ago", async () => {
      const a = await account();
      await penalty({ accountId: a.id, kind: "ban", startedDaysAgo: 500, endedDaysAgo: 100 });
      expect((await run()).penaltiesPurged).toBe(0);
    });

    it("deletes suspensions a year after they ended", async () => {
      const a = await account();
      await penalty({ accountId: a.id, kind: "suspension", startedDaysAgo: 500, endedDaysAgo: 380 });
      await penalty({ accountId: a.id, kind: "suspension", startedDaysAgo: 100, endedDaysAgo: 80 });
      expect((await run()).penaltiesPurged).toBe(1);
      expect(await count(`select count(*)::int n from moderation.penalties`)).toBe(1);
    });

    it("keeps an account's penalties while a hold is on it", async () => {
      const a = await account();
      await penalty({ accountId: a.id, kind: "suspension", startedDaysAgo: 900, endedDaysAgo: 800 });
      await hold({ scope: "account", accountId: a.id });
      expect((await run()).penaltiesPurged).toBe(0);
    });
  });

  describe("warnings", () => {
    it("stop counting after 12 months, and the record goes with them", async () => {
      const a = await account({ strikes: 2 });
      await penalty({ accountId: a.id, kind: "warning", startedDaysAgo: 400 });
      await penalty({ accountId: a.id, kind: "warning", startedDaysAgo: 100 });

      const r = await run();
      expect(r.warningsExpired).toBe(1);
      expect(r.penaltiesPurged).toBe(1);

      const acc = await admin.query(`select strike_count from accounts where id = $1`, [a.id]);
      expect(acc.rows[0].strike_count).toBe(1);
      expect(await count(`select count(*)::int n from moderation.penalties`)).toBe(1);
    });

    it("never takes the count below zero", async () => {
      const a = await account({ strikes: 0 });
      await penalty({ accountId: a.id, kind: "warning", startedDaysAgo: 500 });
      await run();
      const acc = await admin.query(`select strike_count from accounts where id = $1`, [a.id]);
      expect(acc.rows[0].strike_count).toBe(0);
    });

    it("is not applied twice if the job runs again", async () => {
      const a = await account({ strikes: 3 });
      await penalty({ accountId: a.id, kind: "warning", startedDaysAgo: 500 });
      await run();
      await run();
      const acc = await admin.query(`select strike_count from accounts where id = $1`, [a.id]);
      expect(acc.rows[0].strike_count).toBe(2);
    });

    it("lets a student create an anonymous profile again once the warning has expired", async () => {
      const a = await account({ strikes: 1 });
      await penalty({ accountId: a.id, kind: "warning", startedDaysAgo: 400 });
      const store = new PgAuthStore(authPool);

      expect((await store.getStanding(a.id))?.strikeCount).toBe(1);
      await run();
      expect((await store.getStanding(a.id))?.strikeCount).toBe(0);
    });

    it("under a hold, reduces the count once however often the job runs", async () => {
      const a = await account({ strikes: 3 });
      await penalty({ accountId: a.id, kind: "warning", startedDaysAgo: 500 });
      await hold({ scope: "account", accountId: a.id });

      await run();
      await run();
      await run();

      const acc = await admin.query(`select strike_count from accounts where id = $1`, [a.id]);
      expect(acc.rows[0].strike_count).toBe(2);
      expect(await count(`select count(*)::int n from moderation.penalties`)).toBe(1);
    });

    it("still reduces the count under a hold, but keeps the record", async () => {
      const a = await account({ strikes: 1 });
      await penalty({ accountId: a.id, kind: "warning", startedDaysAgo: 400 });
      await hold({ scope: "account", accountId: a.id });

      const r = await run();
      expect(r.warningsExpired).toBe(1);
      expect(r.penaltiesPurged).toBe(0);
      expect(await count(`select count(*)::int n from moderation.penalties`)).toBe(1);
    });
  });

  describe("appeals", () => {
    it("removes the personal content after a year but keeps a bare row", async () => {
      const a = await account({ status: "banned" });
      await appeal({ accountId: a.id, status: "denied", decidedDaysAgo: 400 });

      const r = await run();
      expect(r.appealsScrubbed).toBe(1);

      const row = await admin.query(
        `select message, status, decided_by, decision_note, decided_at, scrubbed_at
           from moderation.appeals where account_id = $1`,
        [a.id],
      );
      expect(row.rows[0]).toMatchObject({
        message: "",
        status: "denied",
        decided_by: null,
        decision_note: null,
      });
      expect(row.rows[0].decided_at).not.toBeNull();
      expect(row.rows[0].scrubbed_at).not.toBeNull();
    });

    it("leaves open appeals and recent decisions alone", async () => {
      const open = await account({ status: "banned" });
      const recent = await account({ status: "banned" });
      await appeal({ accountId: open.id, status: "open" });
      await appeal({ accountId: recent.id, status: "upheld", decidedDaysAgo: 100 });

      expect((await run()).appealsScrubbed).toBe(0);
      const rows = await admin.query(`select message from moderation.appeals order by account_id`);
      expect(rows.rows.every((x) => x.message === "I was quoting a film")).toBe(true);
    });

    it("does not reopen the one-appeal rule for someone still banned", async () => {
      const a = await account({ status: "banned" });
      await appeal({ accountId: a.id, status: "denied", decidedDaysAgo: 500 });
      await run();

      const mailer = new CapturingMailer();
      const auth = new AuthService(
        new PgAuthStore(authPool),
        mailer,
        {
          codeHmacKey: "retention-key-retention-key-0123456789",
          codeTtlMinutes: 10,
          maxCodesPerHour: 50,
          maxCodeAttempts: 3,
          sessionTtlDays: 30,
          termsVersion: "t",
        },
        () => NOW,
      );
      await auth.requestAppeal(a.email);
      await expect(
        auth.submitAppeal(a.email, mailer.lastCode(a.email), "Please reconsider."),
      ).rejects.toMatchObject({ code: "already_appealed" });
    });

    it("keeps the text while a hold is on the account", async () => {
      const a = await account({ status: "banned" });
      await appeal({ accountId: a.id, status: "denied", decidedDaysAgo: 500 });
      await hold({ scope: "account", accountId: a.id });

      expect((await run()).appealsScrubbed).toBe(0);
      const row = await admin.query(`select message from moderation.appeals`);
      expect(row.rows[0].message).toBe("I was quoting a film");
    });

    it("is idempotent", async () => {
      const a = await account({ status: "banned" });
      await appeal({ accountId: a.id, status: "upheld", decidedDaysAgo: 500 });
      expect((await run()).appealsScrubbed).toBe(1);
      expect((await run()).appealsScrubbed).toBe(0);
    });
  });

  describe("unmask audit log", () => {
    it("deletes rows older than 3 years, keeps newer ones, and logs the purge", async () => {
      await audit(3 * 365 + 30);
      await audit(3 * 365 + 5);
      await audit(3 * 365 - 30);
      await audit(10);

      const r = await run();
      expect(r.auditRowsPurged).toBe(2);
      expect(await count(`select count(*)::int n from identity.lookup_audit`)).toBe(2);

      const log = await admin.query(`select rows_deleted from identity.lookup_audit_purges`);
      expect(log.rows).toEqual([{ rows_deleted: 2 }]);
    });

    it("keeps rows for a case under hold", async () => {
      await audit(2000, "HC/2026/114");
      await audit(2000, "R-1");
      await hold({ scope: "audit_case", caseRef: "HC/2026/114" });

      expect((await run()).auditRowsPurged).toBe(1);
      const left = await admin.query(`select case_ref from identity.lookup_audit`);
      expect(left.rows).toEqual([{ case_ref: "HC/2026/114" }]);
    });

    it("stays append-only for everyone, including the owner, outside the job", async () => {
      await audit(2000);
      await expect(admin.query(`delete from identity.lookup_audit`)).rejects.toThrow(/append-only/);
      await expect(admin.query(`update identity.lookup_audit set actor = 'x'`)).rejects.toThrow(
        /append-only/,
      );
      await run();
      await audit(2000);
      await expect(admin.query(`delete from identity.lookup_audit`)).rejects.toThrow(/append-only/);
    });

    it("keeps the purge log append-only too", async () => {
      await audit(2000);
      await run();
      await expect(admin.query(`delete from identity.lookup_audit_purges`)).rejects.toThrow(
        /append-only/,
      );
      await expect(
        admin.query(`update identity.lookup_audit_purges set rows_deleted = 99`),
      ).rejects.toThrow(/append-only/);
    });

    it("lets trust & safety read the purge log but nobody else", async () => {
      await audit(2000);
      await run();
      expect((await tsPool.query(`select * from identity.lookup_audit_purges`)).rowCount).toBe(1);
      for (const [name, p] of [
        ["app_api", appPool],
        ["moderator", modPool],
        ["auth_service", authPool],
        ["account_lifecycle", lifePool],
      ] as const) {
        await expect(p.query(`select * from identity.lookup_audit_purges`), name).rejects.toThrow(
          /permission denied/,
        );
      }
    });
  });

  describe("safety rails", () => {
    it("refuses periods below the minimum, so a typo cannot wipe recent records", async () => {
      const a = await account();
      await report({ status: "dismissed", resolvedDaysAgo: 5, reporter: a.id });
      await audit(10);

      const tooShort: Partial<typeof DEFAULTS>[] = [
        { dismissedReportDays: 29 },
        { resolvedRecordDays: 179 },
        { appealRecordDays: 179 },
        { warningMonths: 2 },
        { auditLogYears: 0 },
      ];
      for (const over of tooShort) {
        await expect(run(over), JSON.stringify(over)).rejects.toMatchObject({ code: "MD010" });
      }
      expect(await count(`select count(*)::int n from moderation.reports`)).toBe(1);
      expect(await count(`select count(*)::int n from identity.lookup_audit`)).toBe(1);
    });

    it("does nothing at all when there is nothing due", async () => {
      const a = await account();
      await report({ status: "dismissed", resolvedDaysAgo: 5, reporter: a.id });
      await penalty({ accountId: a.id, kind: "suspension", startedDaysAgo: 20, endedDaysAgo: 10 });
      await appeal({ accountId: a.id, status: "open" });
      await audit(10);

      expect(await run()).toEqual({
        warningsExpired: 0,
        reportsPurged: 0,
        actionsPurged: 0,
        penaltiesPurged: 0,
        appealsScrubbed: 0,
        auditRowsPurged: 0,
      });
    });

    it("is idempotent", async () => {
      const a = await account({ strikes: 1 });
      await report({ status: "dismissed", resolvedDaysAgo: 200, reporter: a.id });
      await penalty({ accountId: a.id, kind: "warning", startedDaysAgo: 500 });
      await action({ daysAgo: 500 });
      await audit(2000);

      const first = await run();
      expect(first.reportsPurged + first.actionsPurged + first.penaltiesPurged + first.auditRowsPurged).toBe(4);
      expect(await run()).toEqual({
        warningsExpired: 0,
        reportsPurged: 0,
        actionsPurged: 0,
        penaltiesPurged: 0,
        appealsScrubbed: 0,
        auditRowsPurged: 0,
      });
    });

    it("only the lifecycle login can run it", async () => {
      const args = [NOW, 90, 365, 365, 12, 3];
      for (const [name, p] of [
        ["app_api", appPool],
        ["moderator", modPool],
        ["auth_service", authPool],
        ["trust_safety", tsPool],
      ] as const) {
        await expect(
          p.query(`select * from moderation.purge_expired_records($1,$2,$3,$4,$5,$6)`, args),
          name,
        ).rejects.toThrow(/permission denied/);
      }
      await expect(
        lifePool.query(`select * from moderation.purge_expired_records($1,$2,$3,$4,$5,$6)`, args),
      ).resolves.toBeTruthy();
    });

    it("gives the lifecycle login no direct delete rights, and no view of holds or the audit log", async () => {
      await expect(lifePool.query(`delete from moderation.reports`)).rejects.toThrow(/permission denied/);
      await expect(lifePool.query(`delete from moderation.actions`)).rejects.toThrow(/permission denied/);
      await expect(lifePool.query(`delete from moderation.penalties`)).rejects.toThrow(/permission denied/);
      await expect(lifePool.query(`delete from moderation.appeals`)).rejects.toThrow(/permission denied/);
      await expect(lifePool.query(`delete from identity.lookup_audit`)).rejects.toThrow(/permission denied/);
      await expect(lifePool.query(`select * from moderation.legal_holds`)).rejects.toThrow(/permission denied/);
      await expect(lifePool.query(`select * from identity.lookup_audit`)).rejects.toThrow(/permission denied/);
    });

    it("keeps legal holds invisible to every application login", async () => {
      await hold({ scope: "audit_case", caseRef: "HC/2026/114" });
      for (const [name, p] of [
        ["app_api", appPool],
        ["moderator", modPool],
        ["auth_service", authPool],
        ["trust_safety", tsPool],
      ] as const) {
        await expect(p.query(`select * from moderation.legal_holds`), name).rejects.toThrow(
          /permission denied/,
        );
        await expect(
          p.query(
            `insert into moderation.legal_holds (scope, case_ref, reason, placed_by)
             values ('audit_case', 'x', 'long enough reason', 'me')`,
          ),
          name,
        ).rejects.toThrow(/permission denied/);
      }
    });

    it("rejects malformed holds", async () => {
      await expect(
        admin.query(
          `insert into moderation.legal_holds (scope, reason, placed_by)
           values ('account', 'long enough reason', 'me')`,
        ),
      ).rejects.toThrow(/check constraint/);
      await expect(
        admin.query(
          `insert into moderation.legal_holds (scope, case_ref, reason, placed_by)
           values ('audit_case', 'R-1', 'short', 'me')`,
        ),
      ).rejects.toThrow(/check constraint/);
    });
  });

  it("runs as part of the lifecycle sweep and reports what it did", async () => {
    const a = await account({ strikes: 1 });
    await report({ status: "dismissed", resolvedDaysAgo: 120, reporter: a.id });
    await penalty({ accountId: a.id, kind: "warning", startedDaysAgo: 500 });
    await audit(2000);

    const r = await runLifecycleSweep(
      lifecycle,
      { reverifyGraceDays: 30, purgeAfterDays: 30 },
      NOW,
    );
    expect(r).toMatchObject({
      warningsExpired: 1,
      reportsPurged: 1,
      penaltiesPurged: 1,
      auditRowsPurged: 1,
    });
  });
});
