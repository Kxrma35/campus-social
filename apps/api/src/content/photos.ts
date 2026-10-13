import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { ApiError } from "../errors.js";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_EDGE = 2048;
const ALLOWED_INPUT = new Set(["jpeg", "png", "webp"]);

export interface SanitizedPhoto {
  bytes: Buffer;
  width: number;
  height: number;
  contentType: "image/jpeg";
}

export async function sanitizePhoto(input: Buffer): Promise<SanitizedPhoto> {
  if (input.length === 0) throw new ApiError("invalid_image", 400, "No image was sent.");
  if (input.length > MAX_UPLOAD_BYTES) {
    throw new ApiError("image_too_large", 413, "Images can be at most 8 MB.");
  }

  try {
    const probe = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
    if (!probe.format || !ALLOWED_INPUT.has(probe.format)) {
      throw new ApiError("invalid_image", 415, "Use a JPEG, PNG or WebP image.");
    }

    const { data, info } = await sharp(input, { limitInputPixels: 40_000_000 })
      .rotate() // apply EXIF orientation, then the tag itself is dropped
      .flatten({ background: "#ffffff" })
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return { bytes: data, width: info.width, height: info.height, contentType: "image/jpeg" };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("invalid_image", 400, "That image could not be read.");
  }
}

export interface PhotoStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

export function newPhotoKey(): string {
  return `${randomUUID()}.jpg`;
}

export class LocalPhotoStore implements PhotoStore {
  constructor(private readonly dir: string) {}

  async put(key: string, bytes: Buffer): Promise<void> {
    this.assertKey(key);
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, key), bytes, { flag: "wx" });
  }

  async get(key: string): Promise<Buffer | null> {
    this.assertKey(key);
    try {
      return await readFile(join(this.dir, key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key);
    try {
      await unlink(join(this.dir, key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private assertKey(key: string): void {
    if (!KEY_RE.test(key)) throw new Error("invalid photo key");
  }
}
