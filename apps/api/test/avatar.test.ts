import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { ContentService, DEFAULT_CONTENT_OPTIONS } from "../src/content/service.js";
import type { Actor } from "../src/content/types.js";
import { MemoryContentStore, MemoryPhotoStore } from "./helpers/memoryContent.js";

const actor = (profileId: string, kind: "known" | "anonymous" = "known", canWrite = true): Actor => ({
  profileId,
  kind,
  canWrite,
});

interface Ctx {
  store: MemoryContentStore;
  svc: ContentService;
  alice: Actor;
  aliceAnon: Actor;
  bob: Actor;
  carl: Actor;
}

function setup(): Ctx {
  const store = new MemoryContentStore();
  const photos = new MemoryPhotoStore();
  const svc = new ContentService(store, photos, DEFAULT_CONTENT_OPTIONS, () => new Date("2026-10-12T10:00:00Z"));
  const alice = actor(store.addProfile({ handle: "alice", displayName: "Alice A" }));
  const aliceAnon = actor(store.addProfile({ kind: "anonymous", handle: "quiet_fox_42" }), "anonymous");
  const bob = actor(store.addProfile({ handle: "bob", displayName: "Bob B" }));
  const carl = actor(store.addProfile({ handle: "carl", displayName: "Carl C", universityId: "u2" }));
  return { store, svc, alice, aliceAnon, bob, carl };
}

const jpeg = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: "#4488cc" } }).jpeg().toBuffer();

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}

describe("profile photo", () => {
  let c: Ctx;
  beforeEach(() => {
    c = setup();
  });

  it("sets a photo that same-campus students can read, and shows hasAvatar", async () => {
    const up = await c.svc.uploadPhoto(c.alice, await jpeg());
    await c.svc.setAvatar(c.alice, up.id);

    const profile = await c.svc.getProfile(c.bob, c.alice.profileId);
    expect(profile.hasAvatar).toBe(true);
    const bytes = await c.svc.readAvatar(c.bob, c.alice.profileId);
    expect(bytes.length).toBeGreaterThan(100);
  });

  it("shows hasAvatar on a post author", async () => {
    const up = await c.svc.uploadPhoto(c.alice, await jpeg());
    await c.svc.setAvatar(c.alice, up.id);
    const post = await c.svc.createPost(c.alice, { body: "hello" });
    expect(post.author.hasAvatar).toBe(true);
  });

  it("does not serve it to another campus", async () => {
    const up = await c.svc.uploadPhoto(c.alice, await jpeg());
    await c.svc.setAvatar(c.alice, up.id);
    expect(await code(c.svc.readAvatar(c.carl, c.alice.profileId))).toBe("not_found");
  });

  it("never lets an anonymous profile have a photo", async () => {
    const up = await c.svc.uploadPhoto(c.aliceAnon, await jpeg());
    expect(await code(c.svc.setAvatar(c.aliceAnon, up.id))).toBe("avatar_known_only");
    expect(await code(c.svc.removeAvatar(c.aliceAnon))).toBe("avatar_known_only");
    const view = await c.svc.getProfile(c.bob, c.aliceAnon.profileId);
    expect(view.hasAvatar).toBe(false);
    expect(await code(c.svc.readAvatar(c.bob, c.aliceAnon.profileId))).toBe("not_found");
  });

  it("rejects a photo that is someone else's or already used", async () => {
    const theirs = await c.svc.uploadPhoto(c.bob, await jpeg());
    expect(await code(c.svc.setAvatar(c.alice, theirs.id))).toBe("photo_invalid");

    const mine = await c.svc.uploadPhoto(c.alice, await jpeg());
    await c.svc.setAvatar(c.alice, mine.id);
    expect(await code(c.svc.setAvatar(c.alice, mine.id))).toBe("photo_invalid");
  });

  it("replaces a photo and releases the old upload for cleanup", async () => {
    const first = await c.svc.uploadPhoto(c.alice, await jpeg());
    await c.svc.setAvatar(c.alice, first.id);
    const second = await c.svc.uploadPhoto(c.alice, await jpeg());
    await c.svc.setAvatar(c.alice, second.id);

    expect(c.store.uploads.get(first.id)!.attached).toBe(false);
    expect(c.store.uploads.get(second.id)!.attached).toBe(true);
  });

  it("removes a photo", async () => {
    const up = await c.svc.uploadPhoto(c.alice, await jpeg());
    await c.svc.setAvatar(c.alice, up.id);
    await c.svc.removeAvatar(c.alice);

    expect((await c.svc.getProfile(c.bob, c.alice.profileId)).hasAvatar).toBe(false);
    expect(await code(c.svc.readAvatar(c.bob, c.alice.profileId))).toBe("not_found");
    expect(c.store.uploads.get(up.id)!.attached).toBe(false);
  });

  it("refuses a read-only account", async () => {
    const up = await c.svc.uploadPhoto(c.alice, await jpeg());
    const readOnly = actor(c.alice.profileId, "known", false);
    expect(await code(c.svc.setAvatar(readOnly, up.id))).toBe("read_only");
  });
});
