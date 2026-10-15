import { randomUUID } from "node:crypto";
import type { PhotoStore } from "../../src/content/photos.js";
import type {
  ContentStore,
  FollowOutcome,
  KeysetCursor,
  ReactionTarget,
} from "../../src/content/store.js";
import type {
  Actor,
  AuthorRow,
  CommentRow,
  NotificationKind,
  NotificationRow,
  PhotoUploadRow,
  PostRow,
  ProfileKind,
  ProfileRow,
} from "../../src/content/types.js";
import type { ActorResolver } from "../../src/content/actor.js";

interface MProfile {
  id: string;
  kind: ProfileKind;
  handle: string;
  displayName: string | null;
  course: string | null;
  universityId: string;
  deleted: boolean;
}
interface MPost {
  id: string;
  authorId: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  hidden: boolean;
  photoIds: string[];
}
interface MComment {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
}
interface MUpload {
  id: string;
  profileId: string;
  storageKey: string;
  width: number;
  height: number;
  attached: boolean;
  altText?: string | null;
}
interface MNotification {
  id: string;
  recipientId: string;
  actorId: string;
  kind: NotificationKind;
  postId: string | null;
  commentId: string | null;
  createdAt: Date;
  read: boolean;
}

const key = (d: Date, id: string) => `${d.toISOString()}|${id}`;

export class MemoryContentStore implements ContentStore {
  profiles = new Map<string, MProfile>();
  posts: MPost[] = [];
  comments: MComment[] = [];
  reactions: { profileId: string; postId: string | null; commentId: string | null }[] = [];
  follows: { follower: string; followee: string }[] = [];
  notifications: MNotification[] = [];
  uploads = new Map<string, MUpload>();

  addProfile(p: {
    id?: string;
    kind?: ProfileKind;
    handle: string;
    displayName?: string | null;
    universityId?: string;
    course?: string | null;
  }): string {
    const id = p.id ?? randomUUID();
    const kind = p.kind ?? "known";
    this.profiles.set(id, {
      id,
      kind,
      handle: p.handle,
      displayName: kind === "anonymous" ? null : (p.displayName ?? p.handle),
      course: kind === "anonymous" ? null : (p.course ?? null),
      universityId: p.universityId ?? "u1",
      deleted: false,
    });
    return id;
  }

  private uni(profileId: string): string | null {
    const p = this.profiles.get(profileId);
    return p && !p.deleted ? p.universityId : null;
  }

  private sameCampus(viewer: string, profileId: string): boolean {
    const a = this.profiles.get(profileId);
    const v = this.uni(viewer);
    return !!a && !a.deleted && v !== null && a.universityId === v;
  }

  private authorRow(id: string): AuthorRow {
    const p = this.profiles.get(id)!;
    return { profileId: p.id, kind: p.kind, handle: p.handle, displayName: p.displayName };
  }

  private visiblePost(p: MPost, viewer: string): boolean {
    return !p.deletedAt && !p.hidden && this.sameCampus(viewer, p.authorId);
  }

  private postRow(p: MPost, viewer: string): PostRow {
    return {
      id: p.id,
      author: this.authorRow(p.authorId),
      body: p.body,
      photos: p.photoIds.map((id) => {
        const u = this.uploads.get(id)!;
        return { id: u.id, width: u.width, height: u.height, altText: u.altText ?? null };
      }),
      createdAt: p.createdAt,
      edited: p.editedAt !== null,
      reactionCount: this.reactions.filter((r) => r.postId === p.id).length,
      commentCount: this.comments.filter((c) => c.postId === p.id && !c.deletedAt).length,
      viewerReacted: this.reactions.some((r) => r.postId === p.id && r.profileId === viewer),
      cursorKey: key(p.createdAt, p.id),
    };
  }

  private commentRow(c: MComment, viewer: string): CommentRow {
    return {
      id: c.id,
      postId: c.postId,
      author: this.authorRow(c.authorId),
      body: c.body,
      createdAt: c.createdAt,
      reactionCount: this.reactions.filter((r) => r.commentId === c.id).length,
      viewerReacted: this.reactions.some((r) => r.commentId === c.id && r.profileId === viewer),
      cursorKey: key(c.createdAt, c.id),
    };
  }

  private newestFirst(posts: MPost[]): MPost[] {
    return [...posts].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
    );
  }

  private pageDesc(rows: PostRow[], page: KeysetCursor): PostRow[] {
    const after = page.after;
    const out = after ? rows.filter((r) => r.cursorKey < after) : rows;
    return out.slice(0, page.limit);
  }

  async createPost(input: {
    authorProfileId: string;
    body: string;
    photoUploadIds: string[];
    altTexts?: Record<string, string>;
    now: Date;
  }) {
    for (const id of input.photoUploadIds) {
      const u = this.uploads.get(id);
      if (!u || u.profileId !== input.authorProfileId || u.attached) return "photo_invalid" as const;
    }
    const post: MPost = {
      id: randomUUID(),
      authorId: input.authorProfileId,
      body: input.body,
      createdAt: input.now,
      editedAt: null,
      deletedAt: null,
      hidden: false,
      photoIds: input.photoUploadIds,
    };
    for (const id of input.photoUploadIds) this.uploads.get(id)!.attached = true;
    for (const [id, text] of Object.entries(input.altTexts ?? {})) this.uploads.get(id)!.altText = text;
    this.posts.push(post);
    return { postId: post.id };
  }

  async getPost(postId: string, viewer: string) {
    const p = this.posts.find((x) => x.id === postId);
    return p && this.visiblePost(p, viewer) ? this.postRow(p, viewer) : null;
  }

  postsUnderReview = new Set<string>();

  async updatePostBody(input: { postId: string; authorProfileId: string; body: string; now: Date }) {
    const p = this.posts.find((x) => x.id === input.postId);
    if (!p || p.authorId !== input.authorProfileId || p.deletedAt || p.hidden) return "missing" as const;
    if (this.postsUnderReview.has(p.id)) return "locked" as const;
    p.body = input.body;
    p.editedAt = input.now;
    return "updated" as const;
  }

  async softDeletePost(input: { postId: string; authorProfileId: string; now: Date }) {
    const p = this.posts.find((x) => x.id === input.postId);
    if (!p || p.authorId !== input.authorProfileId || p.deletedAt) return false;
    p.deletedAt = input.now;
    return true;
  }

  async countPostsBy(profileId: string) {
    return this.posts.filter((p) => p.authorId === profileId).length;
  }

  async countRecent(kind: "posts" | "comments", profileId: string, since: Date) {
    const list = kind === "posts" ? this.posts : this.comments;
    return list.filter((x) => x.authorId === profileId && x.createdAt >= since).length;
  }

  async campusFeedNewest(viewer: string, page: KeysetCursor) {
    const rows = this.newestFirst(this.posts.filter((p) => this.visiblePost(p, viewer))).map((p) =>
      this.postRow(p, viewer),
    );
    return this.pageDesc(rows, page);
  }

  async campusFeedTop(viewer: string, opts: { since: Date; offset: number; limit: number }) {
    const rows = this.posts
      .filter((p) => this.visiblePost(p, viewer) && p.createdAt >= opts.since)
      .map((p) => this.postRow(p, viewer))
      .sort(
        (a, b) =>
          b.reactionCount + b.commentCount - (a.reactionCount + a.commentCount) ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
    return rows.slice(opts.offset, opts.offset + opts.limit);
  }

  async followingFeed(viewer: string, page: KeysetCursor) {
    const followed = new Set(this.follows.filter((f) => f.follower === viewer).map((f) => f.followee));
    const rows = this.newestFirst(
      this.posts.filter((p) => followed.has(p.authorId) && this.visiblePost(p, viewer)),
    ).map((p) => this.postRow(p, viewer));
    return this.pageDesc(rows, page);
  }

  async profilePosts(viewer: string, profileId: string, page: KeysetCursor) {
    if (!this.sameCampus(viewer, profileId)) return null;
    const rows = this.newestFirst(
      this.posts.filter((p) => p.authorId === profileId && this.visiblePost(p, viewer)),
    ).map((p) => this.postRow(p, viewer));
    return this.pageDesc(rows, page);
  }

  async createComment(input: { postId: string; authorProfileId: string; body: string; now: Date }) {
    const p = this.posts.find((x) => x.id === input.postId);
    if (!p || !this.visiblePost(p, input.authorProfileId)) return null;
    const c: MComment = {
      id: randomUUID(),
      postId: p.id,
      authorId: input.authorProfileId,
      body: input.body,
      createdAt: input.now,
      deletedAt: null,
    };
    this.comments.push(c);
    return { comment: this.commentRow(c, input.authorProfileId), postAuthorProfileId: p.authorId };
  }

  async listComments(postId: string, viewer: string, page: KeysetCursor) {
    const p = this.posts.find((x) => x.id === postId);
    if (!p || !this.visiblePost(p, viewer)) return null;
    const rows = this.comments
      .filter((c) => c.postId === postId && !c.deletedAt)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map((c) => this.commentRow(c, viewer));
    const after = page.after;
    return (after ? rows.filter((r) => r.cursorKey > after) : rows).slice(0, page.limit);
  }

  async softDeleteComment(input: { commentId: string; authorProfileId: string; now: Date }) {
    const c = this.comments.find((x) => x.id === input.commentId);
    if (!c || c.authorId !== input.authorProfileId || c.deletedAt) return false;
    c.deletedAt = input.now;
    return true;
  }

  async addReaction(profileId: string, target: ReactionTarget) {
    let post: MPost | undefined;
    let targetAuthor: string | undefined;
    if ("postId" in target) {
      post = this.posts.find((p) => p.id === target.postId);
      targetAuthor = post?.authorId;
    } else {
      const c = this.comments.find((x) => x.id === target.commentId && !x.deletedAt);
      post = c ? this.posts.find((p) => p.id === c.postId) : undefined;
      targetAuthor = c?.authorId;
    }
    if (!post || !targetAuthor || !this.visiblePost(post, profileId)) return null;

    const commentId = "commentId" in target ? target.commentId : null;
    const postId = "postId" in target ? target.postId : null;
    const exists = this.reactions.some(
      (r) => r.profileId === profileId && r.postId === postId && r.commentId === commentId,
    );
    if (!exists) this.reactions.push({ profileId, postId, commentId });
    return { added: !exists, targetAuthorProfileId: targetAuthor, postId: post.id };
  }

  async removeReaction(profileId: string, target: ReactionTarget) {
    const before = this.reactions.length;
    this.reactions = this.reactions.filter(
      (r) =>
        !(
          r.profileId === profileId &&
          ("postId" in target ? r.postId === target.postId : r.commentId === target.commentId)
        ),
    );
    return this.reactions.length < before;
  }

  async follow(follower: string, followee: string): Promise<FollowOutcome> {
    if (follower === followee) return "self";
    if (!this.sameCampus(follower, followee)) return "not_found";
    if (this.follows.some((f) => f.follower === follower && f.followee === followee)) return "already";
    this.follows.push({ follower, followee });
    return "ok";
  }

  async unfollow(follower: string, followee: string) {
    const before = this.follows.length;
    this.follows = this.follows.filter((f) => !(f.follower === follower && f.followee === followee));
    return this.follows.length < before;
  }

  private profileRow(id: string, viewer: string): ProfileRow {
    const p = this.profiles.get(id)!;
    return {
      profileId: p.id,
      kind: p.kind,
      handle: p.handle,
      displayName: p.displayName,
      course: p.course,
      studyYear: null,
      postCount: this.posts.filter((x) => x.authorId === id && !x.deletedAt && !x.hidden).length,
      followerCount: this.follows.filter((f) => f.followee === id).length,
      followingCount: this.follows.filter((f) => f.follower === id).length,
      viewerFollows: this.follows.some((f) => f.follower === viewer && f.followee === id),
    };
  }

  async getProfile(viewer: string, profileId: string) {
    return this.sameCampus(viewer, profileId) ? this.profileRow(profileId, viewer) : null;
  }

  async listFollowing(profileId: string, page: KeysetCursor) {
    return this.follows
      .filter((f) => f.follower === profileId)
      .map((f) => f.followee)
      .sort()
      .filter((id) => !page.after || id > page.after)
      .slice(0, page.limit)
      .map((id) => this.profileRow(id, profileId));
  }

  async listFollowers(profileId: string, page: KeysetCursor) {
    return this.follows
      .filter((f) => f.followee === profileId)
      .map((f) => f.follower)
      .sort()
      .filter((id) => !page.after || id > page.after)
      .slice(0, page.limit)
      .map((id) => this.profileRow(id, profileId));
  }

  async createNotification(input: {
    recipientProfileId: string;
    actorProfileId: string;
    kind: NotificationKind;
    postId: string | null;
    commentId: string | null;
    now: Date;
  }) {
    this.notifications.push({
      id: randomUUID(),
      recipientId: input.recipientProfileId,
      actorId: input.actorProfileId,
      kind: input.kind,
      postId: input.postId,
      commentId: input.commentId,
      createdAt: input.now,
      read: false,
    });
  }

  async listNotifications(profileId: string, page: KeysetCursor): Promise<NotificationRow[]> {
    const rows = this.notifications
      .filter((n) => n.recipientId === profileId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .map(
        (n): NotificationRow => ({
          id: n.id,
          kind: n.kind,
          createdAt: n.createdAt,
          read: n.read,
          actor: this.authorRow(n.actorId),
          postId: n.postId,
          commentId: n.commentId,
          cursorKey: key(n.createdAt, n.id),
        }),
      );
    const after = page.after;
    return (after ? rows.filter((r) => r.cursorKey < after) : rows).slice(0, page.limit);
  }

  async markNotificationsRead(profileId: string) {
    let n = 0;
    for (const x of this.notifications) {
      if (x.recipientId === profileId && !x.read) {
        x.read = true;
        n += 1;
      }
    }
    return n;
  }

  async createPhotoUpload(input: {
    profileId: string;
    storageKey: string;
    width: number;
    height: number;
  }) {
    const id = randomUUID();
    this.uploads.set(id, { id, attached: false, ...input });
    return id;
  }

  async setPhotoAltText(uploadId: string, profileId: string, altText: string | null) {
    const u = this.uploads.get(uploadId);
    if (!u || u.profileId !== profileId) return false;
    u.altText = altText;
    return true;
  }

  async countPendingUploads(profileId: string) {
    return [...this.uploads.values()].filter((u) => u.profileId === profileId && !u.attached).length;
  }

  async getPhotoUpload(uploadId: string): Promise<PhotoUploadRow | null> {
    const u = this.uploads.get(uploadId);
    if (!u) return null;
    const owner = this.profiles.get(u.profileId);
    if (!owner || owner.deleted) return null;
    const post = this.posts.find((p) => p.photoIds.includes(uploadId));
    return {
      id: u.id,
      profileId: u.profileId,
      storageKey: u.storageKey,
      width: u.width,
      height: u.height,
      universityId: owner.universityId,
      postVisible: !!post && !post.deletedAt && !post.hidden,
    };
  }

  async universityOfProfile(profileId: string) {
    return this.uni(profileId);
  }
}

export class MemoryPhotoStore implements PhotoStore {
  files = new Map<string, Buffer>();
  async put(k: string, bytes: Buffer) {
    this.files.set(k, bytes);
  }
  async get(k: string) {
    return this.files.get(k) ?? null;
  }
  failDelete = new Set<string>();
  async delete(k: string) {
    if (this.failDelete.has(k)) throw new Error("storage unavailable");
    this.files.delete(k);
  }
}

export class FakeActorResolver implements ActorResolver {
  private readonly byToken = new Map<string, { known: Actor; anonymous?: Actor }>();

  register(token: string, known: Actor, anonymous?: Actor) {
    this.byToken.set(token, { known, anonymous });
  }

  async resolve(token: string, kind: ProfileKind): Promise<Actor> {
    const entry = this.byToken.get(token);
    const actor = entry?.[kind];
    if (!actor) {
      const { ApiError } = await import("../../src/errors.js");
      throw new ApiError("unauthorized", 401, "Sign in to continue.");
    }
    return actor;
  }
}
