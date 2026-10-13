import { Pressable, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import { MIN_TARGET, radius, spacing } from "@/theme/tokens";
import { Text } from "./Text";
import { useTheme } from "./theme";

export function Checkbox({
  checked,
  onChange,
  label,
  children,
  testID,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Spoken label. The visible content can be richer (children). */
  label: string;
  children?: ReactNode;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={styles.row}
    >
      <View
        style={[
          styles.box,
          { borderColor: t.border, backgroundColor: checked ? t.primary : t.background },
        ]}
      >
        {checked ? (
          <Text style={{ color: t.onPrimary, fontWeight: "700" }} accessibilityElementsHidden>
            ✓
          </Text>
        ) : null}
      </View>
      <View style={styles.text}>{children ?? <Text>{label}</Text>}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start", minHeight: MIN_TARGET },
  box: {
    width: 28,
    height: 28,
    borderWidth: 2,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  text: { flex: 1 },
});
