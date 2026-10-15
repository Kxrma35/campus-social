import { StyleSheet, View } from "react-native";
import { spacing } from "@/theme/tokens";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { useTheme } from "./theme";

/** A field or form error. Announced to screen readers when it appears. */
export function InlineError({ children, testID }: { children: string; testID?: string }) {
  const t = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={styles.row}
    >
      <Icon name="flag" color={t.danger} size={16} />
      <Text variant="small" tone="danger" style={styles.text}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  text: { flex: 1 },
});
