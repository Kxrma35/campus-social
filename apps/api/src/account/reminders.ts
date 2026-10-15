import type { Mailer, ReverifyReminder } from "../auth/mailer.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CANDIDATE_LIMIT = 50_000;

export type ReminderKind = "due_soon" | "closing_soon";

export interface ReminderOptions {
  dueSoonDays: number[];
  closingSoonDays: number[];
  graceDays: number;
  purgeDays: number;
  maxPerRun: number;
}

export interface ReminderCandidate {
  accountId: string;
  email: string;
  status: "active" | "read_only";
  reverifyDueAt: Date;
  sent: { kind: ReminderKind; thresholdDays: number }[];
}

export interface PlannedReminder {
  kind: ReminderKind;
  thresholdDays: number;
  daysLeft: number;
  deadline: Date;
}

export interface ReminderStore {
  listReminderCandidates(
    now: Date,
    input: { dueHorizonDays: number; closingHorizonDays: number; graceDays: number; limit: number },
  ): Promise<ReminderCandidate[]>;
  recordReminder(input: {
    accountId: string;
    kind: ReminderKind;
    thresholdDays: number;
    cycleDueAt: Date;
    now: Date;
  }): Promise<void>;
}

export interface ReminderResult {
  sent: number;
  failed: number;
}

export function planReminder(
  c: ReminderCandidate,
  now: Date,
  opts: Pick<ReminderOptions, "dueSoonDays" | "closingSoonDays" | "graceDays">,
): PlannedReminder | null {
  const kind: ReminderKind = c.status === "active" ? "due_soon" : "closing_soon";
  const deadline =
    c.status === "active"
      ? c.reverifyDueAt
      : new Date(c.reverifyDueAt.getTime() + opts.graceDays * DAY_MS);
  const thresholds = [...(kind === "due_soon" ? opts.dueSoonDays : opts.closingSoonDays)].sort((a, b) => a - b);

  const msLeft = deadline.getTime() - now.getTime();
  if (msLeft <= 0) return null;
  const daysLeft = Math.ceil(msLeft / DAY_MS);

  const applicable = thresholds.filter((t) => daysLeft <= t);
  if (applicable.length === 0) return null;
  const thresholdDays = applicable[0]!;

  const alreadySent = c.sent.some((s) => s.kind === kind && s.thresholdDays <= thresholdDays);
  if (alreadySent) return null;
  return { kind, thresholdDays, daysLeft, deadline };
}

export async function runReminders(
  store: ReminderStore,
  mailer: Mailer,
  opts: ReminderOptions,
  now: Date,
): Promise<ReminderResult> {
  const dueHorizonDays = Math.max(0, ...opts.dueSoonDays);
  const closingHorizonDays = Math.max(0, ...opts.closingSoonDays);
  if (dueHorizonDays === 0 && closingHorizonDays === 0) return { sent: 0, failed: 0 };

  const candidates = await store.listReminderCandidates(now, {
    dueHorizonDays,
    closingHorizonDays,
    graceDays: opts.graceDays,
    limit: CANDIDATE_LIMIT,
  });

  let sent = 0;
  let failed = 0;
  for (const c of candidates) {
    if (sent + failed >= opts.maxPerRun) break;
    const plan = planReminder(c, now, opts);
    if (!plan) continue;
    const reminder: ReverifyReminder = {
      kind: plan.kind,
      daysLeft: plan.daysLeft,
      deadline: plan.deadline,
      graceDays: opts.graceDays,
      purgeDays: opts.purgeDays,
    };
    try {
      await mailer.sendReverifyReminder(c.email, reminder);
    } catch {
      failed += 1;
      continue;
    }
    await store.recordReminder({
      accountId: c.accountId,
      kind: plan.kind,
      thresholdDays: plan.thresholdDays,
      cycleDueAt: c.reverifyDueAt,
      now,
    });
    sent += 1;
  }
  return { sent, failed };
}
