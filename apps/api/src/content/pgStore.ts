import type { Pool } from "pg";
import { ApiError } from "../errors.js";
import type {
  ContentStore,
  FollowOutcome,
  KeysetCursor,
  ReactionTarget,
} from "./store.js";
import type {
  AuthorRow,
  CommentRow,
  NotificationKind,
  NotificationRow,
  PhotoUploadRow,
  PostRow,
  ProfileRow,
} from "./types.js";

const TS_FMT = `'YYYY-MM-DD"T"HH24:MI:SS.US'`;
const KEY_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function badCursor(): never {
  throw new ApiError("invalid_cursor", 400, "That page cursor is not valid.");
}

function checkKey(after: string | null): string | null {
  if (after === null) return null;
  if (!KEY_RE.test(after)) badCursor();
  return after;
}

const SAME_CAMPUS = `a.deleted_at is null
   and a.university_id = (select university_id from profiles where id = $1)`;

const POST_COLUMNS = `
  p.id, p.body, p.created_at, p.edited_at,
  to_char(p.created_at at time zone 'UTC', ${TS_FMT}) || '|' || p.id::text as cursor_key,
  a.id as author_id, a.kind as author_kind, a.handle as author_handle,
  a.display_name as author_display_name,
  (a.kind = 'known' and a.avatar_upload_id is not null) as author_has_avatar,
  (select count(*)::int from reactions r where r.post_id = p.id) as reaction_count,
  (select count(*)::int from comments c
    where c.post_id = p.id and c.deleted_at is null and c.hidden_at is null) as comment_count,
  exists (select 1 from reactions r where r.post_id = p.id and r.profile_id = $1) as viewer_reacted,
  coalesce((select json_agg(json_build_object('id', u.id, 'width', u.width, 'height', u.height,
                                    'altText', u.alt_text)
                            order by ph.position)
              from post_photos ph join photo_uploads u on u.storage_key = ph.storage_key
             where ph.post_id = p.id), '[]'::json) as photos`;

const POST_VISIBLE = `p.deleted_at is null and p.hidden_at is null`;

const COMMENT_COLUMNS = `
  c.id, c.post_id, c.body, c.created_at,
  to_char(c.created_at at time zone 'UTC', ${TS_FMT}) || '|' || c.id::text as cursor_key,
  a.id as author_id, a.kind as author_kind, a.handle as author_handle,
  a.display_name as author_display_name,
  (a.kind = 'known' and a.avatar_upload_id is not null) as author_has_avatar,
  (select count(*)::int from reactions r where r.comment_id = c.id) as reaction_count,
  exists (select 1 from reactions r where r.comment_id = c.id and r.profile_id = $1) as viewer_reacted`;

const PROFILE_COLUMNS = `
  t.id, t.kind, t.handle, t.display_name, t.course, t.study_year,
  (t.kind = 'known' and t.avatar_upload_id is not null) as has_avatar,
  (select count(*)::int from posts p
    where p.author_profile_id = t.id and p.deleted_at is null and p.hidden_at is null) as post_count,
  (select count(*)::int from follows f join profiles fp on fp.id = f.follower_profile_id
    where f.followee_profile_id = t.id and fp.deleted_at is null) as follower_count,
  (select count(*)::int from follows f join profiles fp on fp.id = f.followee_profile_id
    where f.follower_profile_id = t.id and fp.deleted_at is null) as following_count,
  exists (select 1 from follows f
           where f.follower_profile_id = $1 and f.followee_profile_id = t.id) as viewer_follows`;

type Row = Record<string, unknown> & {
  [k: string]: any;
};

function author(r: Row): AuthorRow {
  return {
    profileId: r.author_id,
    kind: r.author_kind,
    handle: r.author_handle,
    displayName: r.author_kind === "anonymous" ? null : r.author_display_name,
    hasAvatar: r.author_kind === "known" && r.author_has_avatar === true,
  };
}

function postRow(r: Row): PostRow {
  return {
    id: r.id,
    author: author(r),
    body: r.body,
    photos: r.photos,
    createdAt: new Date(r.created_at),
    edited: r.edited_at !== null,
    reactionCount: r.reaction_count,
    commentCount: r.comment_count,
    viewerReacted: r.viewer_reacted,
    cursorKey: r.cursor_key,
  };
}

function commentRow(r: Row): CommentRow {
  return {
    id: r.id,
    postId: r.post_id,
    author: author(r),
    body: r.body,
    createdAt: new Date(r.created_at),
    reactionCount: r.reaction_count,
    viewerReacted: r.viewer_reacted,
    cursorKey: r.cursor_key,
  };
}

function profileRow(r: Row): ProfileRow {
  return {
    profileId: r.id,
    kind: r.kind,
    handle: r.handle,
    displayName: r.kind === "anonymous" ? null : r.display_name,
    course: r.kind === "anonymous" ? null : r.course,
    studyYear: r.kind === "anonymous" ? null : r.study_year,
    postCount: r.post_count,
    followerCount: r.follower_count,
    followingCount: r.following_count,
    viewerFollows: r.viewer_follows,
    hasAvatar: r.kind === "known" && r.has_avatar === true,
  };
}

export class PgContentStore implements ContentStore {
  constructor(private readonly pool: Pool) {}

  async createPost(input: {
    authorProfileId: string;
    body: string;
    photoUploadIds: string[];
    altTexts?: Record<string, string>;
    now: Date;
  }): Promise<{ postId: string } | "photo_invalid"> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const ins = await client.query(
        `insert into posts (author_profile_id, body, created_at) values ($1, $2, $3) returning id`,
        [input.authorProfileId, input.body, input.now],
      );
      const postId: string = ins.rows[0].id;

      if (input.photoUploadIds.length > 0) {
        const up = await client.query(
          `select id, storage_key, width, height from photo_uploads
            where id = any($1::uuid[]) and profile_id = $2 and attached_at is null
            for update`,
          [input.photoUploadIds, input.authorProfileId],
        );
        if (up.rowCount !== input.photoUploadIds.length) {
          await client.query("rollback");
          return "photo_invalid";
        }
        const byId = new Map<string, Row>(up.rows.map((r) => [r.id as string, r]));
        for (const [position, id] of input.photoUploadIds.entries()) {
          const u = byId.get(id);
          if (!u) {
            await client.query("rollback");
            return "photo_invalid";
          }
          await client.query(
            `insert into post_photos (post_id, position, storage_key, width, height)
             values ($1, $2, $3, $4, $5)`,
            [postId, position, u.storage_key, u.width, u.height],
          );
        }
        await client.query(
          `update photo_uploads set attached_at = $2 where id = any($1::uuid[])`,
          [input.photoUploadIds, input.now],
        );
        for (const [uploadId, text] of Object.entries(input.altTexts ?? {})) {
          await client.query(`update photo_uploads set alt_text = $2 where id = $1`, [uploadId, text]);
        }
      }

      await client.query("commit");
      return { postId };
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async getPost(postId: string, viewerProfileId: string): Promise<PostRow | null> {
    const r = await this.pool.query(
      `select ${POST_COLUMNS}
         from posts p join profiles a on a.id = p.author_profile_id
        where p.id = $2 and ${POST_VISIBLE} and ${SAME_CAMPUS}`,
      [viewerProfileId, postId],
    );
    return r.rows[0] ? postRow(r.rows[0]) : null;
  }

  async updatePostBody(input: {
    postId: string;
    authorProfileId: string;
    body: string;
    now: Date;
  }): Promise<"updated" | "locked" | "missing"> {
    const r = await this.pool.query(
      `update posts set body = $3, edited_at = $4
        where id = $1 and author_profile_id = $2 and deleted_at is null and hidden_at is null
          and not moderation.post_has_open_report(id)`,
      [input.postId, input.authorProfileId, input.body, input.now],
    );
    if (r.rowCount === 1) return "updated";
    const own = await this.pool.query(
      `select 1 from posts
        where id = $1 and author_profile_id = $2 and deleted_at is null and hidden_at is null`,
      [input.postId, input.authorProfileId],
    );
    return own.rowCount === 1 ? "locked" : "missing";
  }

  async softDeletePost(input: {
    postId: string;
    authorProfileId: string;
    now: Date;
  }): Promise<boolean> {
    const r = await this.pool.query(
      `update posts set deleted_at = $3
        where id = $1 and author_profile_id = $2 and deleted_at is null`,
      [input.postId, input.authorProfileId, input.now],
    );
    return r.rowCount === 1;
  }

  async countPostsBy(profileId: string): Promise<number> {
    const r = await this.pool.query(
      `select count(*)::int n from posts where author_profile_id = $1`,
      [profileId],
    );
    return r.rows[0].n;
  }

  async countRecent(kind: "posts" | "comments", profileId: string, since: Date): Promise<number> {
    const table = kind === "posts" ? "posts" : "comments";
    const r = await this.pool.query(
      `select count(*)::int n from ${table} where author_profile_id = $1 and created_at >= $2`,
      [profileId, since],
    );
    return r.rows[0].n;
  }

  private async feed(
    viewer: string,
    page: KeysetCursor,
    extraWhere: string,
    extraParams: unknown[],
  ): Promise<PostRow[]> {
    const after = checkKey(page.after);
    const params: unknown[] = [viewer, ...extraParams];
    let cursorSql = "";
    if (after) {
      params.push(after);
      const n = params.length;
      cursorSql = `and (p.created_at, p.id) < (
        split_part($${n}, '|', 1)::timestamp at time zone 'UTC',
        split_part($${n}, '|', 2)::uuid)`;
    }
    params.push(page.limit);
    const r = await this.pool.query(
      `select ${POST_COLUMNS}
         from posts p join profiles a on a.id = p.author_profile_id
        where ${POST_VISIBLE} and ${SAME_CAMPUS} ${extraWhere} ${cursorSql}
        order by p.created_at desc, p.id desc
        limit $${params.length}`,
      params,
    );
    return r.rows.map(postRow);
  }

  campusFeedNewest(viewerProfileId: string, page: KeysetCursor): Promise<PostRow[]> {
    return this.feed(viewerProfileId, page, "", []);
  }

  followingFeed(viewerProfileId: string, page: KeysetCursor): Promise<PostRow[]> {
    return this.feed(
      viewerProfileId,
      page,
      `and p.author_profile_id in (
         select followee_profile_id from follows where follower_profile_id = $1)`,
      [],
    );
  }

  async campusFeedTop(
    viewerProfileId: string,
    opts: { since: Date; offset: number; limit: number },
  ): Promise<PostRow[]> {
    const r = await this.pool.query(
      `with base as (
         select ${POST_COLUMNS}
           from posts p join profiles a on a.id = p.author_profile_id
          where ${POST_VISIBLE} and ${SAME_CAMPUS} and p.created_at >= $2
       )
       select * from base
        order by (reaction_count + comment_count) desc, created_at desc, id desc
        offset $3 limit $4`,
      [viewerProfileId, opts.since, opts.offset, opts.limit],
    );
    return r.rows.map(postRow);
  }

  async profilePosts(
    viewerProfileId: string,
    profileId: string,
    page: KeysetCursor,
  ): Promise<PostRow[] | null> {
    if (!UUID_RE.test(profileId)) return null;
    const visible = await this.pool.query(
      `select 1 from profiles t
        where t.id = $2 and t.deleted_at is null
          and t.university_id = (select university_id from profiles where id = $1)`,
      [viewerProfileId, profileId],
    );
    if (visible.rowCount === 0) return null;
    return this.feed(viewerProfileId, page, `and p.author_profile_id = $2`, [profileId]);
  }

  async createComment(input: {
    postId: string;
    authorProfileId: string;
    body: string;
    now: Date;
  }): Promise<{ comment: CommentRow; postAuthorProfileId: string } | null> {
    if (!UUID_RE.test(input.postId)) return null;
    const post = await this.pool.query(
      `select p.author_profile_id
         from posts p join profiles a on a.id = p.author_profile_id
        where p.id = $2 and ${POST_VISIBLE} and ${SAME_CAMPUS}`,
      [input.authorProfileId, input.postId],
    );
    const postAuthor: string | undefined = post.rows[0]?.author_profile_id;
    if (!postAuthor) return null;

    const ins = await this.pool.query(
      `insert into comments (post_id, author_profile_id, body, created_at)
       values ($1, $2, $3, $4) returning id`,
      [input.postId, input.authorProfileId, input.body, input.now],
    );
    const row = await this.pool.query(
      `select ${COMMENT_COLUMNS}
         from comments c join profiles a on a.id = c.author_profile_id
        where c.id = $2`,
      [input.authorProfileId, ins.rows[0].id],
    );
    return { comment: commentRow(row.rows[0]), postAuthorProfileId: postAuthor };
  }

  async listComments(
    postId: string,
    viewerProfileId: string,
    page: KeysetCursor,
  ): Promise<CommentRow[] | null> {
    if (!UUID_RE.test(postId)) return null;
    const post = await this.pool.query(
      `select 1 from posts p join profiles a on a.id = p.author_profile_id
        where p.id = $2 and ${POST_VISIBLE} and ${SAME_CAMPUS}`,
      [viewerProfileId, postId],
    );
    if (post.rowCount === 0) return null;

    const after = checkKey(page.after);
    const params: unknown[] = [viewerProfileId, postId];
    let cursorSql = "";
    if (after) {
      params.push(after);
      const n = params.length;
      cursorSql = `and (c.created_at, c.id) > (
        split_part($${n}, '|', 1)::timestamp at time zone 'UTC',
        split_part($${n}, '|', 2)::uuid)`;
    }
    params.push(page.limit);
    const r = await this.pool.query(
      `select ${COMMENT_COLUMNS}
         from comments c join profiles a on a.id = c.author_profile_id
        where c.post_id = $2 and c.deleted_at is null and c.hidden_at is null
          and a.deleted_at is null ${cursorSql}
        order by c.created_at asc, c.id asc
        limit $${params.length}`,
      params,
    );
    return r.rows.map(commentRow);
  }

  async softDeleteComment(input: {
    commentId: string;
    authorProfileId: string;
    now: Date;
  }): Promise<boolean> {
    if (!UUID_RE.test(input.commentId)) return false;
    const r = await this.pool.query(
      `update comments set deleted_at = $3
        where id = $1 and author_profile_id = $2 and deleted_at is null`,
      [input.commentId, input.authorProfileId, input.now],
    );
    return r.rowCount === 1;
  }

  async addReaction(
    profileId: string,
    target: ReactionTarget,
  ): Promise<{ added: boolean; targetAuthorProfileId: string; postId: string } | null> {
    let lookup;
    if ("postId" in target) {
      if (!UUID_RE.test(target.postId)) return null;
      lookup = await this.pool.query(
        `select p.id as post_id, p.author_profile_id as target_author
           from posts p join profiles a on a.id = p.author_profile_id
          where p.id = $2 and ${POST_VISIBLE} and ${SAME_CAMPUS}`,
        [profileId, target.postId],
      );
    } else {
      if (!UUID_RE.test(target.commentId)) return null;
      lookup = await this.pool.query(
        `select p.id as post_id, c.author_profile_id as target_author
           from comments c
           join posts p on p.id = c.post_id
           join profiles a on a.id = p.author_profile_id
          where c.id = $2 and c.deleted_at is null and c.hidden_at is null
            and ${POST_VISIBLE} and ${SAME_CAMPUS}`,
        [profileId, target.commentId],
      );
    }
    const found = lookup.rows[0];
    if (!found) return null;

    const ins =
      "postId" in target
        ? await this.pool.query(
            `insert into reactions (profile_id, post_id) values ($1, $2) on conflict do nothing`,
            [profileId, target.postId],
          )
        : await this.pool.query(
            `insert into reactions (profile_id, comment_id) values ($1, $2) on conflict do nothing`,
            [profileId, target.commentId],
          );
    return {
      added: ins.rowCount === 1,
      targetAuthorProfileId: found.target_author,
      postId: found.post_id,
    };
  }

  async removeReaction(profileId: string, target: ReactionTarget): Promise<boolean> {
    if ("postId" in target) {
      if (!UUID_RE.test(target.postId)) return false;
      const r = await this.pool.query(
        `delete from reactions where profile_id = $1 and post_id = $2`,
        [profileId, target.postId],
      );
      return (r.rowCount ?? 0) > 0;
    }
    if (!UUID_RE.test(target.commentId)) return false;
    const r = await this.pool.query(
      `delete from reactions where profile_id = $1 and comment_id = $2`,
      [profileId, target.commentId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async follow(followerProfileId: string, followeeProfileId: string): Promise<FollowOutcome> {
    if (!UUID_RE.test(followeeProfileId)) return "not_found";
    if (followerProfileId === followeeProfileId) return "self";
    const target = await this.pool.query(
      `select 1 from profiles t
        where t.id = $2 and t.deleted_at is null
          and t.university_id = (select university_id from profiles where id = $1)`,
      [followerProfileId, followeeProfileId],
    );
    if (target.rowCount === 0) return "not_found";
    const ins = await this.pool.query(
      `insert into follows (follower_profile_id, followee_profile_id) values ($1, $2)
       on conflict do nothing`,
      [followerProfileId, followeeProfileId],
    );
    return ins.rowCount === 1 ? "ok" : "already";
  }

  async unfollow(followerProfileId: string, followeeProfileId: string): Promise<boolean> {
    if (!UUID_RE.test(followeeProfileId)) return false;
    const r = await this.pool.query(
      `delete from follows where follower_profile_id = $1 and followee_profile_id = $2`,
      [followerProfileId, followeeProfileId],
    );
    return r.rowCount === 1;
  }

  async getProfile(viewerProfileId: string, profileId: string): Promise<ProfileRow | null> {
    if (!UUID_RE.test(profileId)) return null;
    const r = await this.pool.query(
      `select ${PROFILE_COLUMNS}
         from profiles t
        where t.id = $2 and t.deleted_at is null
          and t.university_id = (select university_id from profiles where id = $1)`,
      [viewerProfileId, profileId],
    );
    return r.rows[0] ? profileRow(r.rows[0]) : null;
  }

  private async profileList(
    profileId: string,
    page: KeysetCursor,
    direction: "following" | "followers",
  ): Promise<ProfileRow[]> {
    const after = page.after;
    if (after !== null && !UUID_RE.test(after)) badCursor();

    const joinCol = direction === "following" ? "followee_profile_id" : "follower_profile_id";
    const ownCol = direction === "following" ? "follower_profile_id" : "followee_profile_id";
    const params: unknown[] = [profileId];
    let cursorSql = "";
    if (after) {
      params.push(after);
      cursorSql = `and t.id > $${params.length}`;
    }
    params.push(page.limit);
    const r = await this.pool.query(
      `select ${PROFILE_COLUMNS}
         from follows f join profiles t on t.id = f.${joinCol}
        where f.${ownCol} = $1 and t.deleted_at is null ${cursorSql}
        order by t.id
        limit $${params.length}`,
      params,
    );
    return r.rows.map(profileRow);
  }

  listFollowing(profileId: string, page: KeysetCursor): Promise<ProfileRow[]> {
    return this.profileList(profileId, page, "following");
  }

  listFollowers(profileId: string, page: KeysetCursor): Promise<ProfileRow[]> {
    return this.profileList(profileId, page, "followers");
  }

  async createNotification(input: {
    recipientProfileId: string;
    actorProfileId: string;
    kind: NotificationKind;
    postId: string | null;
    commentId: string | null;
    now: Date;
  }): Promise<void> {
    const payload = {
      actorProfileId: input.actorProfileId,
      postId: input.postId,
      commentId: input.commentId,
    };
    await this.pool.query(
      `insert into notifications (profile_id, kind, payload, created_at)
       select p.id, $2, $3::jsonb, $4 from profiles p
        where p.id = $1 and p.deleted_at is null`,
      [input.recipientProfileId, input.kind, JSON.stringify(payload), input.now],
    );
  }

  async listNotifications(profileId: string, page: KeysetCursor): Promise<NotificationRow[]> {
    const after = checkKey(page.after);
    const params: unknown[] = [profileId];
    let cursorSql = "";
    if (after) {
      params.push(after);
      const n = params.length;
      cursorSql = `and (n.created_at, n.id) < (
        split_part($${n}, '|', 1)::timestamp at time zone 'UTC',
        split_part($${n}, '|', 2)::uuid)`;
    }
    params.push(page.limit);
    const r = await this.pool.query(
      `select n.id, n.kind, n.created_at, n.read_at,
              n.payload->>'postId' as post_id, n.payload->>'commentId' as comment_id,
              to_char(n.created_at at time zone 'UTC', ${TS_FMT}) || '|' || n.id::text as cursor_key,
              a.id as author_id, a.kind as author_kind, a.handle as author_handle,
              a.display_name as author_display_name,
              (a.kind = 'known' and a.avatar_upload_id is not null) as author_has_avatar
         from notifications n
         join profiles a on a.id = (n.payload->>'actorProfileId')::uuid
        where n.profile_id = $1 and a.deleted_at is null ${cursorSql}
        order by n.created_at desc, n.id desc
        limit $${params.length}`,
      params,
    );
    return r.rows.map(
      (row): NotificationRow => ({
        id: row.id,
        kind: row.kind,
        createdAt: new Date(row.created_at),
        read: row.read_at !== null,
        actor: author(row),
        postId: row.post_id,
        commentId: row.comment_id,
        cursorKey: row.cursor_key,
      }),
    );
  }

  async markNotificationsRead(profileId: string, now: Date): Promise<number> {
    const r = await this.pool.query(
      `update notifications set read_at = $2 where profile_id = $1 and read_at is null`,
      [profileId, now],
    );
    return r.rowCount ?? 0;
  }

  async createPhotoUpload(input: {
    profileId: string;
    storageKey: string;
    width: number;
    height: number;
    now: Date;
  }): Promise<string> {
    const r = await this.pool.query(
      `insert into photo_uploads (profile_id, storage_key, width, height, created_at)
       values ($1, $2, $3, $4, $5) returning id`,
      [input.profileId, input.storageKey, input.width, input.height, input.now],
    );
    return r.rows[0].id;
  }

  async setPhotoAltText(uploadId: string, profileId: string, altText: string | null): Promise<boolean> {
    if (!UUID_RE.test(uploadId)) return false;
    const r = await this.pool.query(
      `update photo_uploads set alt_text = $3 where id = $1 and profile_id = $2`,
      [uploadId, profileId, altText],
    );
    return r.rowCount === 1;
  }

  async countPendingUploads(profileId: string): Promise<number> {
    const r = await this.pool.query(
      `select count(*)::int n from photo_uploads where profile_id = $1 and attached_at is null`,
      [profileId],
    );
    return r.rows[0].n;
  }

  async getPhotoUpload(uploadId: string): Promise<PhotoUploadRow | null> {
    if (!UUID_RE.test(uploadId)) return null;
    const r = await this.pool.query(
      `select u.id, u.profile_id, u.storage_key, u.width, u.height, p.university_id,
              coalesce(po.deleted_at is null and po.hidden_at is null, false) as post_visible
         from photo_uploads u
         join profiles p on p.id = u.profile_id and p.deleted_at is null
         left join post_photos ph on ph.storage_key = u.storage_key
         left join posts po on po.id = ph.post_id
        where u.id = $1`,
      [uploadId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      profileId: row.profile_id,
      storageKey: row.storage_key,
      width: row.width,
      height: row.height,
      universityId: row.university_id,
      postVisible: row.post_visible,
    };
  }

  async setAvatar(input: { profileId: string; uploadId: string; now: Date }): Promise<"ok" | "invalid"> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const up = await client.query(
        `select id from photo_uploads
          where id = $1 and profile_id = $2 and attached_at is null
          for update`,
        [input.uploadId, input.profileId],
      );
      if (up.rowCount === 0) {
        await client.query("rollback");
        return "invalid";
      }
      const prev = await client.query(
        `select avatar_upload_id from profiles where id = $1 and kind = 'known' for update`,
        [input.profileId],
      );
      if (prev.rowCount === 0) {
        await client.query("rollback");
        return "invalid";
      }
      const previousId: string | null = prev.rows[0].avatar_upload_id;
      await client.query(`update photo_uploads set attached_at = $2 where id = $1`, [
        input.uploadId,
        input.now,
      ]);
      await client.query(`update profiles set avatar_upload_id = $2 where id = $1`, [
        input.profileId,
        input.uploadId,
      ]);
      if (previousId) {
        // Released, so the retention job removes the old file with other unattached uploads.
        await client.query(`update photo_uploads set attached_at = null where id = $1`, [previousId]);
      }
      await client.query("commit");
      return "ok";
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async clearAvatar(profileId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const prev = await client.query(
        `select avatar_upload_id from profiles where id = $1 and kind = 'known' for update`,
        [profileId],
      );
      const previousId: string | null = prev.rows[0]?.avatar_upload_id ?? null;
      if (previousId) {
        await client.query(`update profiles set avatar_upload_id = null where id = $1`, [profileId]);
        await client.query(`update photo_uploads set attached_at = null where id = $1`, [previousId]);
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async getAvatarKey(viewerProfileId: string, profileId: string): Promise<string | null> {
    const r = await this.pool.query(
      `select u.storage_key
         from profiles t join photo_uploads u on u.id = t.avatar_upload_id
        where t.id = $2 and t.kind = 'known' and t.deleted_at is null
          and t.university_id = (select university_id from profiles where id = $1)`,
      [viewerProfileId, profileId],
    );
    return r.rows[0]?.storage_key ?? null;
  }

  async universityOfProfile(profileId: string): Promise<string | null> {
    const r = await this.pool.query(
      `select university_id from profiles where id = $1 and deleted_at is null`,
      [profileId],
    );
    return r.rows[0]?.university_id ?? null;
  }
}

