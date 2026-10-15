export type ProfileKind = "known" | "anonymous";

export interface Actor {
  profileId: string;
  kind: ProfileKind;
  canWrite: boolean;
  blindIndex?: Buffer;
}

export interface AuthorView {
  profileId: string;
  kind: ProfileKind;
  handle: string;
  /** Real name; always null for anonymous profiles. */
  displayName: string | null;
  /** True when a known profile has a photo others may see. Never true for anonymous. */
  hasAvatar: boolean;
}

export interface PostView {
  id: string;
  author: AuthorView;
  body: string;
  photos: { id: string; url: string; width: number; height: number; altText: string | null }[];
  createdAt: string;
  edited: boolean;
  reactionCount: number;
  commentCount: number;
  viewerReacted: boolean;
  support?: import("../moderation/crisis.js").SupportInfo;
}

export interface CommentView {
  id: string;
  postId: string;
  author: AuthorView;
  body: string;
  createdAt: string;
  reactionCount: number;
  viewerReacted: boolean;
  support?: import("../moderation/crisis.js").SupportInfo;
}

export interface ProfileView {
  profileId: string;
  kind: ProfileKind;
  handle: string;
  displayName: string | null;
  /** Known profiles only. */
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

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  createdAt: string;
  read: boolean;
  actor: AuthorView;
  postId: string | null;
  commentId: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AuthorRow {
  profileId: string;
  kind: ProfileKind;
  handle: string;
  displayName: string | null;
  hasAvatar: boolean;
}

export interface PostRow {
  id: string;
  author: AuthorRow;
  body: string;
  photos: { id: string; width: number; height: number; altText: string | null }[];
  createdAt: Date;
  edited: boolean;
  reactionCount: number;
  commentCount: number;
  viewerReacted: boolean;
  cursorKey: string;
}

export interface CommentRow {
  id: string;
  postId: string;
  author: AuthorRow;
  body: string;
  createdAt: Date;
  reactionCount: number;
  viewerReacted: boolean;
  cursorKey: string;
}

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  createdAt: Date;
  read: boolean;
  actor: AuthorRow;
  postId: string | null;
  commentId: string | null;
  cursorKey: string;
}

export interface ProfileRow {
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
  hasAvatar: boolean;
}

export interface PhotoUploadRow {
  id: string;
  profileId: string;
  storageKey: string;
  width: number;
  height: number;
  universityId: string;
  postVisible: boolean;
}
