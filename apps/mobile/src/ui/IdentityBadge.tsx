import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { ProfileKind } from "@/core/api/types";
import { radius, spacing } from "@/theme/tokens";
import { hiddenFromReaders } from "./a11y";
import { Text } from "./Text";
import { useTheme } from "./theme";

const LABEL: Record<ProfileKind, string> = {
  known: "Your profile",
  anonymous: "Anonymous profile",
};

/** Always text plus an icon with its own shape, never colour alone. */
export function IdentityBadge({
  kind,
  label,
  accessibilityLabel,
}: {
  kind: ProfileKind;
  label?: string;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const anon = kind === "anonymous";
  const ink = anon ? t.identity.anon : t.identity.known;
  const text = label ?? LABEL[kind];
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? text}
      style={[styles.badge, { borderColor: ink, backgroundColor: anon ? t.anonymousSoft : t.primarySoft }]}
    >
      <Svg width={16} height={16} viewBox="0 0 24 24" {...hiddenFromReaders}>
        {anon ? (
          <>
            <Circle cx="9" cy="12" r="5.5" fill="none" stroke={ink} strokeWidth={2} />
            <Circle cx="15" cy="12" r="5.5" fill="none" stroke={ink} strokeWidth={2} />
          </>
        ) : (
          <Circle cx="12" cy="12" r="7" fill={ink} />
        )}
      </Svg>
      <Text variant="small" style={{ color: ink }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    minHeight: 28,
  },
});
