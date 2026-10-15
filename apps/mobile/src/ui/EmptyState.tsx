import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import { spacing } from "@/theme/tokens";
import { Logomark } from "./Logomark";
import { Text } from "./Text";

/**
 * A screen or list with nothing in it yet. Says what is missing and what to do next.
 * `compact` drops the mark for an empty section inside a busier screen.
 */
export function EmptyState({
  title,
  children,
  action,
  compact = false,
}: {
  title: string;
  children?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      {compact ? null : <Logomark size={40} />}
      <Text variant={compact ? "label" : "heading"} style={styles.center}>
        {title}
      </Text>
      {children ? (
        <Text tone="muted" style={styles.center}>
          {children}
        </Text>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.md, padding: spacing.xl, paddingTop: spacing.xxl },
  compact: { padding: spacing.lg, paddingTop: spacing.lg },
  center: { textAlign: "center", maxWidth: 420 },
  action: { alignSelf: "stretch", maxWidth: 420, width: "100%" },
});
