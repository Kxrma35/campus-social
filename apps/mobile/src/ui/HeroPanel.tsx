import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { HeroSlide } from "@/core/heroSlides";
import { radius, spacing } from "@/theme/tokens";
import { hiddenFromReaders } from "./a11y";
import { IconButton } from "./IconButton";
import { Text } from "./Text";
import { useTheme } from "./theme";

const NOTCH = 64;

/** Original greyscale placeholder art. Not a photograph. */
function PlaceholderArt() {
  const t = useTheme();
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
      viewBox="0 0 400 520"
      preserveAspectRatio="xMidYMid slice"
      {...hiddenFromReaders}
    >
      <Defs>
        <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={t.art.from} />
          <Stop offset="1" stopColor={t.art.to} />
        </LinearGradient>
      </Defs>
      <Rect width="400" height="520" fill="url(#g)" />
      <Circle cx="130" cy="170" r="150" fill={t.art.mist} fillOpacity={0.35} />
      <Circle cx="260" cy="250" r="120" fill={t.art.shade} fillOpacity={0.45} />
      <Circle cx="300" cy="120" r="70" fill={t.art.mist} fillOpacity={0.5} />
      <Rect x="0" y="360" width="400" height="160" fill={t.art.floor} fillOpacity={0.25} />
    </Svg>
  );
}

export function HeroPanel({
  slides,
  height,
  onBack,
  compact = false,
  testID,
}: {
  slides: HeroSlide[];
  height?: number;
  onBack?: () => void;
  compact?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const [index, setIndex] = useState(0);
  const count = slides.length;
  const slide = slides[Math.min(index, Math.max(count - 1, 0))];

  return (
    <View
      testID={testID}
      accessibilityLabel="Placeholder image"
      style={[styles.panel, { backgroundColor: t.border }, height ? { height } : { flex: 1 }]}
    >
      <PlaceholderArt />
      <View style={[styles.tag, { backgroundColor: t.glass }]} pointerEvents="none">
        <Text variant="caption" style={{ color: t.onGlass }}>
          Placeholder image
        </Text>
      </View>

      {onBack ? (
        <View style={[styles.notch, { backgroundColor: t.background }]}>
          <View style={styles.back}>
            <IconButton icon="chevronRight" rotate={180} label="Go back" onPress={onBack} testID="hero-back" />
          </View>
        </View>
      ) : null}

      {slide && !compact ? (
        <View style={[styles.caption, { backgroundColor: Platform.OS === "ios" ? "transparent" : t.glass }]}>
          {Platform.OS === "ios" ? (
            <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: t.glass }]} />
            </BlurView>
          ) : null}
          <View style={styles.captionBody} accessibilityLiveRegion="polite">
            <Text variant="heading" style={{ color: t.onGlass }}>
              {slide.text}
            </Text>
            {slide.support ? (
              <Text variant="small" style={{ color: t.onGlass }}>
                {slide.support}
              </Text>
            ) : null}
            {slide.kind === "quote" ? (
              <Text variant="small" style={{ color: t.onGlass }}>
                {slide.attribution}
              </Text>
            ) : null}
            <Text variant="caption" style={{ color: t.onGlass }}>
              {`${index + 1} of ${count}`}
            </Text>
          </View>
          {count > 1 ? (
            <View style={styles.pager}>
              <IconButton
                tone="glass"
                icon="chevronRight"
                rotate={180}
                label="Previous"
                disabled={index === 0}
                onPress={() => setIndex((i) => Math.max(0, i - 1))}
              />
              <IconButton
                tone="glass"
                icon="chevronRight"
                label="Next"
                disabled={index >= count - 1}
                onPress={() => setIndex((i) => Math.min(count - 1, i + 1))}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: radius.panel, overflow: "hidden", minHeight: 96 },
  tag: {
    position: "absolute",
    right: spacing.md,
    top: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  notch: {
    position: "absolute",
    left: 0,
    top: 0,
    width: NOTCH,
    height: NOTCH,
    borderBottomRightRadius: radius.xl,
  },
  back: { position: "absolute", left: spacing.sm, top: spacing.sm },
  caption: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    borderRadius: radius.xl,
    overflow: "hidden",
    padding: spacing.lg,
    gap: spacing.md,
  },
  captionBody: { gap: spacing.xs },
  pager: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
});
