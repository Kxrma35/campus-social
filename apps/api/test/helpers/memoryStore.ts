import { randomUUID } from "node:crypto";
import { safeEqual } from "../../src/auth/crypto.js";
import type { Mailer } from "../../src/auth/mailer.js";
import type {
  AccountRow,
  AccountStatus,
  AuthStore,
  CodePurpose,
  ConsumeOutcome,
  CreateAccountResult,
  NewAccount,
  SessionRow,
  University,
} from "../../src/auth/store.js";
import {
  AnonymousResolverMissing,
  EXPORT_NOT_INCLUDED,
  EXPORT_NOTICE,
  type AccountExport,
  type CloseInput,
  type LifecycleStore,
  type PurgeResult,
} from "../../src/account/lifecycleStore.js";

interface CodeRow {
  email: string;
  codeHash: Buffer;
  purpose: CodePurpose;
  expiresAt: Date;
  createdAt: Date;
  attempts: number;
  consumed: boolean;
}

interface SessionRec {
  accountId: string;
  expiresAt: Date;
  revoked: boolean;
  revokedAt?: Date;
}

export interface MemAccount extends AccountRow {
  dateOfBirth: string | null;
  termsVersion: string;
  createdAt: Date;
  lastReverifiedAt: Date;
  reverifyDueAt: Date;
  closedAt: Date | null;
  closedReason: string | null;
  purgedAt: Date | null;
  hasAnonymousProfile: boolean;
  suspensionEndsAt: Date | null;
  strikeCount: number;
  anonLink: Buffer | null;
}

export interface MemProfile {
  id: string;
  accountId: string;
  kind: "known" | "anonymous";
  handle: string;
  displayName: string | null;
  course?: string | null;
  studyYear?: number | null;
  editWindowStartedAt?: Date | null;
  editsInWindow?: number;
  deletedAt: Date | null;
}

export interface MemPost {
  id: string;
  profileId: string;
  body: string;
  deletedAt: Date | null;
  hidden?: boolean;
  hiddenReason?: string | null;
  photoKeys?: string[];
}

export interface MemComment {
  id: string;
  postId: string;
  profileId: string;
  deletedAt: Date | null;
}

export interface MemUpload {
  key: string;
  profileId: string;
  createdAt: Date;
  attached: boolean;
}

export class MemoryAuthStore implements AuthStore {
  universities: University[] = [];
  bannedHashes: Buffer[] = [];
  accounts = new Map<string, MemAccount>();
  profiles = new Map<string, MemProfile>();
  posts: MemPost[] = [];
  comments: MemComment[] = [];
  uploads: MemUpload[] = [];
  storageDeletions: string[] = [];
  openReportTargets = new Set<string>();
  codes: CodeRow[] = [];
  sessions = new Map<string, SessionRec>();

  async findUniversityByDomain(domain: string) {
    return this.universities.find((u) => u.emailDomain === domain) ?? null;
  }

  async isEmailBanned(emailHash: Buffer) {
    return this.bannedHashes.some((h) => safeEqual(h, emailHash));
  }

  async findAccountByEmail(email: string) {
    for (const a of this.accounts.values()) if (a.email === email) return a;
    return null;
  }

  async countCodesSince(email: string, since: Date) {
    return this.codes.filter((c) => c.email === email && c.createdAt >= since).length;
  }

  async createCode(input: {
    email: string;
    codeHash: Buffer;
    purpose: CodePurpose;
    expiresAt: Date;
    now: Date;
  }) {
    this.codes.push({
      email: input.email,
      codeHash: input.codeHash,
      purpose: input.purpose,
      expiresAt: input.expiresAt,
      createdAt: input.now,
      attempts: 0,
      consumed: false,
    });
  }

  async consumeCode(input: {
    email: string;
    purpose: CodePurpose;
    codeHash: Buffer;
    now: Date;
    maxAttempts: number;
  }): Promise<ConsumeOutcome> {
    const row = this.codes
      .filter((c) => c.email === input.email && c.purpose === input.purpose && !c.consumed)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!row) return "invalid";
    if (row.attempts >= input.maxAttempts) return "too_many_attempts";
    if (row.expiresAt <= input.now) return "expired";
    if (!safeEqual(row.codeHash, input.codeHash)) {
      row.attempts += 1;
      return "invalid";
    }
    row.consumed = true;
    return "ok";
  }

  async createAccountWithKnownProfile(input: NewAccount): Promise<CreateAccountResult> {
    if (await this.findAccountByEmail(input.email)) return { kind: "email_taken" };
    for (const p of this.profiles.values()) {
      if (p.handle === input.profile.handle) return { kind: "handle_taken" };
    }
    const accountId = randomUUID();
    const profileId = randomUUID();
    this.accounts.set(accountId, {
      id: accountId,
      email: input.email,
      status: "active",
      universityId: input.universityId,
      dateOfBirth: input.dateOfBirth,
      termsVersion: input.termsVersion,
      createdAt: input.now,
      lastReverifiedAt: input.now,
      reverifyDueAt: input.reverifyDueAt,
      closedAt: null,
      closedReason: null,
      purgedAt: null,
      hasAnonymousProfile: false,
      suspensionEndsAt: null,
      strikeCount: 0,
      anonLink: null,
    });
    this.profiles.set(profileId, {
      id: profileId,
      accountId,
      kind: "known",
      handle: input.profile.handle,
      displayName: input.profile.displayName,
      course: input.profile.course,
      studyYear: input.profile.studyYear,
      editWindowStartedAt: null,
      editsInWindow: 0,
      deletedAt: null,
    });
    return { kind: "created", accountId, profileId };
  }

  appeals = new Map<string, { message: string; createdAt: Date }>();
  avatars = new Map<string, string>();

  async getKnownProfileDetails(profileId: string) {
    const p = this.profiles.get(profileId);
    if (!p || p.kind !== "known" || p.deletedAt || p.displayName === null) return null;
    return {
      profileId: p.id,
      handle: p.handle,
      displayName: p.displayName,
      course: p.course ?? null,
      studyYear: p.studyYear ?? null,
    };
  }

  async updateKnownProfile(input: {
    profileId: string;
    now: Date;
    set: { displayName?: string; course?: string | null; studyYear?: number | null; handle?: string };
    maxEdits: number;
    windowDays: number;
  }) {
    const p = this.profiles.get(input.profileId);
    if (!p || p.kind !== "known" || p.deletedAt) return "not_found" as const;

    const windowMs = input.windowDays * 24 * 60 * 60 * 1000;
    const start = p.editWindowStartedAt ?? null;
    const expired = start === null || start.getTime() <= input.now.getTime() - windowMs;
    if (!expired && (p.editsInWindow ?? 0) >= input.maxEdits) return "rate_limited" as const;

    if (input.set.handle !== undefined) {
      for (const other of this.profiles.values()) {
        if (other.id !== p.id && other.handle === input.set.handle) return "handle_taken" as const;
      }
      p.handle = input.set.handle;
    }
    if (input.set.displayName !== undefined) p.displayName = input.set.displayName;
    if (input.set.course !== undefined) p.course = input.set.course;
    if (input.set.studyYear !== undefined) p.studyYear = input.set.studyYear;

    p.editWindowStartedAt = expired ? input.now : start;
    p.editsInWindow = expired ? 1 : (p.editsInWindow ?? 0) + 1;
    return "updated" as const;
  }

  async getStanding(accountId: string) {
    const a = this.accounts.get(accountId);
    return a ? { createdAt: a.createdAt, strikeCount: a.strikeCount, status: a.status } : null;
  }

  async getAnonymousLink(accountId: string) {
    return this.accounts.get(accountId)?.anonLink ?? null;
  }

  async createAnonymousProfile(input: {
    accountId: string;
    profileId: string;
    handle: string;
    avatarKey: string;
    enc: Buffer;
  }) {
    const a = this.accounts.get(input.accountId);
    if (!a || a.anonLink) return "exists" as const;
    for (const p of this.profiles.values()) {
      if (p.handle === input.handle) return "handle_taken" as const;
    }
    a.anonLink = input.enc;
    a.hasAnonymousProfile = true;
    this.profiles.set(input.profileId, {
      id: input.profileId,
      accountId: input.accountId,
      kind: "anonymous",
      handle: input.handle,
      displayName: null,
      deletedAt: null,
    });
    this.avatars.set(input.profileId, input.avatarKey);
    return "created" as const;
  }

  async getProfileBasics(profileId: string) {
    const p = this.profiles.get(profileId);
    return p ? { handle: p.handle, avatarKey: this.avatars.get(profileId) ?? null } : null;
  }

  async createAppeal(input: { accountId: string; message: string; now: Date }) {
    if (this.appeals.has(input.accountId)) return "exists" as const;
    this.appeals.set(input.accountId, { message: input.message, createdAt: input.now });
    return "created" as const;
  }

  async markReverified(input: { accountId: string; now: Date; dueAt: Date }) {
    const a = this.accounts.get(input.accountId);
    if (!a) return;
    a.lastReverifiedAt = input.now;
    a.reverifyDueAt = input.dueAt;
    if (a.status === "read_only") a.status = "active";
  }

  async createSession(input: { accountId: string; tokenHash: Buffer; expiresAt: Date }) {
    this.sessions.set(input.tokenHash.toString("hex"), {
      accountId: input.accountId,
      expiresAt: input.expiresAt,
      revoked: false,
    });
  }

  async findSession(tokenHash: Buffer, now: Date): Promise<SessionRow | null> {
    const s = this.sessions.get(tokenHash.toString("hex"));
    if (!s || s.revoked || s.expiresAt <= now) return null;
    const account = this.accounts.get(s.accountId);
    if (!account) return null;
    const profile = [...this.profiles.values()].find(
      (p) => p.accountId === s.accountId && p.kind === "known",
    );
    if (!profile) return null;
    return {
      accountId: account.id,
      email: account.email,
      status: account.status,
      knownProfileId: profile.id,
    };
  }

  async revokeSession(tokenHash: Buffer, now: Date = new Date()) {
    const s = this.sessions.get(tokenHash.toString("hex"));
    if (s) {
      s.revoked = true;
      s.revokedAt = now;
    }
  }

  setStatus(email: string, status: AccountStatus) {
    for (const a of this.accounts.values()) if (a.email === email) a.status = status;
  }

  accountByEmail(email: string): MemAccount {
    for (const a of this.accounts.values()) if (a.email === email) return a;
    throw new Error(`no account ${email}`);
  }

  addPostAs(profileId: string, body: string): MemPost {
    const post: MemPost = { id: randomUUID(), profileId, body, deletedAt: null };
    this.posts.push(post);
    return post;
  }

  addPost(accountId: string, body: string): MemPost {
    const profile = [...this.profiles.values()].find(
      (p) => p.accountId === accountId && p.kind === "known",
    );
    if (!profile) throw new Error("no profile");
    const post = { id: randomUUID(), profileId: profile.id, body, deletedAt: null };
    this.posts.push(post);
    return post;
  }
}

export class MemoryLifecycleStore implements LifecycleStore {
  constructor(
    private readonly db: MemoryAuthStore,
    private readonly opts: { canResolveAnonymous?: boolean } = {},
  ) {}

  private queueFile(key: string) {
    if (!this.db.storageDeletions.includes(key)) this.db.storageDeletions.push(key);
  }

  async purgeDeletedContent(cutoff: Date) {
    const due = (d: Date | null) => !!d && d <= cutoff;

    const doomedPosts = this.db.posts.filter(
      (p) => due(p.deletedAt) && !this.db.openReportTargets.has(`post:${p.id}`),
    );
    const doomedIds = new Set(doomedPosts.map((p) => p.id));
    for (const post of doomedPosts) {
      for (const key of post.photoKeys ?? []) {
        this.queueFile(key);
        this.db.uploads = this.db.uploads.filter((u) => u.key !== key);
      }
    }
    this.db.posts = this.db.posts.filter((p) => !doomedIds.has(p.id));
    this.db.comments = this.db.comments.filter((c) => !doomedIds.has(c.postId));

    const doomedComments = this.db.comments.filter(
      (c) => due(c.deletedAt) && !this.db.openReportTargets.has(`comment:${c.id}`),
    );
    const commentIds = new Set(doomedComments.map((c) => c.id));
    this.db.comments = this.db.comments.filter((c) => !commentIds.has(c.id));

    return { posts: doomedPosts.length, comments: doomedComments.length };
  }

  async cleanupStaleRecords(input: {
    now: Date;
    codeRetentionHours: number;
    sessionRetentionDays: number;
    staleUploadHours: number;
  }) {
    const codeCutoff = new Date(input.now.getTime() - input.codeRetentionHours * 3_600_000);
    const sessionCutoff = new Date(input.now.getTime() - input.sessionRetentionDays * 86_400_000);
    const uploadCutoff = new Date(input.now.getTime() - input.staleUploadHours * 3_600_000);

    const codesBefore = this.db.codes.length;
    this.db.codes = this.db.codes.filter((c) => c.createdAt >= codeCutoff);

    let sessions = 0;
    for (const [key, s] of this.db.sessions) {
      if (s.expiresAt < sessionCutoff || (s.revokedAt && s.revokedAt < sessionCutoff)) {
        this.db.sessions.delete(key);
        sessions += 1;
      }
    }

    const stale = this.db.uploads.filter((u) => !u.attached && u.createdAt < uploadCutoff);
    for (const u of stale) this.queueFile(u.key);
    this.db.uploads = this.db.uploads.filter((u) => !stale.includes(u));

    return {
      codes: codesBefore - this.db.codes.length,
      sessions,
      uploads: stale.length,
    };
  }

  moderationPurgeCalls: Parameters<LifecycleStore["purgeModerationRecords"]>[0][] = [];

  async purgeModerationRecords(input: Parameters<LifecycleStore["purgeModerationRecords"]>[0]) {
    this.moderationPurgeCalls.push(input);
    return {
      warningsExpired: 0,
      reportsPurged: 0,
      actionsPurged: 0,
      penaltiesPurged: 0,
      appealsScrubbed: 0,
      auditRowsPurged: 0,
    };
  }

  async takeStorageDeletions(limit: number) {
    return this.db.storageDeletions.slice(0, limit);
  }

  async completeStorageDeletions(keys: string[]) {
    const done = new Set(keys);
    this.db.storageDeletions = this.db.storageDeletions.filter((k) => !done.has(k));
  }

  async countStorageDeletions() {
    return this.db.storageDeletions.length;
  }

  private blocked(a: MemAccount): boolean {
    return a.hasAnonymousProfile && !this.opts.canResolveAnonymous;
  }

  async hideBannedAnonymousContent(now: Date) {
    let hidden = 0;
    let skipped = 0;
    for (const a of this.db.accounts.values()) {
      if (a.status !== "banned" || !a.hasAnonymousProfile) continue;
      if (this.blocked(a)) {
        skipped += 1;
        continue;
      }
      let changed = false;
      for (const p of this.db.profiles.values()) {
        if (p.accountId !== a.id || p.kind !== "anonymous" || p.deletedAt) continue;
        p.deletedAt = now;
        changed = true;
      }
      for (const post of this.db.posts) {
        const owner = this.db.profiles.get(post.profileId);
        if (owner?.accountId === a.id && owner.kind === "anonymous" && !post.hidden && !post.deletedAt) {
          post.hidden = true;
          post.hiddenReason = "account_banned";
          changed = true;
        }
      }
      if (changed) hidden += 1;
    }
    return { hidden, skipped };
  }

  async restoreUnbannedAnonymousContent() {
    let restored = 0;
    let skipped = 0;
    for (const a of this.db.accounts.values()) {
      if (!["active", "read_only"].includes(a.status) || !a.hasAnonymousProfile) continue;
      if (this.blocked(a)) {
        skipped += 1;
        continue;
      }
      let changed = false;
      for (const p of this.db.profiles.values()) {
        if (p.accountId === a.id && p.kind === "anonymous" && p.deletedAt) {
          p.deletedAt = null;
          changed = true;
        }
      }
      for (const post of this.db.posts) {
        const owner = this.db.profiles.get(post.profileId);
        if (owner?.accountId === a.id && post.hiddenReason === "account_banned") {
          post.hidden = false;
          post.hiddenReason = null;
          changed = true;
        }
      }
      if (changed) restored += 1;
    }
    return { restored, skipped };
  }

  async liftExpiredSuspensions(now: Date) {
    let n = 0;
    for (const a of this.db.accounts.values()) {
      if (a.status === "suspended" && a.suspensionEndsAt && a.suspensionEndsAt <= now) {
        a.status = "active";
        a.suspensionEndsAt = null;
        n += 1;
      }
    }
    return n;
  }

  async markOverdueReadOnly(now: Date) {
    let n = 0;
    for (const a of this.db.accounts.values()) {
      if (a.status === "active" && a.reverifyDueAt <= now) {
        a.status = "read_only";
        n += 1;
      }
    }
    return n;
  }

  async closeExpiredGrace(now: Date, graceDays: number) {
    const cutoff = new Date(now.getTime() - graceDays * 24 * 60 * 60 * 1000);
    let closed = 0;
    let skipped = 0;
    for (const a of [...this.db.accounts.values()]) {
      if (a.status === "read_only" && a.reverifyDueAt <= cutoff) {
        try {
          if (await this.closeAccount({ accountId: a.id, reason: "reverification_expired", now })) {
            closed += 1;
          }
        } catch (err) {
          if (err instanceof AnonymousResolverMissing) skipped += 1;
          else throw err;
        }
      }
    }
    return { closed, skipped };
  }

  async closeAccount(input: CloseInput) {
    const a = this.db.accounts.get(input.accountId);
    if (!a) return false;
    if (this.blocked(a)) throw new AnonymousResolverMissing();
    if (!["active", "read_only", "suspended"].includes(a.status)) return false;

    a.status = "closed";
    a.closedAt = input.now;
    a.closedReason = input.reason;
    for (const [key, s] of this.db.sessions) {
      if (s.accountId === a.id) this.db.sessions.set(key, { ...s, revoked: true, revokedAt: input.now });
    }
    for (const p of this.db.profiles.values()) {
      if (p.accountId === a.id) p.deletedAt = input.now;
    }
    const mine = new Set(
      [...this.db.profiles.values()].filter((p) => p.accountId === a.id).map((p) => p.id),
    );
    for (const post of this.db.posts) {
      if (mine.has(post.profileId) && !post.deletedAt) post.deletedAt = input.now;
    }
    return true;
  }

  async purgeClosedBefore(cutoff: Date): Promise<PurgeResult> {
    let purged = 0;
    let skipped = 0;
    for (const a of this.db.accounts.values()) {
      if (a.status !== "closed" || a.purgedAt || !a.closedAt || a.closedAt > cutoff) continue;
      if (this.blocked(a)) {
        skipped += 1;
        continue;
      }
      const mine = new Set(
        [...this.db.profiles.values()].filter((p) => p.accountId === a.id).map((p) => p.id),
      );
      const doomedPosts = this.db.posts.filter((p) => mine.has(p.profileId));
      for (const post of doomedPosts) for (const k of post.photoKeys ?? []) this.queueFile(k);
      for (const u of this.db.uploads.filter((x) => mine.has(x.profileId))) this.queueFile(u.key);
      this.db.uploads = this.db.uploads.filter((u) => !mine.has(u.profileId));
      this.db.posts = this.db.posts.filter((p) => !mine.has(p.profileId));
      this.db.comments = this.db.comments.filter((c) => !mine.has(c.profileId));
      for (const id of mine) this.db.profiles.delete(id);
      this.db.codes = this.db.codes.filter((c) => c.email !== a.email);
      for (const [key, s] of this.db.sessions) {
        if (s.accountId === a.id) this.db.sessions.delete(key);
      }
      a.email = `closed-${a.id}@purged.invalid`;
      a.dateOfBirth = null;
      a.purgedAt = cutoff;
      purged += 1;
    }
    return { purged, skipped };
  }

  async exportAccount(accountId: string, now: Date): Promise<AccountExport> {
    const a = this.db.accounts.get(accountId);
    if (!a) throw new Error("account not found");
    if (this.blocked(a)) throw new AnonymousResolverMissing();
    const profiles = [...this.db.profiles.values()].filter((p) => p.accountId === accountId);
    const kindOf = new Map(profiles.map((p) => [p.id, p.kind]));
    const ids = new Set(profiles.map((p) => p.id));
    return {
      schemaVersion: 2,
      exportedAt: now.toISOString(),
      notice: EXPORT_NOTICE,
      account: {
        email: a.email,
        status: a.status,
        dateOfBirth: a.dateOfBirth,
        termsVersion: a.termsVersion,
        termsAcceptedAt: a.createdAt.toISOString(),
        createdAt: a.createdAt.toISOString(),
        lastReverifiedAt: a.lastReverifiedAt.toISOString(),
        reverifyDueAt: a.reverifyDueAt.toISOString(),
        warningsCounting: a.strikeCount,
        closedAt: a.closedAt ? a.closedAt.toISOString() : null,
      },
      profiles: profiles.map((p) => ({
        kind: p.kind,
        handle: p.handle,
        displayName: p.displayName,
        course: p.course ?? null,
        studyYear: p.studyYear ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
      posts: this.db.posts
        .filter((p) => ids.has(p.profileId) && !p.deletedAt)
        .map((p) => ({
          profile: kindOf.get(p.profileId) ?? ("known" as const),
          body: p.body,
          photos: (p.photoKeys ?? []).map((k) => ({ id: k, url: `/photos/${k}`, width: 1, height: 1 })),
          createdAt: a.createdAt.toISOString(),
          hidden: !!p.hidden,
          hiddenReason: p.hiddenReason ?? null,
        })),
      comments: [],
      reactions: [],
      following: [],
      followers: profiles.map((p) => ({ profile: p.kind, count: 0 })),
      notifications: [],
      photos: [],
      sessions: [],
      moderation: {
        reportsFiled: [],
        reportsAboutYourContent: [],
        penalties: [],
        actionsOnYourContent: [],
        appeals: [],
      },
      notIncluded: EXPORT_NOT_INCLUDED,
    };
  }
}

export class CapturingMailer implements Mailer {
  codes: { to: string; code: string; purpose: CodePurpose }[] = [];
  alreadyRegistered: string[] = [];

  async sendCode(to: string, code: string, purpose: CodePurpose) {
    this.codes.push({ to, code, purpose });
  }

  async sendAlreadyRegistered(to: string) {
    this.alreadyRegistered.push(to);
  }

  lastCode(to: string): string {
    const found = [...this.codes].reverse().find((c) => c.to === to);
    if (!found) throw new Error(`no code sent to ${to}`);
    return found.code;
  }
}
