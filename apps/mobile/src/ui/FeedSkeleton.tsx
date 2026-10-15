import { StyleSheet, View } from "react-native";
import { radius, spacing } from "@/theme/tokens";
import { useTheme } from "./theme";

/** Static placeholder rows shown while the first page loads. Nothing animates. */
export function FeedSkeleton({ rows = 3 }: { rows?: number }) {
  const t = useTheme();
  const fill = { backgroundColor: t.primarySoft };
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading posts"
      accessibilityLiveRegion="polite"
      style={styles.wrap}
    >
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.row, { borderBottomColor: t.hairline }]}>
          <View style={styles.head}>
            <View style={[styles.avatar, fill]} />
            <View style={styles.names}>
              <View style={[styles.line, fill, { width: "46%" }]} />
              <View style={[styles.line, fill, { width: "30%" }]} />
            </View>
          </View>
          <View style={[styles.line, fill, { width: "92%" }]} />
          <View style={[styles.line, fill, { width: "78%" }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", maxWidth: 640, alignSelf: "center" },
  row: {
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  head: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  avatar: { width: 40, height: 40, borderRadius: radius.md },
  names: { flex: 1, gap: spacing.sm },
  line: { height: 12, borderRadius: radius.sm },
});
