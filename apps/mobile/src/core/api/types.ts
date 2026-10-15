
export type ProfileKind = "known" | "anonymous";

export interface Author {
  profileId: string;
  kind: ProfileKind;
  handle: string;
  /** Real name; always null for anonymous profiles. */
  displayName: string | null;
  /** A known profile has a photo other students may see. Never true for anonymous. */
  hasAvatar: boolean;
}

export interface PostPhoto {
  id: string;
  url: string;
  width: number;
  height: number;
  altText: string | null;
}

export interface SupportInfo {
  message: string;
  resources: { name: string; contact: string }[];
}

export interface Post {
  id: string;
  author: Author;
  body: string;
  photos: PostPhoto[];
  /** Rounded down to the hour for anonymous authors. */
  createdAt: string;
  edited: boolean;
  reactionCount: number;
  commentCount: number;
  viewerReacted: boolean;
  /** Present only on the response to creating a flagged post. */
  support?: SupportInfo;
}

export interface Comment {
  id: string;
  postId: string;
  author: Author;
  body: string;
  createdAt: string;
  reactionCount: number;
  viewerReacted: boolean;
  support?: SupportInfo;
}

export interface Profile {
  profileId: string;
  kind: ProfileKind;
  handle: string;
  displayName: string | null;
  course: string | null;
  studyYear: number | null;
  postCount: number;
  followerCount: number;
  followingCount: number;
  viewerFollows: boolean;
  isSelf: boolean;
  hasAvatar: boolean;
}

export type NotificationKind = "comment" | "reaction" | "follow";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  createdAt: string;
  read: boolean;
  actor: Author;
  postId: string | null;
  commentId: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type AccountStatus = "active" | "read_only" | "suspended" | "banned" | "closed";

export interface SessionResponse {
  sessionToken: string;
  expiresAt: string;
  account: { id: string; status: AccountStatus };
  profile: { id: string };
}

export type AnonymousStatus =
  | "available"
  | "exists"
  | "locked_new_account"
  | "locked_strikes"
  | "locked_account_state"
  | "unavailable";

export interface MyProfiles {
  known: { profileId: string; handle: string | null };
  anonymous: { profileId: string; handle: string; avatarKey: string | null } | null;
  anonymousEligibility: { status: AnonymousStatus; unlocksAt?: string };
  notice: string;
}

export interface KnownProfileDetails {
  profileId: string;
  handle: string;
  displayName: string;
  course: string | null;
  studyYear: number | null;
  hasAvatar: boolean;
}

export type ReportReason =
  | "threat"
  | "harassment"
  | "private_info"
  | "intimate_image"
  | "hate"
  | "self_harm"
  | "impersonation"
  | "other";

export type ReportTargetKind = "post" | "comment" | "profile";

export interface SignupInput {
  email: string;
  code: string;
  dateOfBirth: string;
  displayName: string;
  handle?: string | null;
  course?: string | null;
  studyYear?: number | null;
  confirmAge18: true;
  acceptTerms: true;
  deviceLabel?: string | null;
}

export type PostSort = "newest" | "top";
