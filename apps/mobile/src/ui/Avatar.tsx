import { Platform, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { ProfileKind } from "@/core/api/types";
import { Text } from "./Text";
import { useTheme } from "./theme";

export type AvatarSize = "sm" | "md" | "lg" | "xl";
const PX: Record<AvatarSize, number> = { sm: 28, md: 40, lg: 56, xl: 80 };

export function initialOf(name: string | null | undefined): string {
  const t = (name ?? "").replace(/^@/, "").trim();
  return t ? t.charAt(0).toUpperCase() : "?";
}

const hiddenFromReaders =
  Platform.OS === "web"
    ? ({ "aria-hidden": true } as object)
    : { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };

export function Avatar({
  kind,
  name,
  size = "md",
  ringed = false,
}: {
  kind: ProfileKind;
  name?: string | null;
  size?: AvatarSize;
  ringed?: boolean;
}) {
  const t = useTheme();
  const px = PX[size];
  const anon = kind === "anonymous";
  const ink = anon ? t.anonymous : t.known;

  return (
    <View
      {...hiddenFromReaders}
      style={[
        styles.disc,
        { width: px, height: px, borderRadius: Math.round(px * 0.32), backgroundColor: anon ? t.anonymousSoft : t.primarySoft },
        ringed ? { borderWidth: 3, borderColor: ink } : null,
      ]}
    >
      {anon ? (
        <Svg width={px * 0.62} height={px * 0.62} viewBox="0 0 24 24">
          <Circle cx="9" cy="12" r="5.5" fill="none" stroke={ink} strokeWidth={1.8} />
          <Circle cx="15" cy="12" r="5.5" fill="none" stroke={ink} strokeWidth={1.8} />
        </Svg>
      ) : (
        <Text
          style={{
            color: ink,
            fontSize: Math.round(px * 0.42),
            lineHeight: Math.round(px * 0.5),
            fontWeight: "700",
          }}
        >
          {initialOf(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { alignItems: "center", justifyContent: "center" },
});
