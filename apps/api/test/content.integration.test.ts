import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgContentStore } from "../src/content/pgStore.js";
import { ContentService, DEFAULT_CONTENT_OPTIONS } from "../src/content/service.js";
import type { Actor } from "../src/content/types.js";
import { MemoryPhotoStore } from "./helpers/memoryContent.js";

const password = process.env.TEST_PG_PASSWORD;
const host = process.env.TEST_PG_HOST ?? "127.0.0.1";
const port = Number(process.env.TEST_PG_PORT ?? 5432);
const database = process.env.TEST_PG_DB ?? "campus_social";

const suite = password ? describe : describe.skip;
const MIN = 60 * 1000;

function pool(user: string) {
  return new pg.Pool({ host, port, database, user, password, max: 4 });
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}

suite("PgContentStore (app_api role)", () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let svc: ContentService;
  let photos: MemoryPhotoStore;
  let clock: { now: Date };
  let uni1: string;
  let uni2: string;

  let alice: Actor;
  let aliceAnon: Actor;
  let bob: Actor;
  let carl: Actor;

  beforeAll(() => {
    admin = pool("postgres");
    app = pool("app_api");
  });

  afterAll(async () => {
    await Promise.all([admin?.end(), app?.end()]);
  });

  async function profile(
    uni: string,
    handle: string,
    kind: "known" | "anonymous" = "known",
  ): Promise<Actor> {
    const r = await admin.query(
      `insert into profiles (kind, university_id, handle, display_name)
       values ($1, $2, $3, $4) returning id`,
      [kind, uni, handle, kind === "known" ? handle.toUpperCase() : null],
    );
    return { profileId: r.rows[0].id, kind, canWrite: true };
  }

  beforeEach(async () => {
    await admin.query(
      `truncate profiles, universities, photo_uploads, notifications cascade`,
    );
    const u1 = await admin.query(
      `insert into universities (name, email_domain, active) values ('One', 'one.ac.ke', true) returning id`,
    );
    const u2 = await admin.query(
      `insert into universities (name, email_domain, active) values ('Two', 'two.ac.ke', true) returning id`,
    );
    uni1 = u1.rows[0].id;
    uni2 = u2.rows[0].id;

    alice = await profile(uni1, "alice");
    aliceAnon = await profile(uni1, "quiet_fox_1", "anonymous");
    bob = await profile(uni1, "bob");
    carl = await profile(uni2, "carl");

    photos = new MemoryPhotoStore();
    clock = { now: new Date("2026-10-12T10:17:42.123456Z") };
    svc = new ContentService(
      new PgContentStore(app),
      photos,
      { ...DEFAULT_CONTENT_OPTIONS, maxPostsPerHour: 1000, maxCommentsPerHour: 1000 },
      () => clock.now,
    );
  });

  const at = (minutes: number) => {
    clock.now = new Date(Date.UTC(2026, 9, 12, 8, 0, 0) + minutes * MIN);
  };

  it("scopes feeds, posts, profiles and follows to the viewer's university", async () => {
    at(0);
    const mine = await svc.createPost(alice, { body: "my campus" });
    const theirs = await svc.createPost(carl, { body: "other campus" });

    expect((await svc.campusFeed(bob, {})).items.map((p) => p.id)).toEqual([mine.id]);
    expect((await svc.campusFeed(carl, {})).items.map((p) => p.id)).toEqual([theirs.id]);

    expect(await code(svc.getPost(bob, theirs.id))).toBe("not_found");
    expect(await code(svc.getProfile(bob, carl.profileId))).toBe("not_found");
    expect(await code(svc.profilePosts(bob, carl.profileId, {}))).toBe("not_found");
    expect(await code(svc.follow(bob, carl.profileId))).toBe("not_found");
    expect(await code(svc.createComment(carl, mine.id, "hi"))).toBe("not_found");
    expect(await code(svc.react(carl, { postId: mine.id }))).toBe("not_found");
  });

  it("excludes deleted and hidden posts and deleted authors", async () => {
    at(0);
    const kept = await svc.createPost(alice, { body: "kept" });
    const deleted = await svc.createPost(alice, { body: "deleted" });
    const hidden = await svc.createPost(alice, { body: "hidden" });
    const fromGone = await svc.createPost(bob, { body: "from a closed account" });

    await svc.deletePost(alice, deleted.id);
    await admin.query(`update posts set hidden_at = now() where id = $1`, [hidden.id]);
    await admin.query(`update profiles set deleted_at = now() where id = $1`, [bob.profileId]);

    const feed = await svc.campusFeed(alice, {});
    expect(feed.items.map((p) => p.id)).toEqual([kept.id]);
    expect(await code(svc.getPost(alice, hidden.id))).toBe("not_found");
    expect(await code(svc.getPost(alice, fromGone.id))).toBe("not_found");
  });

  it("paginates newest-first without gaps or repeats, including same-millisecond posts", async () => {
    clock.now = new Date("2026-10-12T09:00:00.000Z");
    const sameInstant: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      sameInstant.push((await svc.createPost(alice, { body: `same-${i}` })).id);
    }
    at(120);
    await svc.createPost(alice, { body: "later" });

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const res = await svc.campusFeed(bob, { limit: 2, cursor });
      seen.push(...res.items.map((p) => p.id));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(new Set(seen.slice(1))).toEqual(new Set(sameInstant));
  });

  it("rejects malformed cursors with a clean 400, not a database error", async () => {
    const bad = Buffer.from("not-a-key", "utf8").toString("base64url");
    expect(await code(svc.campusFeed(bob, { cursor: bad }))).toBe("invalid_cursor");
    expect(await code(svc.followingFeed(bob, { cursor: bad }))).toBe("invalid_cursor");
    expect(await code(svc.notifications(bob, { cursor: bad }))).toBe("invalid_cursor");
  });

  it("ranks the top feed by reactions plus comments inside the window", async () => {
    at(0);
    await svc.createPost(alice, { body: "quiet" });
    at(1);
    const popular = await svc.createPost(alice, { body: "popular" });
    await svc.react(bob, { postId: popular.id });
    await svc.createComment(bob, popular.id, "nice");
    at(2);
    const mid = await svc.createPost(alice, { body: "mid" });
    await svc.react(bob, { postId: mid.id });

    const top = await svc.campusFeed(bob, { sort: "top" });
    expect(top.items.map((p) => p.body)).toEqual(["popular", "mid", "quiet"]);
    expect(top.items[0]).toMatchObject({ reactionCount: 1, commentCount: 1, viewerReacted: true });
  });

  it("drops posts older than the top window", async () => {
    clock.now = new Date("2026-09-01T10:00:00Z");
    await svc.createPost(alice, { body: "old" });
    clock.now = new Date("2026-10-12T10:00:00Z");
    expect((await svc.campusFeed(bob, { sort: "top" })).items).toHaveLength(0);
    expect((await svc.campusFeed(bob, {})).items).toHaveLength(1);
  });

  it("builds the following feed from followed profiles only", async () => {
    at(0);
    await svc.createPost(alice, { body: "from alice" });
    at(1);
    await svc.createPost(carl, { body: "other campus" });
    expect((await svc.followingFeed(bob, {})).items).toHaveLength(0);

    await svc.follow(bob, alice.profileId);
    expect((await svc.followingFeed(bob, {})).items.map((p) => p.body)).toEqual(["from alice"]);
  });

  it("never returns a real name or course for an anonymous profile", async () => {
    await admin.query(`alter table profiles drop constraint profiles_anon_no_realname`);
    try {
      await admin.query(
        `update profiles set display_name = 'Leaked Name', course = 'Law', study_year = 3 where id = $1`,
        [aliceAnon.profileId],
      );
      at(0);
      const post = await svc.createPost(aliceAnon, { body: "hi", confirmedAnonymous: true });
      expect(post.author.displayName).toBeNull();

      const profile = await svc.getProfile(bob, aliceAnon.profileId);
      expect(profile).toMatchObject({ displayName: null, course: null, studyYear: null });
      expect(JSON.stringify(await svc.campusFeed(bob, {}))).not.toContain("Leaked Name");
    } finally {
      await admin.query(
        `update profiles set display_name = null, course = null, study_year = null where id = $1`,
        [aliceAnon.profileId],
      );
      await admin.query(
        `alter table profiles add constraint profiles_anon_no_realname
           check (kind <> 'anonymous' or (display_name is null and course is null and study_year is null))`,
      );
    }
  });

  it("rounds anonymous timestamps to the hour and keeps known ones exact", async () => {
    clock.now = new Date("2026-10-12T10:17:42.123Z");
    const anon = await svc.createPost(aliceAnon, { body: "a", confirmedAnonymous: true });
    const known = await svc.createPost(alice, { body: "k" });
    expect(anon.createdAt).toBe("2026-10-12T10:00:00.000Z");
    expect(known.createdAt).toBe("2026-10-12T10:17:42.123Z");
  });

  it("keeps follow graphs and notifications separate per profile", async () => {
    await svc.follow(bob, aliceAnon.profileId);
    expect((await svc.getProfile(bob, aliceAnon.profileId)).followerCount).toBe(1);
    expect((await svc.getProfile(bob, alice.profileId)).followerCount).toBe(0);

    expect((await svc.notifications(aliceAnon, {})).items).toHaveLength(1);
    expect((await svc.notifications(alice, {})).items).toHaveLength(0);
    expect((await svc.myFollowers(alice, {})).items).toHaveLength(0);
    expect((await svc.myFollowers(aliceAnon, {})).items).toHaveLength(1);
  });

  it("creates, lists, paginates and soft-deletes comments", async () => {
    at(0);
    const post = await svc.createPost(alice, { body: "thread" });
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      at(1 + i);
      ids.push((await svc.createComment(bob, post.id, `c${i}`)).id);
    }

    const first = await svc.listComments(alice, post.id, { limit: 2 });
    expect(first.items.map((c) => c.body)).toEqual(["c0", "c1"]);
    const second = await svc.listComments(alice, post.id, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((c) => c.body)).toEqual(["c2"]);
    expect(second.nextCursor).toBeNull();

    expect(await code(svc.deleteComment(alice, ids[0]!))).toBe("not_found");
    await svc.deleteComment(bob, ids[0]!);
    expect((await svc.listComments(alice, post.id, {})).items).toHaveLength(2);
    expect((await svc.getPost(alice, post.id)).commentCount).toBe(2);
  });

  it("makes reactions idempotent and notifies the author once", async () => {
    const post = await svc.createPost(alice, { body: "like me" });
    await svc.react(bob, { postId: post.id });
    await svc.react(bob, { postId: post.id });
    expect((await svc.getPost(bob, post.id)).reactionCount).toBe(1);
    expect((await svc.notifications(alice, {})).items).toHaveLength(1);

    const comment = await svc.createComment(alice, post.id, "reply");
    await svc.react(bob, { commentId: comment.id });
    const listed = await svc.listComments(bob, post.id, {});
    expect(listed.items[0]).toMatchObject({ reactionCount: 1, viewerReacted: true });

    await svc.unreact(bob, { postId: post.id });
    expect((await svc.getPost(bob, post.id)).reactionCount).toBe(0);
  });

  it("notifies on comment, reaction and follow and marks them read", async () => {
    const post = await svc.createPost(alice, { body: "hello" });
    await svc.follow(bob, alice.profileId);
    await svc.createComment(bob, post.id, "hi");
    await svc.react(bob, { postId: post.id });

    const list = await svc.notifications(alice, {});
    expect(list.items.map((n) => n.kind).sort()).toEqual(["comment", "follow", "reaction"]);
    expect(list.items[0]?.actor.handle).toBe("bob");

    expect(await svc.markNotificationsRead(alice)).toEqual({ marked: 3 });
    expect((await svc.notifications(alice, {})).items.every((n) => n.read)).toBe(true);
  });

  it("reports profile counts and the viewer's follow state", async () => {
    at(0);
    await svc.createPost(alice, { body: "p1" });
    at(1);
    const p2 = await svc.createPost(alice, { body: "p2" });
    await svc.deletePost(alice, p2.id);
    await svc.follow(bob, alice.profileId);
    await svc.follow(alice, bob.profileId);

    const view = await svc.getProfile(bob, alice.profileId);
    expect(view).toMatchObject({
      postCount: 1,
      followerCount: 1,
      followingCount: 1,
      viewerFollows: true,
      isSelf: false,
    });
    expect((await svc.getProfile(alice, alice.profileId)).isSelf).toBe(true);
  });

  it("lists following and followers for the acting profile with a stable cursor", async () => {
    const extra: Actor[] = [];
    for (let i = 0; i < 3; i += 1) extra.push(await profile(uni1, `friend${i}`));
    for (const f of extra) await svc.follow(alice, f.profileId);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i += 1) {
      const page = await svc.myFollowing(alice, { limit: 2, cursor });
      seen.push(...page.items.map((p) => p.profileId));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(new Set(seen)).toEqual(new Set(extra.map((e) => e.profileId)));
    expect(seen).toHaveLength(3);
  });

  it("attaches uploads atomically and serves them to the campus only", async () => {
    const img = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#4488cc" },
    })
      .jpeg()
      .toBuffer();
    const a = await svc.uploadPhoto(alice, img);
    const b = await svc.uploadPhoto(alice, img);

    const post = await svc.createPost(alice, { body: "two pics", photoIds: [a.id, b.id] });
    expect(post.photos.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(post.photos[0]).toMatchObject({ width: 40, height: 30 });

    expect((await svc.readPhoto(bob, a.id)).length).toBeGreaterThan(0);
    expect(await code(svc.readPhoto(carl, a.id))).toBe("not_found");

    expect(await code(svc.createPost(alice, { body: "x", photoIds: [a.id] }))).toBe("photo_invalid");
    const bobs = await svc.uploadPhoto(bob, img);
    expect(await code(svc.createPost(alice, { body: "x", photoIds: [bobs.id] }))).toBe(
      "photo_invalid",
    );

    const count = await admin.query(`select count(*)::int n from posts where body = 'x'`);
    expect(count.rows[0].n).toBe(0);

    await svc.deletePost(alice, post.id);
    expect(await code(svc.readPhoto(bob, a.id))).toBe("not_found");
    expect(await code(svc.readPhoto(alice, a.id))).toBe("ok");
  });

  describe("role privileges", () => {
    it("app_api cannot read accounts, sessions or the identity schema", async () => {
      await expect(app.query(`select * from accounts`)).rejects.toThrow(/permission denied/);
      await expect(app.query(`select * from sessions`)).rejects.toThrow(/permission denied/);
      await expect(app.query(`select * from email_codes`)).rejects.toThrow(/permission denied/);
      await expect(app.query(`select * from identity.anonymous_links`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(app.query(`select * from identity.known_profile_owner`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(app.query(`select * from identity.lookup_audit`)).rejects.toThrow(
        /permission denied/,
      );
    });

    it("app_api cannot delete posts or profiles, only soft-delete posts", async () => {
      await expect(app.query(`delete from posts`)).rejects.toThrow(/permission denied/);
      await expect(app.query(`delete from profiles`)).rejects.toThrow(/permission denied/);
      await expect(app.query(`update profiles set handle = 'x'`)).rejects.toThrow(
        /permission denied/,
      );
    });

    it("app_api cannot call unmasking or penalty functions", async () => {
      await expect(
        app.query(`select identity.unmask_profile('\\x01','x','court_order','long enough reason text')`),
      ).rejects.toThrow(/permission denied/);
      await expect(app.query(`select * from moderation.penalties`)).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  describe("editing while a report is open", () => {
    async function reporterAccount(): Promise<string> {
      const r = await admin.query(
        `insert into accounts (university_id, email, date_of_birth, terms_accepted_at, terms_version,
                               status, email_verified_at, last_reverified_at, reverify_due_at)
         values ($1, 'reporter@one.ac.ke', '2004-05-01', now(), 'v', 'active', now(), now(), now() + interval '1 year')
         returning id`,
        [uni1],
      );
      return r.rows[0].id;
    }

    async function fileReport(postId: string, accountId: string): Promise<string> {
      const r = await admin.query(
        `insert into moderation.reports (target_kind, target_id, reason, reporter_account_id)
         values ('post', $1, 'harassment', $2) returning id`,
        [postId, accountId],
      );
      return r.rows[0].id;
    }

    it("lets the author edit freely until someone reports the post", async () => {
      at(0);
      const post = await svc.createPost(alice, { body: "v1" });
      expect((await svc.editPost(alice, post.id, "v2")).body).toBe("v2");

      await fileReport(post.id, await reporterAccount());
      expect(await code(svc.editPost(alice, post.id, "v3"))).toBe("under_review");
      expect((await svc.getPost(bob, post.id)).body).toBe("v2");
    });

    it("lets the author edit again once the report is resolved either way", async () => {
      at(0);
      const post = await svc.createPost(alice, { body: "v1" });
      const reportId = await fileReport(post.id, await reporterAccount());
      expect(await code(svc.editPost(alice, post.id, "v2"))).toBe("under_review");

      await admin.query(`update moderation.reports set status = 'dismissed', resolved_at = now() where id = $1`, [reportId]);
      expect((await svc.editPost(alice, post.id, "v2")).body).toBe("v2");

      await admin.query(`update moderation.reports set status = 'open', resolved_at = null where id = $1`, [reportId]);
      expect(await code(svc.editPost(alice, post.id, "v3"))).toBe("under_review");
      await admin.query(`update moderation.reports set status = 'actioned', resolved_at = now() where id = $1`, [reportId]);
      expect(await code(svc.editPost(alice, post.id, "v3"))).not.toBe("under_review");
    });

    it("tells no one but the author, and one post's report does not lock another", async () => {
      at(0);
      const reported = await svc.createPost(alice, { body: "reported" });
      const other = await svc.createPost(alice, { body: "other" });
      await fileReport(reported.id, await reporterAccount());

      expect(await code(svc.editPost(bob, reported.id, "hijack"))).toBe("not_found");
      expect((await svc.editPost(alice, other.id, "other v2")).body).toBe("other v2");
    });

    it("lets the posting role ask the question but not read any report", async () => {
      at(0);
      const post = await svc.createPost(alice, { body: "v1" });
      const asked = await app.query(`select moderation.post_has_open_report($1) as locked`, [post.id]);
      expect(asked.rows[0].locked).toBe(false);
      await expect(app.query(`select * from moderation.reports`)).rejects.toThrow(/permission denied/);
    });
  });

  describe("photo alt text", () => {
    async function img() {
      return sharp({ create: { width: 40, height: 30, channels: 3, background: "#4488cc" } })
        .jpeg()
        .toBuffer();
    }

    it("stores the description with the post and returns it in feed and post views", async () => {
      at(0);
      const a = await svc.uploadPhoto(alice, await img());
      const b = await svc.uploadPhoto(alice, await img());
      const post = await svc.createPost(alice, {
        body: "two pics",
        photoIds: [a.id, b.id],
        altTexts: { [a.id]: "  A   red bicycle\nleaning on a wall ", [b.id]: "   " },
      });
      expect(post.photos.map((p) => p.altText)).toEqual(["A red bicycle leaning on a wall", null]);

      const feed = await svc.campusFeed(bob, {});
      expect(feed.items[0]!.photos[0]!.altText).toBe("A red bicycle leaning on a wall");
      expect((await svc.getPost(bob, post.id)).photos[1]!.altText).toBeNull();
    });

    it("refuses a description for a photo that is not in the post, and one that is too long", async () => {
      at(0);
      const a = await svc.uploadPhoto(alice, await img());
      const other = await svc.uploadPhoto(alice, await img());
      expect(
        await code(svc.createPost(alice, { body: "x", photoIds: [a.id], altTexts: { [other.id]: "nope" } })),
      ).toBe("photo_invalid");
      expect(
        await code(
          svc.createPost(alice, { body: "x", photoIds: [a.id], altTexts: { [a.id]: "x".repeat(501) } }),
        ),
      ).toBe("alt_text_too_long");
      const ok = await svc.createPost(alice, { body: "x", photoIds: [a.id], altTexts: { [a.id]: "fine" } });
      expect(ok.photos[0]!.altText).toBe("fine");
    });

    it("lets only the uploader change or clear it", async () => {
      at(0);
      const a = await svc.uploadPhoto(alice, await img());
      const post = await svc.createPost(alice, { body: "x", photoIds: [a.id], altTexts: { [a.id]: "first" } });

      expect(await code(svc.setPhotoAltText(bob, a.id, "vandalised"))).toBe("not_found");
      expect((await svc.getPost(alice, post.id)).photos[0]!.altText).toBe("first");

      await svc.setPhotoAltText(alice, a.id, "  second ");
      expect((await svc.getPost(bob, post.id)).photos[0]!.altText).toBe("second");

      await svc.setPhotoAltText(alice, a.id, null);
      expect((await svc.getPost(bob, post.id)).photos[0]!.altText).toBeNull();
    });

    it("keeps an anonymous author's description with the anonymous profile only", async () => {
      at(0);
      const a = await svc.uploadPhoto(aliceAnon, await img());
      expect(await code(svc.setPhotoAltText(alice, a.id, "x"))).toBe("not_found");
      const post = await svc.createPost(aliceAnon, {
        body: "x",
        photoIds: [a.id],
        altTexts: { [a.id]: "A notice board" },
        confirmedAnonymous: true,
      });
      expect(post.photos[0]!.altText).toBe("A notice board");
    });

    it("is part of the database as nullable text with a length backstop", async () => {
      const col = await admin.query(
        `select is_nullable from information_schema.columns
          where table_name = 'photo_uploads' and column_name = 'alt_text'`,
      );
      expect(col.rows[0].is_nullable).toBe("YES");
      const a = await svc.uploadPhoto(alice, await img());
      await expect(
        admin.query(`update photo_uploads set alt_text = $2 where id = $1`, [a.id, "x".repeat(501)]),
      ).rejects.toThrow(/check constraint/);
      await expect(
        admin.query(`update photo_uploads set alt_text = '' where id = $1`, [a.id]),
      ).rejects.toThrow(/check constraint/);
    });
  });

});
