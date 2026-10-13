import { StyleSheet, View } from "react-native";
import { radius, spacing } from "@/theme/tokens";
import type { ProfileKind } from "@/core/api/types";
import { Text } from "./Text";
import { useTheme } from "./theme";

export function ProfileChip({
  kind,
  self = false,
  prefix,
}: {
  kind: ProfileKind;
  /** True when this is the viewer's own profile ("You"). */
  self?: boolean;
  /** For example "Posting as". */
  prefix?: string;
}) {
  const t = useTheme();
  const anonymous = kind === "anonymous";
  const word = anonymous ? "Anonymous" : self ? "You" : "Student";
  const text = prefix ? `${prefix} ${word.toLowerCase()}` : word;
  return (
    <View
      accessible
      accessibilityLabel={`${prefix ? prefix + " " : ""}${anonymous ? "anonymous profile" : self ? "your known profile" : "known profile"}`}
      style={[styles.chip, { backgroundColor: anonymous ? t.anonymous : t.known }]}
    >
      <Text variant="small" style={{ color: anonymous ? t.onAnonymous : t.onKnown, fontWeight: "700" }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
});
