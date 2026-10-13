import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function decodeKey(label: string, b64: string): Buffer {
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`${label} must be ${KEY_BYTES} bytes, base64 encoded`);
  }
  return key;
}

export class BlindIndexer {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = decodeKey("LINK_BLIND_INDEX_KEY", base64Key);
  }

  indexFor(profileId: string): Buffer {
    return createHmac("sha256", this.key).update(`anon-profile:${profileId}`).digest();
  }
}

export class LinkCrypto {
  private readonly keys = new Map<number, Buffer>();
  private readonly currentVersion: number;
  readonly blind: BlindIndexer;

  constructor(encryptionKeys: string, blindIndexKey: string) {
    for (const entry of encryptionKeys.split(",").map((e) => e.trim()).filter(Boolean)) {
      const colon = entry.indexOf(":");
      const version = Number(entry.slice(0, colon));
      if (colon <= 0 || !Number.isInteger(version) || version < 1 || version > 255) {
        throw new Error('LINK_ENCRYPTION_KEYS entries must look like "1:<base64 key>"');
      }
      if (this.keys.has(version)) throw new Error(`duplicate link key version ${version}`);
      this.keys.set(version, decodeKey(`LINK_ENCRYPTION_KEYS version ${version}`, entry.slice(colon + 1)));
    }
    if (this.keys.size === 0) throw new Error("LINK_ENCRYPTION_KEYS has no keys");
    this.currentVersion = Math.max(...this.keys.keys());
    this.blind = new BlindIndexer(blindIndexKey);
  }

  get latestKeyVersion(): number {
    return this.currentVersion;
  }

  encrypt(profileId: string, accountId: string): { blob: Buffer; keyVersion: number } {
    const key = this.keys.get(this.currentVersion)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(accountId, "utf8"));
    const body = Buffer.concat([cipher.update(profileId, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      blob: Buffer.concat([Buffer.from([this.currentVersion]), iv, body, tag]),
      keyVersion: this.currentVersion,
    };
  }

  decrypt(blob: Buffer, accountId: string): string {
    if (blob.length < 1 + IV_BYTES + TAG_BYTES + 1) throw new Error("link ciphertext is too short");
    const version = blob[0]!;
    const key = this.keys.get(version);
    if (!key) throw new Error(`no link key for version ${version}`);

    const iv = blob.subarray(1, 1 + IV_BYTES);
    const tag = blob.subarray(blob.length - TAG_BYTES);
    const body = blob.subarray(1 + IV_BYTES, blob.length - TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(accountId, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  }

  blindIndex(profileId: string): Buffer {
    return this.blind.indexFor(profileId);
  }
}
