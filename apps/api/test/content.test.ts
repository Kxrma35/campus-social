import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import {
  ContentService,
  DEFAULT_CONTENT_OPTIONS,
  roundToHour,
  type ContentOptions,
} from "../src/content/service.js";
import type { Actor } from "../src/content/types.js";
import { AuthActorResolver } from "../src/content/actor.js";
import {
  CapturingMailer,
  MemoryAuthStore,
} from "./helpers/memoryStore.js";
import {
  FakeActorResolver,
  MemoryContentStore,
  MemoryPhotoStore,
} from "./helpers/memoryContent.js";

const HOUR = 60 * 60 * 1000;

interface Ctx {
  store: MemoryContentStore;
  photos: MemoryPhotoStore;
  svc: ContentService;
  clock: { now: Date };
  alice: Actor;
  aliceAnon: Actor;
  bob: Actor;
  carl: Actor;
}

function actor(profileId: string, kind: "known" | "anonymous" = "known", canWrite = true): Actor {
  return { profileId, kind, canWrite };
}

function setup(opts: Partial<ContentOptions> = {}): Ctx {
  const store = new MemoryContentStore();
  const photos = new MemoryPhotoStore();
  const clock = { now: new Date("2026-10-12T10:17:42.123Z") };
  const svc = new ContentService(
    store,
    photos,
    { ...DEFAULT_CONTENT_OPTIONS, ...opts },
    () => clock.now,
  );
  const alice = actor(store.addProfile({ handle: "alice", displayName: "Alice A" }));
  const aliceAnon = actor(store.addProfile({ kind: "anonymous", handle: "quiet_fox_42" }), "anonymous");
  const bob = actor(store.addProfile({ handle: "bob", displayName: "Bob B" }));
  const carl = actor(store.addProfile({ handle: "carl", displayName: "Carl C", universityId: "u2" }));
  return { store, photos, svc, clock, alice, aliceAnon, bob, carl };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: "#4488cc" } })
    .jpeg()
    .toBuffer();
}

describe("posting", () => {
  let c: Ctx;
  beforeEach(() => {
    c = setup();
  });

  it("creates and reads back a post", async () => {
    const post = await c.svc.createPost(c.alice, { body: "  hello campus  " });
    expect(post.body).toBe("hello campus");
    expect(post.author).toMatchObject({ kind: "known", handle: "alice", displayName: "Alice A" });
    expect((await c.svc.getPost(c.bob, post.id)).id).toBe(post.id);
  });

  it("rejects empty posts and posts that are too long", async () => {
    expect(await code(c.svc.createPost(c.alice, { body: "   " }))).toBe("empty_post");
    expect(await code(c.svc.createPost(c.alice, { body: "x".repeat(5001) }))).toBe("body_too_long");
  });

  it("allows a photo-only post", async () => {
    const up = await c.svc.uploadPhoto(c.alice, await jpeg());
    const post = await c.svc.createPost(c.alice, { body: "", photoIds: [up.id] });
    expect(post.photos).toHaveLength(1);
    expect(post.photos[0]?.url).toBe(`/photos/${up.id}`);
  });

  describe("photo alt text", () => {
    it("stores a cleaned description and returns it in views", async () => {
      const a = await c.svc.uploadPhoto(c.alice, await jpeg());
      const b = await c.svc.uploadPhoto(c.alice, await jpeg());
      const post = await c.svc.createPost(c.alice, {
        body: "pics",
        photoIds: [a.id, b.id],
        altTexts: { [a.id]: "  A   red\nbicycle ", [b.id]: "   " },
      });
      expect(post.photos.map((p) => p.altText)).toEqual(["A red bicycle", null]);
      expect((await c.svc.getPost(c.bob, post.id)).photos[0]?.altText).toBe("A red bicycle");
    });

    it("refuses a description for a photo that is not in the post, or one that is too long", async () => {
      const a = await c.svc.uploadPhoto(c.alice, await jpeg());
      const other = await c.svc.uploadPhoto(c.alice, await jpeg());
      expect(
        await code(c.svc.createPost(c.alice, { body: "x", photoIds: [a.id], altTexts: { [other.id]: "no" } })),
      ).toBe("photo_invalid");
      expect(
        await code(
          c.svc.createPost(c.alice, { body: "x", photoIds: [a.id], altTexts: { [a.id]: "x".repeat(501) } }),
        ),
      ).toBe("alt_text_too_long");
      const ok = await c.svc.createPost(c.alice, {
        body: "x",
        photoIds: [a.id],
        altTexts: { [a.id]: "x".repeat(500) },
      });
      expect(ok.photos[0]?.altText).toHaveLength(500);
    });

    it("lets only the uploader set, change or clear it", async () => {
      const a = await c.svc.uploadPhoto(c.alice, await jpeg());
      const post = await c.svc.createPost(c.alice, { body: "x", photoIds: [a.id] });
      expect(await code(c.svc.setPhotoAltText(c.bob, a.id, "vandal"))).toBe("not_found");
      await c.svc.setPhotoAltText(c.alice, a.id, " a notice board ");
      expect((await c.svc.getPost(c.bob, post.id)).photos[0]?.altText).toBe("a notice board");
      await c.svc.setPhotoAltText(c.alice, a.id, "");
      expect((await c.svc.getPost(c.bob, post.id)).photos[0]?.altText).toBeNull();
    });

    it("cannot be set on a read-only account", async () => {
      const a = await c.svc.uploadPhoto(c.alice, await jpeg());
      expect(await code(c.svc.setPhotoAltText({ ...c.alice, canWrite: false }, a.id, "x"))).toBe("read_only");
    });
  });

  it("limits a post to 4 photos", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await c.svc.uploadPhoto(c.alice, await jpeg())).id);
    expect(await code(c.svc.createPost(c.alice, { body: "x", photoIds: ids }))).toBe(
      "too_many_photos",
    );
    expect((await c.svc.createPost(c.alice, { body: "x", photoIds: ids.slice(0, 4) })).photos).toHaveLength(4);
  });

  it("refuses to attach someone else's photo or reuse one", async () => {
    const bobs = await c.svc.uploadPhoto(c.bob, await jpeg());
    expect(await code(c.svc.createPost(c.alice, { body: "x", photoIds: [bobs.id] }))).toBe(
      "photo_invalid",
    );

    const mine = await c.svc.uploadPhoto(c.alice, await jpeg());
    await c.svc.createPost(c.alice, { body: "first", photoIds: [mine.id] });
    expect(await code(c.svc.createPost(c.alice, { body: "again", photoIds: [mine.id] }))).toBe(
      "photo_invalid",
    );
  });

  it("stores only sanitised photo bytes", async () => {
    const withGps = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#fff" },
    })
      .withExif({ IFD0: { Copyright: "leak-me" } })
      .jpeg()
      .toBuffer();
    await c.svc.uploadPhoto(c.alice, withGps);
    const stored = [...c.photos.files.values()][0]!;
    expect(stored.toString("latin1")).not.toContain("leak-me");
  });

  it("edits only the author's own post and marks it edited", async () => {
    const post = await c.svc.createPost(c.alice, { body: "v1" });
    expect(await code(c.svc.editPost(c.bob, post.id, "hijack"))).toBe("not_found");
    const edited = await c.svc.editPost(c.alice, post.id, "v2");
    expect(edited.body).toBe("v2");
    expect(edited.edited).toBe(true);
  });

  it("refuses to edit a post while a report on it is open, and lets the author in again afterwards", async () => {
    const post = await c.svc.createPost(c.alice, { body: "v1" });
    c.store.postsUnderReview.add(post.id);

    expect(await code(c.svc.editPost(c.alice, post.id, "v2"))).toBe("under_review");
    expect((await c.svc.getPost(c.bob, post.id)).body).toBe("v1");

    c.store.postsUnderReview.delete(post.id);
    expect((await c.svc.editPost(c.alice, post.id, "v2")).body).toBe("v2");
  });

  it("does not tell anyone but the author that a post is under review", async () => {
    const post = await c.svc.createPost(c.alice, { body: "v1" });
    c.store.postsUnderReview.add(post.id);
    expect(await code(c.svc.editPost(c.bob, post.id, "hijack"))).toBe("not_found");
    expect(await code(c.svc.editPost(c.alice, post.id, "mine"))).toBe("under_review");
  });

  it("removes a deleted post from feeds and reads at once", async () => {
    const post = await c.svc.createPost(c.alice, { body: "oops" });
    expect(await code(c.svc.deletePost(c.bob, post.id))).toBe("not_found");
    await c.svc.deletePost(c.alice, post.id);
    expect(await code(c.svc.getPost(c.bob, post.id))).toBe("not_found");
    expect((await c.svc.campusFeed(c.bob, {})).items).toHaveLength(0);
  });

  it("enforces an hourly post limit", async () => {
    const small = setup({ maxPostsPerHour: 2 });
    await small.svc.createPost(small.alice, { body: "1" });
    await small.svc.createPost(small.alice, { body: "2" });
    expect(await code(small.svc.createPost(small.alice, { body: "3" }))).toBe("rate_limited");
    small.clock.now = new Date(small.clock.now.getTime() + HOUR + 1000);
    expect(await code(small.svc.createPost(small.alice, { body: "3" }))).toBe("ok");
  });
});

describe("read-only accounts", () => {
  it("can read and delete but not create", async () => {
    const c = setup();
    const post = await c.svc.createPost(c.alice, { body: "before lapse" });
    const lapsed = { ...c.alice, canWrite: false };

    expect(await code(c.svc.createPost(lapsed, { body: "x" }))).toBe("read_only");
    expect(await code(c.svc.createComment(lapsed, post.id, "x"))).toBe("read_only");
    expect(await code(c.svc.react(lapsed, { postId: post.id }))).toBe("read_only");
    expect(await code(c.svc.follow(lapsed, c.bob.profileId))).toBe("read_only");
    expect(await code(c.svc.uploadPhoto(lapsed, await jpeg()))).toBe("read_only");
    expect(await code(c.svc.editPost(lapsed, post.id, "x"))).toBe("read_only");

    expect(await code(c.svc.getPost(lapsed, post.id))).toBe("ok");
    expect(await code(c.svc.campusFeed(lapsed, {}))).toBe("ok");
    expect(await code(c.svc.deletePost(lapsed, post.id))).toBe("ok");
  });
});

describe("anonymous posting safeguards", () => {
  let c: Ctx;
  beforeEach(() => {
    c = setup();
  });

  it("needs explicit confirmation for the first few anonymous posts", async () => {
    for (let i = 0; i < DEFAULT_CONTENT_OPTIONS.anonymousConfirmFirstN; i += 1) {
      expect(await code(c.svc.createPost(c.aliceAnon, { body: `p${i}` }))).toBe(
        "confirmation_required",
      );
      expect(
        await code(c.svc.createPost(c.aliceAnon, { body: `p${i}`, confirmedAnonymous: true })),
      ).toBe("ok");
    }
    expect(await code(c.svc.createPost(c.aliceAnon, { body: "later" }))).toBe("ok");
  });

  it("does not let deleting posts reset the confirmation requirement", async () => {
    for (let i = 0; i < 3; i += 1) {
      const p = await c.svc.createPost(c.aliceAnon, { body: `p${i}`, confirmedAnonymous: true });
      await c.svc.deletePost(c.aliceAnon, p.id);
    }
    expect(await code(c.svc.createPost(c.aliceAnon, { body: "x" }))).toBe("ok");
  });

  it("never asks known profiles to confirm", async () => {
    expect(await code(c.svc.createPost(c.alice, { body: "hi" }))).toBe("ok");
  });

  it("hides the real name and rounds timestamps for anonymous authors", async () => {
    const anon = await c.svc.createPost(c.aliceAnon, { body: "secret", confirmedAnonymous: true });
    const known = await c.svc.createPost(c.alice, { body: "open" });

    expect(anon.author.displayName).toBeNull();
    expect(anon.createdAt).toBe("2026-10-12T10:00:00.000Z");
    expect(known.createdAt).toBe("2026-10-12T10:17:42.123Z");
  });

  it("rounds comment and notification times for anonymous actors", async () => {
    const post = await c.svc.createPost(c.bob, { body: "thread" });
    const comment = await c.svc.createComment(c.aliceAnon, post.id, "from the shadows");
    expect(comment.createdAt).toBe("2026-10-12T10:00:00.000Z");
    expect(comment.author.displayName).toBeNull();

    const n = (await c.svc.notifications(c.bob, {})).items[0]!;
    expect(n.kind).toBe("comment");
    expect(n.createdAt).toBe("2026-10-12T10:00:00.000Z");
    expect(n.actor.kind).toBe("anonymous");
    expect(n.actor.displayName).toBeNull();
  });

  it("rounds to the hour boundary", () => {
    expect(roundToHour(new Date("2026-10-12T10:59:59.999Z")).toISOString()).toBe(
      "2026-10-12T10:00:00.000Z",
    );
  });
});

describe("campus isolation", () => {
  it("hides other campuses' posts, profiles, comments and follows", async () => {
    const c = setup();
    const theirs = await c.svc.createPost(c.carl, { body: "other campus" });
    const mine = await c.svc.createPost(c.alice, { body: "my campus" });

    expect(await code(c.svc.getPost(c.alice, theirs.id))).toBe("not_found");
    expect(await code(c.svc.getProfile(c.alice, c.carl.profileId))).toBe("not_found");
    expect(await code(c.svc.createComment(c.carl, mine.id, "hi"))).toBe("not_found");
    expect(await code(c.svc.react(c.carl, { postId: mine.id }))).toBe("not_found");
    expect(await code(c.svc.follow(c.alice, c.carl.profileId))).toBe("not_found");
    expect(await code(c.svc.profilePosts(c.alice, c.carl.profileId, {}))).toBe("not_found");

    const feed = await c.svc.campusFeed(c.alice, {});
    expect(feed.items.map((p) => p.id)).toEqual([mine.id]);
  });

  it("only serves photos to the uploader's campus", async () => {
    const c = setup();
    const up = await c.svc.uploadPhoto(c.alice, await jpeg());
    await c.svc.createPost(c.alice, { body: "pic", photoIds: [up.id] });

    expect((await c.svc.readPhoto(c.bob, up.id)).length).toBeGreaterThan(0);
    expect(await code(c.svc.readPhoto(c.carl, up.id))).toBe("not_found");
  });

  it("hides photos of deleted posts from everyone except the uploader", async () => {
    const c = setup();
    const up = await c.svc.uploadPhoto(c.alice, await jpeg());
    const post = await c.svc.createPost(c.alice, { body: "pic", photoIds: [up.id] });
    await c.svc.deletePost(c.alice, post.id);

    expect(await code(c.svc.readPhoto(c.bob, up.id))).toBe("not_found");
    expect(await code(c.svc.readPhoto(c.alice, up.id))).toBe("ok");
  });
});

describe("feeds", () => {
  let c: Ctx;
  beforeEach(() => {
    c = setup();
  });

  async function postAt(a: Actor, body: string, minutes: number) {
    c.clock.now = new Date(Date.UTC(2026, 9, 12, 8, minutes, 0));
    return c.svc.createPost(a, { body });
  }

  it("lists newest first and paginates without gaps or repeats", async () => {
    for (let i = 0; i < 5; i += 1) await postAt(c.alice, `p${i}`, i);

    const first = await c.svc.campusFeed(c.bob, { limit: 2 });
    expect(first.items.map((p) => p.body)).toEqual(["p4", "p3"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await c.svc.campusFeed(c.bob, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((p) => p.body)).toEqual(["p2", "p1"]);

    const third = await c.svc.campusFeed(c.bob, { limit: 2, cursor: second.nextCursor! });
    expect(third.items.map((p) => p.body)).toEqual(["p0"]);
    expect(third.nextCursor).toBeNull();
  });

  it("ranks the top feed by reactions and comments within the window", async () => {
    const quiet = await postAt(c.alice, "quiet", 0);
    const popular = await postAt(c.alice, "popular", 1);
    await c.svc.react(c.bob, { postId: popular.id });
    await c.svc.createComment(c.bob, popular.id, "nice");
    const mid = await postAt(c.alice, "mid", 2);
    await c.svc.react(c.bob, { postId: mid.id });

    const top = await c.svc.campusFeed(c.bob, { sort: "top" });
    expect(top.items.map((p) => p.body)).toEqual(["popular", "mid", "quiet"]);
    expect(top.items[0]?.reactionCount).toBe(1);
    expect(top.items[0]?.commentCount).toBe(1);
    expect(top.items[2]?.id).toBe(quiet.id);
  });

  it("drops posts older than the top window", async () => {
    c.clock.now = new Date("2026-09-01T10:00:00Z");
    await c.svc.createPost(c.alice, { body: "old" });
    c.clock.now = new Date("2026-10-12T10:00:00Z");
    expect((await c.svc.campusFeed(c.bob, { sort: "top" })).items).toHaveLength(0);
    expect((await c.svc.campusFeed(c.bob, {})).items).toHaveLength(1);
  });

  it("shows only followed profiles in the following feed", async () => {
    await postAt(c.alice, "from alice", 0);
    await postAt(c.bob, "from bob", 1);
    expect((await c.svc.followingFeed(c.bob, {})).items).toHaveLength(0);

    await c.svc.follow(c.bob, c.alice.profileId);
    const feed = await c.svc.followingFeed(c.bob, {});
    expect(feed.items.map((p) => p.body)).toEqual(["from alice"]);
  });

  it("keeps a person's two profiles' follow graphs separate", async () => {
    await c.svc.follow(c.bob, c.aliceAnon.profileId);
    expect((await c.svc.getProfile(c.bob, c.aliceAnon.profileId)).followerCount).toBe(1);
    expect((await c.svc.getProfile(c.bob, c.alice.profileId)).followerCount).toBe(0);
    expect((await c.svc.myFollowers(c.alice, {})).items).toHaveLength(0);
    expect((await c.svc.myFollowers(c.aliceAnon, {})).items).toHaveLength(1);
  });

  it("rejects malformed cursors", async () => {
    expect(await code(c.svc.campusFeed(c.bob, { sort: "top", cursor: "bm90LWEtbnVtYmVy" }))).toBe(
      "invalid_cursor",
    );
    expect(await code(c.svc.campusFeed(c.bob, { sort: "top", cursor: "OTk5OQ" }))).toBe(
      "invalid_cursor",
    );
  });
});

describe("comments, reactions and follows", () => {
  let c: Ctx;
  beforeEach(() => {
    c = setup();
  });

  it("creates, lists and deletes comments", async () => {
    const post = await c.svc.createPost(c.alice, { body: "thread" });
    const first = await c.svc.createComment(c.bob, post.id, "first");
    c.clock.now = new Date(c.clock.now.getTime() + 1000);
    await c.svc.createComment(c.alice, post.id, "second");

    const list = await c.svc.listComments(c.bob, post.id, {});
    expect(list.items.map((x) => x.body)).toEqual(["first", "second"]);
    expect(list.items[0]?.author.handle).toBe("bob");

    expect(await code(c.svc.deleteComment(c.alice, first.id))).toBe("not_found");
    await c.svc.deleteComment(c.bob, first.id);
    expect((await c.svc.listComments(c.bob, post.id, {})).items).toHaveLength(1);
  });

  it("validates comment length", async () => {
    const post = await c.svc.createPost(c.alice, { body: "t" });
    expect(await code(c.svc.createComment(c.bob, post.id, " "))).toBe("invalid_body");
    expect(await code(c.svc.createComment(c.bob, post.id, "x".repeat(2001)))).toBe("invalid_body");
  });

  it("makes reactions idempotent and notifies once", async () => {
    const post = await c.svc.createPost(c.alice, { body: "like me" });
    await c.svc.react(c.bob, { postId: post.id });
    await c.svc.react(c.bob, { postId: post.id });
    expect((await c.svc.getPost(c.bob, post.id)).reactionCount).toBe(1);
    expect((await c.svc.getPost(c.bob, post.id)).viewerReacted).toBe(true);
    expect((await c.svc.notifications(c.alice, {})).items).toHaveLength(1);

    await c.svc.unreact(c.bob, { postId: post.id });
    expect((await c.svc.getPost(c.bob, post.id)).reactionCount).toBe(0);
  });

  it("does not notify people about their own activity", async () => {
    const post = await c.svc.createPost(c.alice, { body: "solo" });
    await c.svc.react(c.alice, { postId: post.id });
    await c.svc.createComment(c.alice, post.id, "note to self");
    expect((await c.svc.notifications(c.alice, {})).items).toHaveLength(0);
  });

  it("notifies on follow, comment and reaction, and marks them read", async () => {
    const post = await c.svc.createPost(c.alice, { body: "hello" });
    await c.svc.follow(c.bob, c.alice.profileId);
    await c.svc.createComment(c.bob, post.id, "hi");
    await c.svc.react(c.bob, { postId: post.id });

    const list = await c.svc.notifications(c.alice, {});
    expect(list.items.map((n) => n.kind).sort()).toEqual(["comment", "follow", "reaction"]);
    expect(list.items.every((n) => !n.read)).toBe(true);

    expect(await c.svc.markNotificationsRead(c.alice)).toEqual({ marked: 3 });
    expect((await c.svc.notifications(c.alice, {})).items.every((n) => n.read)).toBe(true);
  });

  it("notifications are per profile", async () => {
    const aliceAnonPost = await c.svc.createPost(c.aliceAnon, { body: "anon", confirmedAnonymous: true });
    await c.svc.react(c.bob, { postId: aliceAnonPost.id });

    expect((await c.svc.notifications(c.aliceAnon, {})).items).toHaveLength(1);
    expect((await c.svc.notifications(c.alice, {})).items).toHaveLength(0);
  });

  it("refuses to follow yourself and handles repeat follows", async () => {
    expect(await code(c.svc.follow(c.alice, c.alice.profileId))).toBe("cannot_follow_self");
    await c.svc.follow(c.bob, c.alice.profileId);
    await c.svc.follow(c.bob, c.alice.profileId);
    expect((await c.svc.getProfile(c.bob, c.alice.profileId)).followerCount).toBe(1);
    expect((await c.svc.notifications(c.alice, {})).items).toHaveLength(1);
    await c.svc.unfollow(c.bob, c.alice.profileId);
    expect((await c.svc.getProfile(c.bob, c.alice.profileId)).viewerFollows).toBe(false);
  });

  it("hides course and year on anonymous profiles", async () => {
    const view = await c.svc.getProfile(c.bob, c.aliceAnon.profileId);
    expect(view).toMatchObject({ kind: "anonymous", displayName: null, course: null, studyYear: null });
  });
});

describe("HTTP layer", () => {
  function http() {
    const c = setup();
    const actors = new FakeActorResolver();
    actors.register("tok-alice", c.alice, c.aliceAnon);
    actors.register("tok-bob", c.bob);

    const authStore = new MemoryAuthStore();
    const auth = new AuthService(authStore, new CapturingMailer(), {
      codeHmacKey: "k".repeat(40),
      codeTtlMinutes: 10,
      maxCodesPerHour: 5,
      maxCodeAttempts: 3,
      sessionTtlDays: 30,
      termsVersion: "t",
    });
    const app = buildApp({ auth, content: { service: c.svc, actors }, logger: false });
    return { c, app, auth };
  }

  const h = (token: string, extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${token}`,
    ...extra,
  });

  it("requires a session", async () => {
    const { app } = http();
    expect((await app.inject({ method: "GET", url: "/feed" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/feed", headers: h("nope") })).statusCode,
    ).toBe(401);
  });

  it("creates a post and shows it in the feed", async () => {
    const { app } = http();
    const created = await app.inject({
      method: "POST",
      url: "/posts",
      headers: h("tok-alice"),
      payload: { body: "hello over http" },
    });
    expect(created.statusCode).toBe(201);

    const feed = await app.inject({ method: "GET", url: "/feed", headers: h("tok-bob") });
    expect(feed.statusCode).toBe(200);
    expect(feed.json().items[0].body).toBe("hello over http");
  });

  it("acts as the anonymous profile via x-acting-as, with confirmation", async () => {
    const { app } = http();
    const headers = h("tok-alice", { "x-acting-as": "anonymous" });

    const first = await app.inject({ method: "POST", url: "/posts", headers, payload: { body: "a" } });
    expect(first.statusCode).toBe(409);
    expect(first.json().error).toBe("confirmation_required");

    const ok = await app.inject({
      method: "POST",
      url: "/posts",
      headers,
      payload: { body: "a", confirmedAnonymous: true },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().author.kind).toBe("anonymous");
    expect(ok.json().author.displayName).toBeNull();
  });

  it("rejects an unknown acting-as value", async () => {
    const { app } = http();
    const res = await app.inject({
      method: "GET",
      url: "/feed",
      headers: h("tok-alice", { "x-acting-as": "admin" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("validates ids and bodies", async () => {
    const { app } = http();
    expect(
      (await app.inject({ method: "GET", url: "/posts/not-a-uuid", headers: h("tok-bob") }))
        .statusCode,
    ).toBe(400);
    const bad = await app.inject({
      method: "POST",
      url: "/posts",
      headers: h("tok-bob"),
      payload: { body: "x", photoIds: ["nope"] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("uploads an image and serves it back with private caching", async () => {
    const { app } = http();
    const up = await app.inject({
      method: "POST",
      url: "/photos",
      headers: h("tok-alice", { "content-type": "image/jpeg" }),
      payload: await jpeg(),
    });
    expect(up.statusCode).toBe(201);
    const { id } = up.json();

    const post = await app.inject({
      method: "POST",
      url: "/posts",
      headers: h("tok-alice"),
      payload: { body: "", photoIds: [id] },
    });
    expect(post.statusCode).toBe(201);

    const photo = await app.inject({ method: "GET", url: `/photos/${id}`, headers: h("tok-bob") });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers["content-type"]).toBe("image/jpeg");
    expect(photo.headers["cache-control"]).toContain("private");
    expect(photo.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("rejects non-image uploads", async () => {
    const { app } = http();
    const res = await app.inject({
      method: "POST",
      url: "/photos",
      headers: h("tok-alice", { "content-type": "image/png" }),
      payload: Buffer.from("not really a png"),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_image");
  });

  it("refuses anonymous acting through the real resolver until M4", async () => {
    const authStore = new MemoryAuthStore();
    const auth = new AuthService(authStore, new CapturingMailer(), {
      codeHmacKey: "k".repeat(40),
      codeTtlMinutes: 10,
      maxCodesPerHour: 5,
      maxCodeAttempts: 3,
      sessionTtlDays: 30,
      termsVersion: "t",
    });
    const resolver = new AuthActorResolver(auth);
    await expect(resolver.resolve("nope", "anonymous")).rejects.toMatchObject({
      code: "unauthorized",
    });
  });
});

describe("anonymity guard: the content layer never touches accounts", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, "../src/content");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "actor.ts");

  for (const f of files) {
    it(`${f} does not reference accounts, identity or session data`, () => {
      const src = readFileSync(join(dir, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
      expect(src).not.toMatch(/\baccounts?\b/i);
      expect(src).not.toMatch(/\bidentity\b/i);
      expect(src).not.toMatch(/\bsessions?\b/i);
      expect(src).not.toMatch(/anon_blind_index|anonymous_links|known_profile_owner/);
    });
  }

  it("covers every content module", () => {
    expect(files).toEqual(expect.arrayContaining(["pgStore.ts", "service.ts", "store.ts", "photos.ts"]));
  });
});
