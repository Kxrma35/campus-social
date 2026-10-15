import type { PhotoStore } from "../content/photos.js";
import { runReminders, type ReminderStore } from "./reminders.js";
import type { Mailer } from "../auth/mailer.js";

export type CloseReason = "user_request" | "reverification_expired";

export interface CloseInput {
  accountId: string;
  reason: CloseReason;
  now: Date;
}

export interface ExportPhoto {
  id: string;
  url: string;
  width: number;
  height: number;
  /** The description you wrote for the photo, if any. */
  altText: string | null;
}

export interface ModerationExport {
  /** Reports you made, in full: they are your own words. */
  reportsFiled: {
    targetKind: string;
    targetId: string;
    reason: string;
    detail: string | null;
    status: string;
    createdAt: string;
  }[];
  reportsAboutYourContent: {
    targetKind: string;
    targetId: string;
    reason: string;
    source: string;
    status: string;
    createdAt: string;
  }[];
  penalties: {
    kind: string;
    startsAt: string;
    endsAt: string | null;
    expiredAt: string | null;
    reason: string | null;
  }[];
  actionsOnYourContent: {
    kind: string;
    targetKind: string | null;
    targetId: string | null;
    note: string | null;
    createdAt: string;
  }[];
  appeals: {
    message: string;
    status: string;
    createdAt: string;
    decidedAt: string | null;
    decisionNote: string | null;
  }[];
}

export interface AccountExport {
  schemaVersion: 2;
  exportedAt: string;
  notice: string;
  account: {
    email: string;
    status: string;
    dateOfBirth: string | null;
    termsVersion: string;
    termsAcceptedAt: string;
    createdAt: string;
    lastReverifiedAt: string;
    reverifyDueAt: string;
    /** Warnings that currently count against the account. */
    warningsCounting: number;
    closedAt: string | null;
  };
  profiles: {
    kind: "known" | "anonymous";
    handle: string;
    displayName: string | null;
    course: string | null;
    studyYear: number | null;
    createdAt: string;
  }[];
  posts: {
    profile: "known" | "anonymous";
    body: string;
    photos: ExportPhoto[];
    createdAt: string;
    hidden: boolean;
    hiddenReason: string | null;
  }[];
  comments: {
    profile: "known" | "anonymous";
    body: string;
    createdAt: string;
    hidden: boolean;
  }[];
  reactions: {
    profile: "known" | "anonymous";
    on: "post" | "comment";
    targetId: string;
    createdAt: string;
  }[];
  following: { as: "known" | "anonymous"; handle: string }[];
  /** Counts only. The people who follow you are not listed. */
  followers: { profile: "known" | "anonymous"; count: number }[];
  notifications: {
    profile: "known" | "anonymous";
    kind: string;
    createdAt: string;
    read: boolean;
    fromHandle: string | null;
  }[];
  photos: (ExportPhoto & { uploadedAt: string; attachedToPost: boolean })[];
  sessions: {
    deviceLabel: string | null;
    createdAt: string;
    expiresAt: string;
    revoked: boolean;
  }[];
  moderation: ModerationExport;
  notIncluded: string[];
}

export const EXPORT_NOTICE =
  "This file connects your known profile and your anonymous profile. Anyone who has it can see they belong to the same person. Keep it private.";

export const EXPORT_NOT_INCLUDED: string[] = [
  "Who reported your content, and what they wrote. Reporters are kept confidential, so reports about you show only the reason and the outcome.",
  "The names of moderators and staff. Decisions are shown with their reasons, not who made them.",
  "Other people's posts, comments, names and follower lists. Only public handles and counts appear.",
  "Sign-in codes and session tokens. These are stored only as one-way hashes, so there is nothing to export.",
  "Technical server logs (such as IP addresses). They are not kept in a form that can be looked up per person [counsel to confirm].",
  "Internal security records, such as whether staff investigated an account, where telling you would harm a legal or safety process [counsel to confirm].",
];

export class AnonymousResolverMissing extends Error {
  constructor() {
    super("account has an anonymous profile but no resolver is configured");
  }
}

export interface ModerationPurgeResult {
  warningsExpired: number;
  reportsPurged: number;
  actionsPurged: number;
  penaltiesPurged: number;
  appealsScrubbed: number;
  auditRowsPurged: number;
}

export class AnonymousLinkUnreadable extends AnonymousResolverMissing {
  constructor() {
    super();
    this.message = "an anonymous link could not be opened with the configured keys";
  }
}

export interface PurgeResult {
  purged: number;
  skipped: number;
}

export interface LifecycleStore extends ReminderStore {
  purgeOldReminders(cutoff: Date): Promise<number>;

  markOverdueReadOnly(now: Date): Promise<number>;

  hideBannedAnonymousContent(now: Date): Promise<{ hidden: number; skipped: number }>;

  restoreUnbannedAnonymousContent(): Promise<{ restored: number; skipped: number }>;

  liftExpiredSuspensions(now: Date): Promise<number>;

  closeExpiredGrace(now: Date, graceDays: number): Promise<{ closed: number; skipped: number }>;

  closeAccount(input: CloseInput): Promise<boolean>;

  purgeClosedBefore(cutoff: Date): Promise<PurgeResult>;

  exportAccount(accountId: string, now: Date): Promise<AccountExport>;

  purgeDeletedContent(
    cutoff: Date,
    batchSize?: number,
  ): Promise<{ posts: number; comments: number }>;

  cleanupStaleRecords(input: {
    now: Date;
    codeRetentionHours: number;
    sessionRetentionDays: number;
    staleUploadHours: number;
  }): Promise<{ codes: number; sessions: number; uploads: number }>;

  purgeModerationRecords(input: {
    now: Date;
    dismissedReportDays: number;
    resolvedRecordDays: number;
    appealRecordDays: number;
    warningMonths: number;
    auditLogYears: number;
  }): Promise<ModerationPurgeResult>;

  takeStorageDeletions(limit: number): Promise<string[]>;
  completeStorageDeletions(keys: string[]): Promise<void>;
  countStorageDeletions(): Promise<number>;
}

export interface SweepOptions {
  reverifyGraceDays: number;
  purgeAfterDays: number;
  codeRetentionHours?: number;
  sessionRetentionDays?: number;
  staleUploadHours?: number;
  dismissedReportDays?: number;
  resolvedRecordDays?: number;
  appealRecordDays?: number;
  warningMonths?: number;
  auditLogYears?: number;
  reminderDueSoonDays?: number[];
  reminderClosingSoonDays?: number[];
  reminderMaxPerRun?: number;
  reminderRetentionDays?: number;
}

export interface SweepResult {
  remindersSent: number;
  remindersFailed: number;
  remindersPurged: number;
  hiddenBannedAnonymous: number;
  restoredAnonymous: number;
  liftedSuspensions: number;
  markedReadOnly: number;
  closed: number;
  purged: number;
  purgedPosts: number;
  purgedComments: number;
  expiredCodes: number;
  expiredSessions: number;
  staleUploads: number;
  warningsExpired: number;
  reportsPurged: number;
  actionsPurged: number;
  penaltiesPurged: number;
  appealsScrubbed: number;
  auditRowsPurged: number;
  filesDeleted: number;
  filesFailed: number;
  filesPending: number;
  skipped: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const FILE_BATCH = 500;

async function drainStorage(
  store: LifecycleStore,
  photos: PhotoStore | undefined,
): Promise<{ deleted: number; failed: number; pending: number }> {
  if (!photos) return { deleted: 0, failed: 0, pending: await store.countStorageDeletions() };

  let deleted = 0;
  let failed = 0;
  for (;;) {
    const keys = await store.takeStorageDeletions(FILE_BATCH);
    if (keys.length === 0) break;

    const done: string[] = [];
    for (const key of keys) {
      try {
        await photos.delete(key);
        done.push(key);
      } catch {
        failed += 1;
      }
    }
    await store.completeStorageDeletions(done);
    deleted += done.length;
    if (failed > 0 || keys.length < FILE_BATCH) break;
  }
  return { deleted, failed, pending: await store.countStorageDeletions() };
}

export async function runLifecycleSweep(
  store: LifecycleStore,
  opts: SweepOptions,
  now: Date,
  photos?: PhotoStore,
  mailer?: Mailer,
): Promise<SweepResult> {
  const hiding = await store.hideBannedAnonymousContent(now);
  const restoring = await store.restoreUnbannedAnonymousContent();
  const liftedSuspensions = await store.liftExpiredSuspensions(now);
  const markedReadOnly = await store.markOverdueReadOnly(now);
  const closing = await store.closeExpiredGrace(now, opts.reverifyGraceDays);

  const reminders = mailer
    ? await runReminders(
        store,
        mailer,
        {
          dueSoonDays: opts.reminderDueSoonDays ?? [30, 7],
          closingSoonDays: opts.reminderClosingSoonDays ?? [7],
          graceDays: opts.reverifyGraceDays,
          purgeDays: opts.purgeAfterDays,
          maxPerRun: opts.reminderMaxPerRun ?? 500,
        },
        now,
      )
    : { sent: 0, failed: 0 };
  const remindersPurged = await store.purgeOldReminders(
    new Date(now.getTime() - (opts.reminderRetentionDays ?? 400) * DAY_MS),
  );

  const cutoff = new Date(now.getTime() - opts.purgeAfterDays * DAY_MS);
  const content = await store.purgeDeletedContent(cutoff);
  const purging = await store.purgeClosedBefore(cutoff);
  const stale = await store.cleanupStaleRecords({
    now,
    codeRetentionHours: opts.codeRetentionHours ?? 24,
    sessionRetentionDays: opts.sessionRetentionDays ?? 7,
    staleUploadHours: opts.staleUploadHours ?? 24,
  });
  const moderation = await store.purgeModerationRecords({
    now,
    dismissedReportDays: opts.dismissedReportDays ?? 90,
    resolvedRecordDays: opts.resolvedRecordDays ?? 365,
    appealRecordDays: opts.appealRecordDays ?? 365,
    warningMonths: opts.warningMonths ?? 12,
    auditLogYears: opts.auditLogYears ?? 3,
  });
  const files = await drainStorage(store, photos);

  return {
    remindersSent: reminders.sent,
    remindersFailed: reminders.failed,
    remindersPurged,
    hiddenBannedAnonymous: hiding.hidden,
    restoredAnonymous: restoring.restored,
    liftedSuspensions,
    markedReadOnly,
    closed: closing.closed,
    purged: purging.purged,
    purgedPosts: content.posts,
    purgedComments: content.comments,
    expiredCodes: stale.codes,
    expiredSessions: stale.sessions,
    staleUploads: stale.uploads,
    warningsExpired: moderation.warningsExpired,
    reportsPurged: moderation.reportsPurged,
    actionsPurged: moderation.actionsPurged,
    penaltiesPurged: moderation.penaltiesPurged,
    appealsScrubbed: moderation.appealsScrubbed,
    auditRowsPurged: moderation.auditRowsPurged,
    filesDeleted: files.deleted,
    filesFailed: files.failed,
    filesPending: files.pending,
    skipped: closing.skipped + purging.skipped + hiding.skipped + restoring.skipped,
  };
}
