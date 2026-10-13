import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  runLifecycleSweep,
  type SweepOptions,
} from "../src/account/lifecycleStore.js";
import { AccountService } from "../src/account/service.js";
import { AuthService } from "../src/auth/service.js";
import { LocalPhotoStore, newPhotoKey } from "../src/content/photos.js";
import { ContentService, DEFAULT_CONTENT_OPTIONS } from "../src/content/service.js";
import {
  CapturingMailer,
  MemoryAuthStore,
  MemoryLifecycleStore,
} from "./helpers/memoryStore.js";
import {
  MemoryContentStore,
  MemoryPhotoStore,
} from "./helpers/memoryContent.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SWEEP: SweepOptions = { reverifyGraceDays: 30, purgeAfterDays: 30 };
const EMAIL = "jane@test.ac.ke";

interface World {
  db: MemoryAuthStore;
  mailer: CapturingMailer;
  auth: AuthService;
  lifecycle: MemoryLifecycleStore;
  account: AccountService;
  photos: MemoryPhotoStore;
  clock: { now: Date };
  token: string;
  accountId: string;
  profileId: string;
}

async function world(): Promise<World> {
  const db = new MemoryAuthStore();
  db.universities.push({ id: "u1", name: "Test U", emailDomain: "test.ac.ke", active: true });
  const mailer = new CapturingMailer();
  const clock = { now: new Date("2026-10-12T10:00:00Z") };
  const auth = new AuthService(
    db,
    mailer,
    {
      codeHmacKey: "k".repeat(40),
      codeTtlMinutes: 10,
      maxCodesPerHour: 50,
      maxCodeAttempts: 3,
      sessionTtlDays: 400,
      termsVersion: "t",
    },
    () => clock.now,
  );
  const lifecycle = new MemoryLifecycleStore(db);
  const account = new AccountService(auth, db, lifecycle, () => clock.now);

  await auth.requestSignup(EMAIL);
  const s = await auth.verifySignup({
    email: EMAIL,
    code: mailer.lastCode(EMAIL),
    dateOfBirth: "2004-05-01",
    displayName: "Jane Doe",
  });
  return {
    db,
    mailer,
    auth,
    lifecycle,
    account,
    photos: new MemoryPhotoStore(),
    clock,
    token: s.sessionToken,
    accountId: s.account.id,
    profileId: s.profile.id,
  };
}

const advance = (w: World, ms: number) => {
  w.clock.now = new Date(w.clock.now.getTime() + ms);
};
const sweep = (w: World, withPhotos = true) =>
  runLifecycleSweep(w.lifecycle, SWEEP, w.clock.now, withPhotos ? w.photos : undefined);

async function postWithPhotos(w: World, body: string, n: number) {
  const post = w.db.addPostAs(w.profileId, body);
  post.photoKeys = [];
  for (let i = 0; i < n; i += 1) {
    const key = newPhotoKey();
    await w.photos.put(key, Buffer.from(`image-${i}`));
    w.db.uploads.push({ key, profileId: w.profileId, createdAt: w.clock.now, attached: true });
    post.photoKeys.push(key);
  }
  return post;
}

describe("purging content the author deleted (G2)", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  it("keeps a deleted post until the retention period has passed", async () => {
    const post = w.db.addPostAs(w.profileId, "oops");
    post.deletedAt = w.clock.now;

    advance(w, 29 * DAY);
    const early = await sweep(w);
    expect(early.purgedPosts).toBe(0);
    expect(w.db.posts).toHaveLength(1);

    advance(w, 2 * DAY);
    const later = await sweep(w);
    expect(later.purgedPosts).toBe(1);
    expect(w.db.posts).toHaveLength(0);
  });

  it("never touches posts that were not deleted", async () => {
    w.db.addPostAs(w.profileId, "keep me");
    advance(w, 45 * DAY);
    const r = await sweep(w);
    expect(r.purgedPosts).toBe(0);
    expect(w.db.posts).toHaveLength(1);
  });

  it("does not purge content that is only hidden by moderation", async () => {
    const post = w.db.addPostAs(w.profileId, "hidden, not deleted");
    post.hidden = true;
    post.hiddenReason = "moderator";
    advance(w, 45 * DAY);
    expect((await sweep(w)).purgedPosts).toBe(0);
    expect(w.db.posts).toHaveLength(1);
  });

  it("keeps deleted content while a report on it is unresolved", async () => {
    const post = w.db.addPostAs(w.profileId, "reported then deleted");
    post.deletedAt = w.clock.now;
    w.db.openReportTargets.add(`post:${post.id}`);

    advance(w, 60 * DAY);
    expect((await sweep(w)).purgedPosts).toBe(0);
    expect(w.db.posts).toHaveLength(1);

    w.db.openReportTargets.clear();
    expect((await sweep(w)).purgedPosts).toBe(1);
  });

  it("purges deleted comments, and comments go with a purged post", async () => {
    const post = w.db.addPostAs(w.profileId, "thread");
    w.db.comments.push({ id: randomUUID(), postId: post.id, profileId: w.profileId, deletedAt: w.clock.now });
    w.db.comments.push({ id: randomUUID(), postId: post.id, profileId: w.profileId, deletedAt: null });

    advance(w, 31 * DAY);
    const r = await sweep(w);
    expect(r.purgedComments).toBe(1);
    expect(w.db.comments).toHaveLength(1);

    post.deletedAt = w.clock.now;
    advance(w, 31 * DAY);
    await sweep(w);
    expect(w.db.comments).toHaveLength(0);
  });

  it("is idempotent", async () => {
    const post = w.db.addPostAs(w.profileId, "x");
    post.deletedAt = w.clock.now;
    advance(w, 31 * DAY);
    await sweep(w);
    const again = await sweep(w);
    expect(again.purgedPosts).toBe(0);
    expect(again.filesDeleted).toBe(0);
  });
});

describe("deleting photo files (G1)", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  it("removes a purged post's files from storage in the same sweep", async () => {
    const post = await postWithPhotos(w, "with pictures", 3);
    const keys = [...post.photoKeys!];
    post.deletedAt = w.clock.now;
    expect(w.photos.files.size).toBe(3);

    advance(w, 31 * DAY);
    const r = await sweep(w);

    expect(r.filesDeleted).toBe(3);
    expect(w.photos.files.size).toBe(0);
    for (const k of keys) expect(await w.photos.get(k)).toBeNull();
    expect(w.db.uploads).toHaveLength(0);
    expect(w.db.storageDeletions).toHaveLength(0);
  });

  it("leaves other posts' files alone", async () => {
    const gone = await postWithPhotos(w, "deleted", 1);
    const kept = await postWithPhotos(w, "kept", 2);
    gone.deletedAt = w.clock.now;

    advance(w, 31 * DAY);
    await sweep(w);

    expect(w.photos.files.size).toBe(2);
    for (const k of kept.photoKeys!) expect(await w.photos.get(k)).not.toBeNull();
  });

  it("removes every file when an account is purged", async () => {
    await postWithPhotos(w, "one", 2);
    await postWithPhotos(w, "two", 1);
    const orphanKey = newPhotoKey();
    await w.photos.put(orphanKey, Buffer.from("unattached"));
    w.db.uploads.push({ key: orphanKey, profileId: w.profileId, createdAt: w.clock.now, attached: false });

    await w.account.requestClose(w.token);
    await w.account.confirmClose(w.token, w.mailer.lastCode(EMAIL));
    advance(w, 31 * DAY);
    const r = await sweep(w);

    expect(r.purged).toBe(1);
    expect(w.photos.files.size).toBe(0);
    expect(w.db.uploads).toHaveLength(0);
    expect(w.db.storageDeletions).toHaveLength(0);
  });

  it("retries a file that could not be deleted instead of forgetting it", async () => {
    const post = await postWithPhotos(w, "two files", 2);
    const [first, second] = post.photoKeys!;
    post.deletedAt = w.clock.now;
    w.photos.failDelete.add(second!);

    advance(w, 31 * DAY);
    const r1 = await sweep(w);
    expect(r1.filesDeleted).toBe(1);
    expect(r1.filesFailed).toBe(1);
    expect(r1.filesPending).toBe(1);
    expect(await w.photos.get(first!)).toBeNull();
    expect(await w.photos.get(second!)).not.toBeNull();
    expect(w.db.posts).toHaveLength(0);
    expect(w.db.storageDeletions).toEqual([second]);

    w.photos.failDelete.clear();
    const r2 = await sweep(w);
    expect(r2.filesDeleted).toBe(1);
    expect(r2.filesFailed).toBe(0);
    expect(r2.filesPending).toBe(0);
    expect(await w.photos.get(second!)).toBeNull();
  });

  it("reports pending files, and loses none, when no photo store is supplied", async () => {
    const post = await postWithPhotos(w, "x", 2);
    post.deletedAt = w.clock.now;
    advance(w, 31 * DAY);

    const blind = await sweep(w, false);
    expect(blind.filesPending).toBe(2);
    expect(blind.filesDeleted).toBe(0);
    expect(w.photos.files.size).toBe(2);

    const proper = await sweep(w, true);
    expect(proper.filesDeleted).toBe(2);
    expect(w.photos.files.size).toBe(0);
  });

  it("does not queue a file twice", async () => {
    const post = await postWithPhotos(w, "x", 1);
    post.deletedAt = w.clock.now;
    advance(w, 31 * DAY);
    await sweep(w, false);
    await sweep(w, false);
    expect(w.db.storageDeletions).toHaveLength(1);
  });
});

describe("cleaning records that have outlived their purpose (G3)", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  it("deletes one-time codes older than a day and keeps recent ones", async () => {
    await w.auth.requestLogin(EMAIL);
    const fresh = w.db.codes.length;
    expect(fresh).toBeGreaterThanOrEqual(2);

    advance(w, 2 * HOUR);
    const r1 = await sweep(w);
    expect(r1.expiredCodes).toBe(0);

    advance(w, 23 * HOUR);
    const r2 = await sweep(w);
    expect(r2.expiredCodes).toBe(fresh);
    expect(w.db.codes).toHaveLength(0);
  });

  it("forgets the email of someone who started sign-up and never finished", async () => {
    await w.auth.requestSignup("never-finished@test.ac.ke");
    expect(w.db.codes.some((c) => c.email === "never-finished@test.ac.ke")).toBe(true);

    advance(w, 25 * HOUR);
    await sweep(w);
    expect(w.db.codes.some((c) => c.email === "never-finished@test.ac.ke")).toBe(false);
    expect([...w.db.accounts.values()].some((a) => a.email === "never-finished@test.ac.ke")).toBe(false);
  });

  it("deletes sessions a week after they expire or are revoked, never live ones", async () => {
    await w.auth.requestLogin(EMAIL);
    const login = await w.auth.verifyLogin(EMAIL, w.mailer.lastCode(EMAIL));
    await w.auth.logout(login.sessionToken);

    advance(w, 6 * DAY);
    expect((await sweep(w)).expiredSessions).toBe(0);

    advance(w, 2 * DAY);
    const r = await sweep(w);
    expect(r.expiredSessions).toBe(1);

    await expect(w.auth.authenticate(w.token)).resolves.toMatchObject({ accountId: w.accountId });
  });

  it("deletes unattached uploads and their files after a day, never attached ones", async () => {
    const staleKey = newPhotoKey();
    const freshKey = newPhotoKey();
    await w.photos.put(staleKey, Buffer.from("stale"));
    await w.photos.put(freshKey, Buffer.from("fresh"));
    w.db.uploads.push({ key: staleKey, profileId: w.profileId, createdAt: w.clock.now, attached: false });
    const attached = await postWithPhotos(w, "attached", 1);

    advance(w, 23 * HOUR);
    w.db.uploads.push({ key: freshKey, profileId: w.profileId, createdAt: w.clock.now, attached: false });
    advance(w, 2 * HOUR);

    const r = await sweep(w);
    expect(r.staleUploads).toBe(1);
    expect(await w.photos.get(staleKey)).toBeNull();
    expect(await w.photos.get(freshKey)).not.toBeNull();
    expect(await w.photos.get(attached.photoKeys![0]!)).not.toBeNull();
  });
});

describe("an upload whose database row fails to save", () => {
  it("does not leave the file behind", async () => {
    const store = new MemoryContentStore();
    const photos = new MemoryPhotoStore();
    const svc = new ContentService(store, photos, DEFAULT_CONTENT_OPTIONS);
    const actor = {
      profileId: store.addProfile({ handle: "alice" }),
      kind: "known" as const,
      canWrite: true,
    };
    store.createPhotoUpload = async () => {
      throw new Error("database unavailable");
    };

    const sharp = (await import("sharp")).default;
    const img = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } })
      .jpeg()
      .toBuffer();

    await expect(svc.uploadPhoto(actor, img)).rejects.toThrow("database unavailable");
    expect(photos.files.size).toBe(0);
  });
});

describe("LocalPhotoStore.delete", () => {
  let dir: string;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("removes the file from disk", async () => {
    dir = await mkdtemp(join(tmpdir(), "photos-del-"));
    const store = new LocalPhotoStore(dir);
    const a = newPhotoKey();
    const b = newPhotoKey();
    await store.put(a, Buffer.from("a"));
    await store.put(b, Buffer.from("b"));

    await store.delete(a);

    expect(await store.get(a)).toBeNull();
    expect((await store.get(b))?.toString()).toBe("b");
    expect(await readdir(dir)).toEqual([b]);
  });

  it("is safe to repeat and safe for a file that never existed", async () => {
    dir ??= await mkdtemp(join(tmpdir(), "photos-del-"));
    const store = new LocalPhotoStore(dir);
    const key = newPhotoKey();
    await expect(store.delete(key)).resolves.toBeUndefined();
    await store.put(key, Buffer.from("x"));
    await store.delete(key);
    await expect(store.delete(key)).resolves.toBeUndefined();
  });

  it("refuses path traversal and arbitrary names", async () => {
    dir ??= await mkdtemp(join(tmpdir(), "photos-del-"));
    const store = new LocalPhotoStore(dir);
    for (const bad of ["../escape.jpg", "/etc/passwd", "a.jpg", "", "..", "x/../../y.jpg"]) {
      await expect(store.delete(bad)).rejects.toThrow("invalid photo key");
    }
  });
});

describe("moderation record retention is passed through from the sweep", () => {
  it("uses the agreed starting values when nothing is configured", async () => {
    const w = await world();
    const r = await runLifecycleSweep(w.lifecycle, SWEEP, w.clock.now, w.photos);

    expect(w.lifecycle.moderationPurgeCalls).toHaveLength(1);
    expect(w.lifecycle.moderationPurgeCalls[0]).toEqual({
      now: w.clock.now,
      dismissedReportDays: 90,
      resolvedRecordDays: 365,
      appealRecordDays: 365,
      warningMonths: 12,
      auditLogYears: 3,
    });
    expect(r).toMatchObject({
      warningsExpired: 0,
      reportsPurged: 0,
      actionsPurged: 0,
      penaltiesPurged: 0,
      appealsScrubbed: 0,
      auditRowsPurged: 0,
    });
  });

  it("passes configured values through unchanged", async () => {
    const w = await world();
    await runLifecycleSweep(
      w.lifecycle,
      {
        ...SWEEP,
        dismissedReportDays: 60,
        resolvedRecordDays: 730,
        appealRecordDays: 400,
        warningMonths: 6,
        auditLogYears: 5,
      },
      w.clock.now,
      w.photos,
    );
    expect(w.lifecycle.moderationPurgeCalls[0]).toMatchObject({
      dismissedReportDays: 60,
      resolvedRecordDays: 730,
      appealRecordDays: 400,
      warningMonths: 6,
      auditLogYears: 5,
    });
  });
});
