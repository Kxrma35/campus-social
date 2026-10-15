import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import { spacing } from "@/theme/tokens";
import { Logomark } from "./Logomark";
import { Text } from "./Text";

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <Logomark size={40} />
      <Text variant="heading" style={styles.center}>
        {title}
      </Text>
      <Text tone="muted" style={styles.center}>
        {children}
      </Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.md, padding: spacing.xl, paddingTop: spacing.xxl },
  center: { textAlign: "center", maxWidth: 420 },
});
