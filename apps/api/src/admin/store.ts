export type TargetKind = "post" | "comment" | "profile";
export type PenaltyKind = "warning" | "suspension" | "ban";
export type Outcome = "uphold" | "dismiss";

export interface Moderator {
  id: string;
  name: string;
}

export interface ContentPreview {
  text: string | null;
  authorProfileId: string;
  authorKind: "known" | "anonymous";
  authorHandle: string;
  authorDisplayName: string | null;
  hidden: boolean;
  hiddenReason: string | null;
  deleted: boolean;
}

export interface QueueRow {
  targetKind: TargetKind;
  targetId: string;
  urgent: boolean;
  userReports: number;
  autoFlags: number;
  reasons: Record<string, number>;
  oldestReportAt: Date;
  preview: ContentPreview | null;
}

export interface ReportDetail {
  id: string;
  reason: string;
  detail: string | null;
  source: "user" | "auto";
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

export interface ActionDetail {
  id: string;
  kind: string;
  moderator: string;
  note: string | null;
  createdAt: Date;
}

export interface TargetDetail {
  targetKind: TargetKind;
  targetId: string;
  preview: ContentPreview;
  photos: { uploadId: string; width: number; height: number; altText: string | null }[];
  postId: string | null;
  reports: ReportDetail[];
  actions: ActionDetail[];
}

export interface AppealRow {
  id: string;
  message: string;
  status: "open" | "upheld" | "denied";
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  decisionNote: string | null;
}

export interface AdminStore {
  findModeratorByTokenHash(hash: Buffer): Promise<Moderator | null>;

  queue(opts: { limit: number; offset: number }): Promise<QueueRow[]>;
  targetDetail(kind: TargetKind, id: string): Promise<TargetDetail | null>;

  resolveTarget(input: {
    kind: TargetKind;
    id: string;
    outcome: Outcome;
    moderator: string;
    note: string | null;
    now: Date;
  }): Promise<{ reportsClosed: number; contentHidden: boolean; contentRestored: boolean } | null>;

  profileKind(profileId: string): Promise<"known" | "anonymous" | null>;
  penalize(input: {
    profileId: string;
    profileKind: "known" | "anonymous";
    blindIndex: Buffer | null;
    kind: PenaltyKind;
    endsAt: Date | null;
    moderator: string;
    note: string;
  }): Promise<void>;

  listAppeals(status: "open" | "upheld" | "denied"): Promise<AppealRow[]>;
  decideAppeal(input: {
    id: string;
    decision: "upheld" | "denied";
    moderator: string;
    note: string;
  }): Promise<boolean>;

  /** Clears a known profile's photo and records the action. False when it has none. */
  removeAvatar(input: { profileId: string; moderator: string; note: string }): Promise<boolean>;

  photoStorageKey(uploadId: string): Promise<string | null>;
}
