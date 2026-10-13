import * as ImagePicker from "expo-image-picker";
import type { ApiClient } from "@/core/api/client";
import type { ProfileKind } from "@/core/api/types";

export interface PickedPhoto {
  /** Local file, for the preview only. */
  localUri: string;
  /** Id on the server once uploaded. */
  uploadId: string;
  width: number;
  height: number;
}

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function pickAndUpload(
  api: ApiClient,
  acting: ProfileKind,
  remaining: number,
): Promise<PickedPhoto[]> {
  if (remaining <= 0) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images",
    allowsMultipleSelection: remaining > 1,
    selectionLimit: remaining,
    quality: 0.85,
    exif: false,
  });
  if (result.canceled || !result.assets) return [];

  const out: PickedPhoto[] = [];
  for (const asset of result.assets.slice(0, remaining)) {
    const type = (asset.mimeType ?? "image/jpeg").toLowerCase();
    if (!ALLOWED.has(type)) throw new Error("unsupported_image_type");
    const blob = await (await fetch(asset.uri)).blob();
    const uploaded = await api.uploadPhoto(blob, type, acting);
    out.push({
      localUri: asset.uri,
      uploadId: uploaded.id,
      width: uploaded.width,
      height: uploaded.height,
    });
  }
  return out;
}
