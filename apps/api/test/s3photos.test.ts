import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { newPhotoKey } from "../src/content/photos.js";
import { S3PhotoStore } from "../src/content/s3PhotoStore.js";
import { createPhotoStore } from "../src/content/storage.js";
import { LocalPhotoStore } from "../src/content/photos.js";

interface Sent {
  type: string;
  input: Record<string, unknown>;
}

function fakeClient(respond?: (s: Sent) => unknown) {
  const sent: Sent[] = [];
  return {
    sent,
    client: {
      async send(cmd: unknown) {
        const c = cmd as { constructor: { name: string }; input: Record<string, unknown> };
        const s = { type: c.constructor.name, input: c.input };
        sent.push(s);
        return respond ? respond(s) : {};
      },
    },
  };
}

const base = { DATABASE_URL: "postgres://x", CODE_HMAC_KEY: "k".repeat(32) };

describe("S3PhotoStore", () => {
  it("writes a private jpeg under the configured prefix", async () => {
    const f = fakeClient();
    const key = newPhotoKey();
    await new S3PhotoStore(f.client, "photos", "campus/").put(key, Buffer.from("abc"));
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.type).toBe("PutObjectCommand");
    expect(f.sent[0]!.input).toMatchObject({
      Bucket: "photos",
      Key: `campus/${key}`,
      ContentType: "image/jpeg",
    });
    expect(f.sent[0]!.input).not.toHaveProperty("ACL");
  });

  it("reads bytes back and answers null for a missing object", async () => {
    const key = newPhotoKey();
    const ok = fakeClient(() => ({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } }));
    expect(await new S3PhotoStore(ok.client, "b").get(key)).toEqual(Buffer.from([1, 2, 3]));

    const missing = fakeClient(() => {
      throw Object.assign(new Error("gone"), { name: "NoSuchKey" });
    });
    expect(await new S3PhotoStore(missing.client, "b").get(key)).toBeNull();

    const notFound = fakeClient(() => {
      throw Object.assign(new Error("gone"), { $metadata: { httpStatusCode: 404 } });
    });
    expect(await new S3PhotoStore(notFound.client, "b").get(key)).toBeNull();
  });

  it("does not hide other failures as a missing photo", async () => {
    const denied = fakeClient(() => {
      throw Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    });
    await expect(new S3PhotoStore(denied.client, "b").get(newPhotoKey())).rejects.toThrow("denied");
  });

  it("deletes by key, and surfaces a failed delete so it is retried", async () => {
    const f = fakeClient();
    const key = newPhotoKey();
    await new S3PhotoStore(f.client, "b", "p/").delete(key);
    expect(f.sent[0]!.type).toBe("DeleteObjectCommand");
    expect(f.sent[0]!.input).toMatchObject({ Bucket: "b", Key: `p/${key}` });

    const failing = fakeClient(() => {
      throw new Error("network down");
    });
    await expect(new S3PhotoStore(failing.client, "b").delete(key)).rejects.toThrow("network down");
  });

  it("refuses a key that is not one of ours before any request is made", async () => {
    const f = fakeClient();
    const s = new S3PhotoStore(f.client, "b");
    for (const bad of ["../etc/passwd", "a.jpg", "", `${newPhotoKey()}/x`, "campus/" + newPhotoKey()]) {
      await expect(s.get(bad)).rejects.toThrow("invalid photo key");
      await expect(s.put(bad, Buffer.from("x"))).rejects.toThrow("invalid photo key");
      await expect(s.delete(bad)).rejects.toThrow("invalid photo key");
    }
    expect(f.sent).toHaveLength(0);
  });
});

describe("photo storage settings", () => {
  it("uses the local directory unless S3 is asked for", () => {
    expect(createPhotoStore(loadConfig(base))).toBeInstanceOf(LocalPhotoStore);
  });

  it("builds an S3 store from a complete setting", () => {
    const c = loadConfig({
      ...base,
      PHOTO_STORAGE: "s3",
      S3_BUCKET: "b",
      S3_REGION: "eu-west-1",
      S3_ACCESS_KEY_ID: "id",
      S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(createPhotoStore(c)).toBeInstanceOf(S3PhotoStore);
  });

  it("refuses an incomplete S3 setting", () => {
    expect(() => createPhotoStore(loadConfig({ ...base, PHOTO_STORAGE: "s3" }))).toThrow(/S3_BUCKET and S3_REGION/);
    expect(() =>
      createPhotoStore(
        loadConfig({ ...base, PHOTO_STORAGE: "s3", S3_BUCKET: "b", S3_REGION: "r", S3_ACCESS_KEY_ID: "id" }),
      ),
    ).toThrow(/set together/);
  });

  it("rejects an unknown storage type and a key prefix without a trailing slash", () => {
    expect(() => loadConfig({ ...base, PHOTO_STORAGE: "ftp" })).toThrow();
    expect(() => loadConfig({ ...base, S3_KEY_PREFIX: "campus" })).toThrow();
    expect(loadConfig({ ...base, S3_KEY_PREFIX: "campus/prod/" }).S3_KEY_PREFIX).toBe("campus/prod/");
  });
});
