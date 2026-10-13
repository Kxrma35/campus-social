import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import {
  LocalPhotoStore,
  MAX_UPLOAD_BYTES,
  newPhotoKey,
  sanitizePhoto,
} from "../src/content/photos.js";

async function jpegWithMetadata(width = 400, height = 300): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .withExif({
      IFD0: { Copyright: "secret-owner", Artist: "someone@example.com", Make: "PhoneCo" },
      IFD3: {
        GPSLatitudeRef: "S",
        GPSLatitude: "1/1 17/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "36/1 49/1 0/1",
      },
    })
    .jpeg()
    .toBuffer();
}

describe("sanitizePhoto", () => {
  it("fixture really carries EXIF and GPS data before sanitising", async () => {
    const meta = await sharp(await jpegWithMetadata()).metadata();
    expect(meta.exif).toBeDefined();
    expect(meta.exif?.toString("latin1")).toContain("secret-owner");
  });

  it("removes EXIF, GPS and other metadata from the output", async () => {
    const out = await sanitizePhoto(await jpegWithMetadata());
    const meta = await sharp(out.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.icc).toBeUndefined();

    const raw = out.bytes.toString("latin1");
    expect(raw).not.toContain("secret-owner");
    expect(raw).not.toContain("someone@example.com");
    expect(raw).not.toContain("PhoneCo");
    expect(raw).not.toContain("GPS");
  });

  it("outputs JPEG with the reported dimensions", async () => {
    const out = await sanitizePhoto(await jpegWithMetadata(400, 300));
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(out.contentType).toBe("image/jpeg");
    expect([out.width, out.height]).toEqual([meta.width, meta.height]);
  });

  it("downsizes very large images", async () => {
    const big = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: "#336699" },
    })
      .jpeg()
      .toBuffer();
    const out = await sanitizePhoto(big);
    expect(Math.max(out.width, out.height)).toBe(2048);
  });

  it("accepts PNG and WebP and converts them", async () => {
    const png = await sharp({
      create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } },
    })
      .png()
      .toBuffer();
    const webp = await sharp({
      create: { width: 50, height: 50, channels: 3, background: "#fff" },
    })
      .webp()
      .toBuffer();
    expect((await sharp((await sanitizePhoto(png)).bytes).metadata()).format).toBe("jpeg");
    expect((await sharp((await sanitizePhoto(webp)).bytes).metadata()).format).toBe("jpeg");
  });

  it("rejects things that are not images", async () => {
    await expect(sanitizePhoto(Buffer.from("<script>alert(1)</script>"))).rejects.toMatchObject({
      code: "invalid_image",
    });
    await expect(sanitizePhoto(Buffer.alloc(0))).rejects.toMatchObject({ code: "invalid_image" });
  });

  it("rejects image formats outside the allowlist (GIF, SVG)", async () => {
    const gif = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#000" },
    })
      .gif()
      .toBuffer();
    await expect(sanitizePhoto(gif)).rejects.toMatchObject({ code: "invalid_image" });

    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    await expect(sanitizePhoto(svg)).rejects.toMatchObject({ code: "invalid_image" });
  });

  it("rejects oversized uploads", async () => {
    await expect(sanitizePhoto(Buffer.alloc(MAX_UPLOAD_BYTES + 1))).rejects.toMatchObject({
      code: "image_too_large",
    });
  });
});

describe("LocalPhotoStore", () => {
  let dir: string | undefined;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("stores and returns bytes by generated key", async () => {
    dir = await mkdtemp(join(tmpdir(), "photos-"));
    const store = new LocalPhotoStore(dir);
    const key = newPhotoKey();
    await store.put(key, Buffer.from("abc"));
    expect((await store.get(key))?.toString()).toBe("abc");
    expect(await store.get(newPhotoKey())).toBeNull();
  });

  it("refuses path traversal and arbitrary names", async () => {
    dir ??= await mkdtemp(join(tmpdir(), "photos-"));
    const store = new LocalPhotoStore(dir);
    for (const bad of ["../etc/passwd", "a.jpg", "../../x.jpg", "/abs/path.jpg", ""]) {
      await expect(store.get(bad)).rejects.toThrow("invalid photo key");
      await expect(store.put(bad, Buffer.from("x"))).rejects.toThrow("invalid photo key");
    }
  });

  it("never overwrites an existing file", async () => {
    dir ??= await mkdtemp(join(tmpdir(), "photos-"));
    const store = new LocalPhotoStore(dir);
    const key = newPhotoKey();
    await store.put(key, Buffer.from("one"));
    await expect(store.put(key, Buffer.from("two"))).rejects.toThrow();
    expect((await store.get(key))?.toString()).toBe("one");
  });
});
