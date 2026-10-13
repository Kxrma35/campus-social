import type {
  CommentRow,
  NotificationKind,
  NotificationRow,
  PhotoUploadRow,
  PostRow,
  ProfileRow,
} from "./types.js";

export interface KeysetCursor {
  after: string | null;
  limit: number;
}

export type FollowOutcome = "ok" | "already" | "not_found" | "self";
export type ReactionTarget = { postId: string } | { commentId: string };

export interface ContentStore {
  createPost(input: {
    authorProfileId: string;
    body: string;
    photoUploadIds: string[];
    altTexts?: Record<string, string>;
    now: Date;
  }): Promise<{ postId: string } | "photo_invalid">;
  getPost(postId: string, viewerProfileId: string): Promise<PostRow | null>;
  updatePostBody(input: {
    postId: string;
    authorProfileId: string;
    body: string;
    now: Date;
  }): Promise<boolean>;
  softDeletePost(input: { postId: string; authorProfileId: string; now: Date }): Promise<boolean>;
  countPostsBy(profileId: string): Promise<number>;
  countRecent(
    kind: "posts" | "comments",
    profileId: string,
    since: Date,
  ): Promise<number>;

  campusFeedNewest(viewerProfileId: string, page: KeysetCursor): Promise<PostRow[]>;
  campusFeedTop(
    viewerProfileId: string,
    opts: { since: Date; offset: number; limit: number },
  ): Promise<PostRow[]>;
  followingFeed(viewerProfileId: string, page: KeysetCursor): Promise<PostRow[]>;
  profilePosts(
    viewerProfileId: string,
    profileId: string,
    page: KeysetCursor,
  ): Promise<PostRow[] | null>;

  createComment(input: {
    postId: string;
    authorProfileId: string;
    body: string;
    now: Date;
  }): Promise<{ comment: CommentRow; postAuthorProfileId: string } | null>;
  listComments(
    postId: string,
    viewerProfileId: string,
    page: KeysetCursor,
  ): Promise<CommentRow[] | null>;
  softDeleteComment(input: {
    commentId: string;
    authorProfileId: string;
    now: Date;
  }): Promise<boolean>;

  addReaction(
    profileId: string,
    target: ReactionTarget,
  ): Promise<{ added: boolean; targetAuthorProfileId: string; postId: string } | null>;
  removeReaction(profileId: string, target: ReactionTarget): Promise<boolean>;

  follow(followerProfileId: string, followeeProfileId: string): Promise<FollowOutcome>;
  unfollow(followerProfileId: string, followeeProfileId: string): Promise<boolean>;
  getProfile(viewerProfileId: string, profileId: string): Promise<ProfileRow | null>;
  /** Only ever called for the viewer's own profile. */
  listFollowing(profileId: string, page: KeysetCursor): Promise<ProfileRow[]>;
  listFollowers(profileId: string, page: KeysetCursor): Promise<ProfileRow[]>;

  createNotification(input: {
    recipientProfileId: string;
    actorProfileId: string;
    kind: NotificationKind;
    postId: string | null;
    commentId: string | null;
    now: Date;
  }): Promise<void>;
  listNotifications(profileId: string, page: KeysetCursor): Promise<NotificationRow[]>;
  markNotificationsRead(profileId: string, now: Date): Promise<number>;

  createPhotoUpload(input: {
    profileId: string;
    storageKey: string;
    width: number;
    height: number;
    now: Date;
  }): Promise<string>;
  countPendingUploads(profileId: string): Promise<number>;
  setPhotoAltText(uploadId: string, profileId: string, altText: string | null): Promise<boolean>;
  getPhotoUpload(uploadId: string): Promise<PhotoUploadRow | null>;
  universityOfProfile(profileId: string): Promise<string | null>;
}
