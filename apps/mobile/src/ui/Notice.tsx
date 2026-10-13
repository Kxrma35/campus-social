import { StyleSheet, View } from "react-native";
import { Children, type ReactNode } from "react";
import { radius, spacing } from "@/theme/tokens";
import { Text } from "./Text";
import { useTheme } from "./theme";

export function Notice({
  title,
  children,
  tone = "info",
}: {
  title?: string;
  children: ReactNode;
  tone?: "info" | "error" | "success";
}) {
  const t = useTheme();
  const border = tone === "error" ? t.danger : tone === "success" ? t.success : t.border;
  return (
    <View
      accessible
      accessibilityRole={tone === "error" ? "alert" : undefined}
      style={[styles.box, { backgroundColor: t.surface, borderColor: border }]}
    >
      {title ? <Text variant="label">{title}</Text> : null}
      {isPlainText(children) ? <Text>{children}</Text> : children}
    </View>
  );
}

function isPlainText(children: ReactNode): boolean {
  const items = Children.toArray(children);
  return items.length > 0 && items.every((c) => typeof c === "string" || typeof c === "number");
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
});
