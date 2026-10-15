import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type { PostPhoto } from "@/core/api/types";
import { useApi } from "@/core/session/SessionProvider";
import { radius, spacing } from "@/theme/tokens";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { useTheme } from "./theme";

const MIN_RATIO = 0.8;
const MAX_RATIO = 1.6;

export function frameRatio(photos: PostPhoto[]): number {
  const first = photos[0];
  if (!first || !first.width || !first.height) return 1.25;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, first.width / first.height));
}

/**
 * Photos are private: the image needs the session token, so it is fetched with an
 * Authorization header and never from a public URL.
 *
 * Each photo is announced with the author's own description when there is one, and
 * says so plainly when there is not. A photo that cannot load shows a placeholder with
 * the description as visible text and a way to try again.
 */
export function PostPhotos({ photos, describe }: { photos: PostPhoto[]; describe: string }) {
  const api = useApi();
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Record<string, number>>({});
  const [attempt, setAttempt] = useState(0);

  if (photos.length === 0) return null;
  const ratio = frameRatio(photos);
  const height = width > 0 ? Math.round(width / ratio) : 0;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (width <= 0) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(Math.max(0, Math.min(photos.length - 1, i)));
  }

  function renderOne(p: PostPhoto, i: number) {
    const label = p.altText
      ? `Photo ${i + 1} of ${photos.length}: ${p.altText}`
      : `Photo ${i + 1} of ${photos.length}, ${describe}. No description provided.`;
    const bad = failed[p.id] !== undefined;

    if (bad) {
      return (
        <View
          key={p.id}
          accessible
          accessibilityLabel={`Photo ${i + 1} of ${photos.length} could not be loaded. ${p.altText ?? ""}`.trim()}
          style={[styles.frame, { width, height, backgroundColor: t.primarySoft }]}
        >
          <Icon name="image" size={28} color={t.textMuted} />
          <Text variant="label" tone="muted">
            This photo could not be loaded
          </Text>
          {p.altText ? (
            <Text variant="small" tone="muted" style={styles.caption}>
              {p.altText}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Try loading photo ${i + 1} again`}
            onPress={() => {
              setFailed((f) => {
                const { [p.id]: _gone, ...rest } = f;
                return rest;
              });
              setAttempt((a) => a + 1);
            }}
            style={styles.retry}
          >
            <Text variant="label" tone="primary">
              Try again
            </Text>
          </Pressable>
        </View>
      );
    }

    return (
      <Image
        key={`${p.id}:${attempt}`}
        source={api.photoRequest(p.url)}
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        resizeMode="cover"
        onError={() => setFailed((f) => ({ ...f, [p.id]: Date.now() }))}
        style={{ width, height, backgroundColor: t.primarySoft }}
      />
    );
  }

  return (
    <View testID="post-photos" onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} style={styles.wrap}>
      {width > 0 ? (
        photos.length === 1 ? (
          renderOne(photos[0]!, 0)
        ) : (
          <>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={32}
              style={{ width }}
            >
              {photos.map((p, i) => renderOne(p, i))}
            </ScrollView>
            <View style={styles.dots} accessibilityLabel={`Photo ${index + 1} of ${photos.length}`} accessible>
              {photos.map((p, i) => (
                <View
                  key={p.id}
                  style={[
                    styles.dot,
                    { backgroundColor: i === index ? t.primary : t.border, opacity: i === index ? 1 : 0.5 },
                  ]}
                />
              ))}
              <Text variant="small" tone="muted" style={styles.count}>
                {`${index + 1} of ${photos.length}`}
              </Text>
            </View>
          </>
        )
      ) : (
        <View style={{ height: 240, backgroundColor: t.primarySoft }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch" },
  frame: { alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },
  caption: { textAlign: "center" },
  retry: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md },
  dots: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3 },
  count: { marginLeft: spacing.sm },
});
