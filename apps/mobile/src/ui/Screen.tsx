import { ScrollView, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { spacing } from "@/theme/tokens";
import { useTheme } from "./theme";

export function Screen({
  children,
  scroll = true,
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const t = useTheme();
  const body = <View style={[padded && styles.padded, styles.gap]}>{children}</View>;
  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={[styles.fill, { backgroundColor: t.ground }]}>
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.fillGrow}>
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fillGrow: { flexGrow: 1 },
  padded: { padding: spacing.lg },
  gap: { gap: spacing.lg },
});
