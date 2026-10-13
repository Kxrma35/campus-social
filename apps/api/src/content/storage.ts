import type { Config } from "../config.js";
import { LocalPhotoStore, type PhotoStore } from "./photos.js";
import { S3PhotoStore } from "./s3PhotoStore.js";

export function createPhotoStore(config: Config): PhotoStore {
  if (config.PHOTO_STORAGE === "local") return new LocalPhotoStore(config.PHOTO_DIR);

  const { S3_BUCKET, S3_REGION } = config;
  if (!S3_BUCKET || !S3_REGION) {
    throw new Error("PHOTO_STORAGE=s3 requires S3_BUCKET and S3_REGION");
  }
  if (Boolean(config.S3_ACCESS_KEY_ID) !== Boolean(config.S3_SECRET_ACCESS_KEY)) {
    throw new Error("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together");
  }
  return S3PhotoStore.fromSettings({
    bucket: S3_BUCKET,
    region: S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    keyPrefix: config.S3_KEY_PREFIX,
  });
}

export function createPhotoStoreOrExit(config: Config): PhotoStore {
  try {
    return createPhotoStore(config);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
