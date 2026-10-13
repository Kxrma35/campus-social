import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { assertPhotoKey, type PhotoStore } from "./photos.js";

export interface S3Sender {
  send(command: unknown): Promise<unknown>;
}

export interface S3Settings {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  keyPrefix?: string;
}

export class S3PhotoStore implements PhotoStore {
  constructor(
    private readonly client: S3Sender,
    private readonly bucket: string,
    private readonly keyPrefix = "",
  ) {}

  static fromSettings(s: S3Settings): S3PhotoStore {
    const client = new S3Client({
      region: s.region,
      endpoint: s.endpoint,
      forcePathStyle: s.forcePathStyle ?? false,
      credentials:
        s.accessKeyId && s.secretAccessKey
          ? { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey }
          : undefined,
    });
    return new S3PhotoStore(client, s.bucket, s.keyPrefix ?? "");
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    assertPhotoKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: bytes,
        ContentType: "image/jpeg",
        CacheControl: "private, max-age=300",
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    assertPhotoKey(key);
    try {
      const res = (await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    assertPhotoKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    );
  }

  private objectKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.Code === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}
