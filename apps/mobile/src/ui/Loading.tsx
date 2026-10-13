import { ActivityIndicator, View } from "react-native";
import { useTheme } from "./theme";
import { Text } from "./Text";

export function Loading({ label = "Loading" }: { label?: string }) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12, backgroundColor: t.background }}
    >
      <ActivityIndicator color={t.primary} size="large" />
      <Text tone="muted">{label}</Text>
    </View>
  );
}
