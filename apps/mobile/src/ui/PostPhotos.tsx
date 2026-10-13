import { Image, StyleSheet, View } from "react-native";
import type { PostPhoto } from "@/core/api/types";
import { useApi } from "@/core/session/SessionProvider";
import { radius, spacing } from "@/theme/tokens";
import { useTheme } from "./theme";

export function PostPhotos({ photos, describe }: { photos: PostPhoto[]; describe: string }) {
  const api = useApi();
  const t = useTheme();
  if (photos.length === 0) return null;
  const single = photos.length === 1;

  return (
    <View style={styles.grid}>
      {photos.map((p, i) => (
        <Image
          key={p.id}
          source={api.photoRequest(p.url)}
          accessible
          accessibilityRole="image"
          accessibilityLabel={
            p.altText
              ? `Photo ${i + 1} of ${photos.length}: ${p.altText}`
              : `Photo ${i + 1} of ${photos.length}, ${describe}. No description provided.`
          }
          resizeMode="cover"
          style={[
            styles.image,
            single ? styles.single : styles.multi,
            { backgroundColor: t.surface },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  image: { borderRadius: radius.md },
  single: { width: "100%", aspectRatio: 4 / 3 },
  multi: { width: "49%", aspectRatio: 1 },
});
