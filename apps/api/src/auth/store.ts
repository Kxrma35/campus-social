export type AccountStatus =
  | "active"
  | "read_only"
  | "suspended"
  | "banned"
  | "closed";

export type CodePurpose = "signup" | "login" | "reverify" | "close" | "appeal";

export interface University {
  id: string;
  name: string;
  emailDomain: string;
  active: boolean;
}

export interface AccountRow {
  id: string;
  email: string;
  status: AccountStatus;
  universityId: string;
}

export interface SessionRow {
  accountId: string;
  email: string;
  status: AccountStatus;
  knownProfileId: string;
}

export interface AccountStanding {
  createdAt: Date;
  strikeCount: number;
  status: AccountStatus;
}

export interface KnownProfileDetails {
  profileId: string;
  handle: string;
  displayName: string;
  course: string | null;
  studyYear: number | null;
  hasAvatar: boolean;
}

export type UpdateProfileResult = "updated" | "rate_limited" | "handle_taken" | "not_found";

export type CreateAnonymousResult = "created" | "exists" | "handle_taken";

export type ConsumeOutcome = "ok" | "invalid" | "expired" | "too_many_attempts";

export interface NewAccount {
  universityId: string;
  email: string;
  dateOfBirth: string;
  termsVersion: string;
  now: Date;
  reverifyDueAt: Date;
  profile: {
    handle: string;
    displayName: string;
    course: string | null;
    studyYear: number | null;
  };
}

export type CreateAccountResult =
  | { kind: "created"; accountId: string; profileId: string }
  | { kind: "email_taken" }
  | { kind: "handle_taken" };

export interface AuthStore {
  findUniversityByDomain(domain: string): Promise<University | null>;
  isEmailBanned(emailHash: Buffer): Promise<boolean>;
  findAccountByEmail(email: string): Promise<AccountRow | null>;

  countCodesSince(email: string, since: Date): Promise<number>;
  createCode(input: {
    email: string;
    codeHash: Buffer;
    purpose: CodePurpose;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
  consumeCode(input: {
    email: string;
    purpose: CodePurpose;
    codeHash: Buffer;
    now: Date;
    maxAttempts: number;
  }): Promise<ConsumeOutcome>;

  createAccountWithKnownProfile(input: NewAccount): Promise<CreateAccountResult>;

  getKnownProfileDetails(profileId: string): Promise<KnownProfileDetails | null>;
  updateKnownProfile(input: {
    profileId: string;
    now: Date;
    set: {
      displayName?: string;
      course?: string | null;
      studyYear?: number | null;
      handle?: string;
    };
    maxEdits: number;
    windowDays: number;
  }): Promise<UpdateProfileResult>;

  getStanding(accountId: string): Promise<AccountStanding | null>;
  getAnonymousLink(accountId: string): Promise<Buffer | null>;
  createAnonymousProfile(input: {
    accountId: string;
    profileId: string;
    handle: string;
    avatarKey: string;
    enc: Buffer;
    keyVersion: number;
    blindIndex: Buffer;
    now: Date;
  }): Promise<CreateAnonymousResult>;
  isHandleTaken(universityId: string, handle: string): Promise<boolean>;
  getProfileBasics(profileId: string): Promise<{ handle: string; avatarKey: string | null } | null>;

  /** One appeal per account, ever. */
  createAppeal(input: {
    accountId: string;
    message: string;
    now: Date;
  }): Promise<"created" | "exists">;

  markReverified(input: { accountId: string; now: Date; dueAt: Date }): Promise<void>;

  createSession(input: {
    accountId: string;
    tokenHash: Buffer;
    deviceLabel: string | null;
    now: Date;
    expiresAt: Date;
  }): Promise<void>;
  findSession(tokenHash: Buffer, now: Date): Promise<SessionRow | null>;
  revokeSession(tokenHash: Buffer, now: Date): Promise<void>;
}
