import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function shareJson(name: string, data: unknown): Promise<"shared" | "unavailable"> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data, null, 2));

  if (!(await Sharing.isAvailableAsync())) return "unavailable";
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    dialogTitle: "Your Moku data",
    UTI: "public.json",
  });
  return "shared";
}
