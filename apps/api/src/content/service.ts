import { ApiError } from "../errors.js";
import { suggestsSelfHarm, type SupportInfo } from "../moderation/crisis.js";
import { newPhotoKey, sanitizePhoto, type PhotoStore } from "./photos.js";
import type { ContentStore, KeysetCursor, ReactionTarget } from "./store.js";
import type {
  Actor,
  AuthorRow,
  AuthorView,
  CommentRow,
  CommentView,
  NotificationRow,
  NotificationView,
  Page,
  PostRow,
  PostView,
  ProfileRow,
  ProfileView,
} from "./types.js";

export interface ContentOptions {
  maxBodyLength: number;
  maxCommentLength: number;
  maxPhotos: number;
  maxAltTextLength: number;
  maxPostsPerHour: number;
  maxCommentsPerHour: number;
  maxPendingUploads: number;
  anonymousConfirmFirstN: number;
  topWindowDays: number;
  topMaxOffset: number;
  defaultPageSize: number;
  maxPageSize: number;
}

export const DEFAULT_CONTENT_OPTIONS: ContentOptions = {
  maxBodyLength: 5000,
  maxCommentLength: 2000,
  maxPhotos: 4,
  maxAltTextLength: 500,
  maxPostsPerHour: 20,
  maxCommentsPerHour: 60,
  maxPendingUploads: 12,
  anonymousConfirmFirstN: 3,
  topWindowDays: 7,
  topMaxOffset: 100,
  defaultPageSize: 20,
  maxPageSize: 50,
};

export interface ContentHooks {
  flagForReview?: (kind: "post" | "comment", id: string) => Promise<void>;
  support?: SupportInfo;
  onError?: (err: unknown) => void;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function roundToHour(d: Date): Date {
  return new Date(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS);
}

function encodeCursor(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined): string | null {
  if (!raw) return null;
  const key = Buffer.from(raw, "base64url").toString("utf8");
  if (key.length === 0 || key.length > 200) {
    throw new ApiError("invalid_cursor", 400, "That page cursor is not valid.");
  }
  return key;
}

export class ContentService {
  constructor(
    private readonly store: ContentStore,
    private readonly photos: PhotoStore,
    private readonly opts: ContentOptions = DEFAULT_CONTENT_OPTIONS,
    private readonly now: () => Date = () => new Date(),
    private readonly hooks: ContentHooks = {},
  ) {}

  private async crisisCheck(
    kind: "post" | "comment",
    id: string,
    text: string,
  ): Promise<SupportInfo | undefined> {
    if (!this.hooks.flagForReview || !suggestsSelfHarm(text)) return undefined;
    try {
      await this.hooks.flagForReview(kind, id);
    } catch (err) {
      this.hooks.onError?.(err);
    }
    return this.hooks.support;
  }

  async uploadPhoto(actor: Actor, bytes: Buffer) {
    this.requireWrite(actor);
    if ((await this.store.countPendingUploads(actor.profileId)) >= this.opts.maxPendingUploads) {
      throw new ApiError("too_many_uploads", 429, "Attach or wait before uploading more photos.");
    }
    const clean = await sanitizePhoto(bytes);
    const key = newPhotoKey();
    await this.photos.put(key, clean.bytes);
    try {
      const id = await this.store.createPhotoUpload({
        profileId: actor.profileId,
        storageKey: key,
        width: clean.width,
        height: clean.height,
        now: this.now(),
      });
      return { id, width: clean.width, height: clean.height };
    } catch (err) {
      await this.photos.delete(key).catch(() => undefined);
      throw err;
    }
  }

  async setPhotoAltText(actor: Actor, uploadId: string, raw: string | null) {
    this.requireWrite(actor);
    const altText = this.cleanAltText(raw);
    const ok = await this.store.setPhotoAltText(uploadId, actor.profileId, altText);
    if (!ok) this.notFound();
    return { id: uploadId, altText };
  }

  private cleanAltText(raw: string | null | undefined): string | null {
    const text = (raw ?? "").replace(/\s+/g, " ").trim();
    if (text.length === 0) return null;
    if (text.length > this.opts.maxAltTextLength) {
      throw new ApiError(
        "alt_text_too_long",
        422,
        `Photo descriptions can be at most ${this.opts.maxAltTextLength} characters.`,
      );
    }
    return text;
  }

  private cleanAltTexts(raw: Record<string, string> | undefined, photoIds: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [id, value] of Object.entries(raw ?? {})) {
      if (!photoIds.includes(id)) {
        throw new ApiError("photo_invalid", 422, "A photo description does not match a photo in this post.");
      }
      const text = this.cleanAltText(value);
      if (text) out[id] = text;
    }
    return out;
  }

  async readPhoto(actor: Actor, uploadId: string): Promise<Buffer> {
    const upload = await this.store.getPhotoUpload(uploadId);
    const viewerUni = await this.store.universityOfProfile(actor.profileId);
    if (!upload || !viewerUni || upload.universityId !== viewerUni) this.notFound();
    if (!upload!.postVisible && upload!.profileId !== actor.profileId) this.notFound();
    const bytes = await this.photos.get(upload!.storageKey);
    if (!bytes) this.notFound();
    return bytes!;
  }

  async createPost(
    actor: Actor,
    input: {
      body: string;
      photoIds?: string[];
      altTexts?: Record<string, string>;
      confirmedAnonymous?: boolean;
    },
  ): Promise<PostView> {
    this.requireWrite(actor);

    const body = input.body.trim();
    const photoIds = [...new Set(input.photoIds ?? [])];
    if (body.length > this.opts.maxBodyLength) {
      throw new ApiError("body_too_long", 422, `Posts can be at most ${this.opts.maxBodyLength} characters.`);
    }
    if (photoIds.length > this.opts.maxPhotos) {
      throw new ApiError("too_many_photos", 422, `Posts can have at most ${this.opts.maxPhotos} photos.`);
    }
    if (body.length === 0 && photoIds.length === 0) {
      throw new ApiError("empty_post", 422, "Write something or add a photo.");
    }
    const altTexts = this.cleanAltTexts(input.altTexts, photoIds);

    if (
      actor.kind === "anonymous" &&
      !input.confirmedAnonymous &&
      (await this.store.countPostsBy(actor.profileId)) < this.opts.anonymousConfirmFirstN
    ) {
      throw new ApiError(
        "confirmation_required",
        409,
        "Confirm that you want to post anonymously.",
      );
    }

    const now = this.now();
    await this.enforceRate("posts", actor, this.opts.maxPostsPerHour, now);

    const created = await this.store.createPost({
      authorProfileId: actor.profileId,
      body,
      photoUploadIds: photoIds,
      altTexts,
      now,
    });
    if (created === "photo_invalid") {
      throw new ApiError("photo_invalid", 422, "One of the photos cannot be attached.");
    }
    const view = await this.getPost(actor, created.postId);
    const support = await this.crisisCheck(
      "post",
      created.postId,
      [body, ...Object.values(altTexts)].join("\n"),
    );
    return support ? { ...view, support } : view;
  }

  async getPost(actor: Actor, postId: string): Promise<PostView> {
    const row = await this.store.getPost(postId, actor.profileId);
    if (!row) this.notFound();
    return this.postView(row!);
  }

  async editPost(actor: Actor, postId: string, rawBody: string): Promise<PostView> {
    this.requireWrite(actor);
    const body = rawBody.trim();
    if (body.length === 0 || body.length > this.opts.maxBodyLength) {
      throw new ApiError("invalid_body", 422, "Posts must be 1 to 5000 characters.");
    }
    const outcome = await this.store.updatePostBody({
      postId,
      authorProfileId: actor.profileId,
      body,
      now: this.now(),
    });
    if (outcome === "missing") this.notFound();
    if (outcome === "locked") {
      throw new ApiError("under_review", 409, "This post can't be edited right now. Please try again later.");
    }
    const view = await this.getPost(actor, postId);
    const support = await this.crisisCheck("post", postId, body);
    return support ? { ...view, support } : view;
  }

  async deletePost(actor: Actor, postId: string): Promise<void> {
    const ok = await this.store.softDeletePost({
      postId,
      authorProfileId: actor.profileId,
      now: this.now(),
    });
    if (!ok) this.notFound();
  }

  async campusFeed(
    actor: Actor,
    q: { sort?: "newest" | "top"; cursor?: string; limit?: number },
  ): Promise<Page<PostView>> {
    const limit = this.pageSize(q.limit);

    if (q.sort === "top") {
      const offset = this.decodeOffset(q.cursor);
      const rows = await this.store.campusFeedTop(actor.profileId, {
        since: new Date(this.now().getTime() - this.opts.topWindowDays * DAY_MS),
        offset,
        limit: limit + 1,
      });
      const items = rows.slice(0, limit).map((r) => this.postView(r));
      const next = offset + limit;
      const more = rows.length > limit && next <= this.opts.topMaxOffset;
      return { items, nextCursor: more ? encodeCursor(String(next)) : null };
    }

    const rows = await this.store.campusFeedNewest(actor.profileId, this.keyset(q.cursor, limit));
    return this.postPage(rows, limit);
  }

  async followingFeed(actor: Actor, q: { cursor?: string; limit?: number }): Promise<Page<PostView>> {
    const limit = this.pageSize(q.limit);
    const rows = await this.store.followingFeed(actor.profileId, this.keyset(q.cursor, limit));
    return this.postPage(rows, limit);
  }

  async profilePosts(
    actor: Actor,
    profileId: string,
    q: { cursor?: string; limit?: number },
  ): Promise<Page<PostView>> {
    const limit = this.pageSize(q.limit);
    const rows = await this.store.profilePosts(
      actor.profileId,
      profileId,
      this.keyset(q.cursor, limit),
    );
    if (!rows) this.notFound();
    return this.postPage(rows!, limit);
  }

  async createComment(actor: Actor, postId: string, rawBody: string): Promise<CommentView> {
    this.requireWrite(actor);
    const body = rawBody.trim();
    if (body.length === 0 || body.length > this.opts.maxCommentLength) {
      throw new ApiError("invalid_body", 422, "Comments must be 1 to 2000 characters.");
    }
    const now = this.now();
    await this.enforceRate("comments", actor, this.opts.maxCommentsPerHour, now);

    const created = await this.store.createComment({
      postId,
      authorProfileId: actor.profileId,
      body,
      now,
    });
    if (!created) this.notFound();

    if (created!.postAuthorProfileId !== actor.profileId) {
      await this.store.createNotification({
        recipientProfileId: created!.postAuthorProfileId,
        actorProfileId: actor.profileId,
        kind: "comment",
        postId,
        commentId: created!.comment.id,
        now,
      });
    }
    const view = this.commentView(created!.comment);
    const support = await this.crisisCheck("comment", created!.comment.id, body);
    return support ? { ...view, support } : view;
  }

  async listComments(
    actor: Actor,
    postId: string,
    q: { cursor?: string; limit?: number },
  ): Promise<Page<CommentView>> {
    const limit = this.pageSize(q.limit);
    const rows = await this.store.listComments(postId, actor.profileId, this.keyset(q.cursor, limit));
    if (!rows) this.notFound();
    const items = rows!.slice(0, limit).map((r) => this.commentView(r));
    const last = rows![limit - 1];
    return {
      items,
      nextCursor: rows!.length > limit && last ? encodeCursor(last.cursorKey) : null,
    };
  }

  async deleteComment(actor: Actor, commentId: string): Promise<void> {
    const ok = await this.store.softDeleteComment({
      commentId,
      authorProfileId: actor.profileId,
      now: this.now(),
    });
    if (!ok) this.notFound();
  }

  async react(actor: Actor, target: ReactionTarget): Promise<void> {
    this.requireWrite(actor);
    const result = await this.store.addReaction(actor.profileId, target);
    if (!result) this.notFound();
    if (result!.added && result!.targetAuthorProfileId !== actor.profileId) {
      await this.store.createNotification({
        recipientProfileId: result!.targetAuthorProfileId,
        actorProfileId: actor.profileId,
        kind: "reaction",
        postId: result!.postId,
        commentId: "commentId" in target ? target.commentId : null,
        now: this.now(),
      });
    }
  }

  async unreact(actor: Actor, target: ReactionTarget): Promise<void> {
    await this.store.removeReaction(actor.profileId, target);
  }

  async follow(actor: Actor, profileId: string): Promise<void> {
    this.requireWrite(actor);
    const outcome = await this.store.follow(actor.profileId, profileId);
    if (outcome === "not_found") this.notFound();
    if (outcome === "self") {
      throw new ApiError("cannot_follow_self", 422, "You cannot follow yourself.");
    }
    if (outcome === "ok") {
      await this.store.createNotification({
        recipientProfileId: profileId,
        actorProfileId: actor.profileId,
        kind: "follow",
        postId: null,
        commentId: null,
        now: this.now(),
      });
    }
  }

  async unfollow(actor: Actor, profileId: string): Promise<void> {
    await this.store.unfollow(actor.profileId, profileId);
  }

  async getProfile(actor: Actor, profileId: string): Promise<ProfileView> {
    const row = await this.store.getProfile(actor.profileId, profileId);
    if (!row) this.notFound();
    return this.profileView(row!, actor.profileId);
  }

  async myFollowing(actor: Actor, q: { cursor?: string; limit?: number }): Promise<Page<ProfileView>> {
    const limit = this.pageSize(q.limit);
    const rows = await this.store.listFollowing(actor.profileId, this.keyset(q.cursor, limit));
    return this.profilePage(rows, limit, actor.profileId);
  }

  async myFollowers(actor: Actor, q: { cursor?: string; limit?: number }): Promise<Page<ProfileView>> {
    const limit = this.pageSize(q.limit);
    const rows = await this.store.listFollowers(actor.profileId, this.keyset(q.cursor, limit));
    return this.profilePage(rows, limit, actor.profileId);
  }

  async notifications(
    actor: Actor,
    q: { cursor?: string; limit?: number },
  ): Promise<Page<NotificationView>> {
    const limit = this.pageSize(q.limit);
    const rows = await this.store.listNotifications(actor.profileId, this.keyset(q.cursor, limit));
    const items = rows.slice(0, limit).map((r) => this.notificationView(r));
    const last = rows[limit - 1];
    return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.cursorKey) : null };
  }

  async markNotificationsRead(actor: Actor): Promise<{ marked: number }> {
    return { marked: await this.store.markNotificationsRead(actor.profileId, this.now()) };
  }

  private requireWrite(actor: Actor): void {
    if (!actor.canWrite) {
      throw new ApiError(
        "read_only",
        403,
        "Your account is read-only. Re-verify your email to post again.",
      );
    }
  }

  private notFound(): never {
    throw new ApiError("not_found", 404, "Not found.");
  }

  private async enforceRate(
    kind: "posts" | "comments",
    actor: Actor,
    max: number,
    now: Date,
  ): Promise<void> {
    const since = new Date(now.getTime() - HOUR_MS);
    if ((await this.store.countRecent(kind, actor.profileId, since)) >= max) {
      throw new ApiError("rate_limited", 429, "You are posting too fast. Try again later.");
    }
  }

  private pageSize(limit: number | undefined): number {
    const n = limit ?? this.opts.defaultPageSize;
    return Math.min(Math.max(1, Math.floor(n)), this.opts.maxPageSize);
  }

  private keyset(cursor: string | undefined, limit: number): KeysetCursor {
    return { after: decodeCursor(cursor), limit: limit + 1 };
  }

  private decodeOffset(cursor: string | undefined): number {
    const key = decodeCursor(cursor);
    if (key === null) return 0;
    const n = Number(key);
    if (!Number.isInteger(n) || n < 0 || n > this.opts.topMaxOffset) {
      throw new ApiError("invalid_cursor", 400, "That page cursor is not valid.");
    }
    return n;
  }

  private postPage(rows: PostRow[], limit: number): Page<PostView> {
    const last = rows[limit - 1];
    return {
      items: rows.slice(0, limit).map((r) => this.postView(r)),
      nextCursor: rows.length > limit && last ? encodeCursor(last.cursorKey) : null,
    };
  }

  private profilePage(rows: ProfileRow[], limit: number, viewerProfileId: string): Page<ProfileView> {
    // Lists order by a stable id; the id is the cursor.
    const last = rows[limit - 1];
    return {
      items: rows.slice(0, limit).map((r) => this.profileView(r, viewerProfileId)),
      nextCursor: rows.length > limit && last ? encodeCursor(last.profileId) : null,
    };
  }

  private author(a: AuthorRow): AuthorView {
    return {
      profileId: a.profileId,
      kind: a.kind,
      handle: a.handle,
      displayName: a.kind === "anonymous" ? null : a.displayName,
    };
  }

  private shownTime(d: Date, a: AuthorRow): string {
    return (a.kind === "anonymous" ? roundToHour(d) : d).toISOString();
  }

  private postView(r: PostRow): PostView {
    return {
      id: r.id,
      author: this.author(r.author),
      body: r.body,
      photos: r.photos.map((p) => ({
        id: p.id,
        url: `/photos/${p.id}`,
        width: p.width,
        height: p.height,
        altText: p.altText ?? null,
      })),
      createdAt: this.shownTime(r.createdAt, r.author),
      edited: r.edited,
      reactionCount: r.reactionCount,
      commentCount: r.commentCount,
      viewerReacted: r.viewerReacted,
    };
  }

  private commentView(r: CommentRow): CommentView {
    return {
      id: r.id,
      postId: r.postId,
      author: this.author(r.author),
      body: r.body,
      createdAt: this.shownTime(r.createdAt, r.author),
      reactionCount: r.reactionCount,
      viewerReacted: r.viewerReacted,
    };
  }

  private notificationView(r: NotificationRow): NotificationView {
    return {
      id: r.id,
      kind: r.kind,
      createdAt: this.shownTime(r.createdAt, r.actor),
      read: r.read,
      actor: this.author(r.actor),
      postId: r.postId,
      commentId: r.commentId,
    };
  }

  private profileView(r: ProfileRow, viewerProfileId: string): ProfileView {
    return {
      profileId: r.profileId,
      kind: r.kind,
      handle: r.handle,
      displayName: r.kind === "anonymous" ? null : r.displayName,
      course: r.kind === "anonymous" ? null : r.course,
      studyYear: r.kind === "anonymous" ? null : r.studyYear,
      postCount: r.postCount,
      followerCount: r.followerCount,
      followingCount: r.followingCount,
      viewerFollows: r.viewerFollows,
      isSelf: r.profileId === viewerProfileId,
    };
  }
}
