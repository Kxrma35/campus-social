import { Pressable, StyleSheet, View } from "react-native";
import { MIN_TARGET, radius, spacing } from "@/theme/tokens";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { Text } from "./Text";
import { useTheme } from "./theme";

export function ListRow({
  title,
  detail,
  icon,
  onPress,
  tone = "default",
  testID,
  accessibilityLabel,
  showChevron = true,
}: {
  title: string;
  detail?: string;
  icon?: IconName;
  onPress: () => void;
  tone?: "default" | "primary";
  testID?: string;
  accessibilityLabel?: string;
  showChevron?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (detail ? `${title}. ${detail}` : title)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderColor: t.hairline, backgroundColor: pressed ? t.primarySoft : t.card },
      ]}
    >
      {icon ? <Icon name={icon} color={tone === "primary" ? t.primary : t.textMuted} /> : null}
      <View style={styles.text}>
        <Text variant="body" style={tone === "primary" ? { color: t.primary, fontWeight: "600" } : undefined}>
          {title}
        </Text>
        {detail ? (
          <Text variant="small" tone="muted">
            {detail}
          </Text>
        ) : null}
      </View>
      {showChevron ? <Icon name="chevronRight" color={t.textMuted} size={20} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: MIN_TARGET + 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: 2 },
});
