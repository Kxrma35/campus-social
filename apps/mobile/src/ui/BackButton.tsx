import { router } from "expo-router";
import { Pressable } from "react-native";
import { MIN_TARGET } from "@/theme/tokens";
import { Icon } from "./Icon";
import { useTheme } from "./theme";

export function BackButton() {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      onPress={() => router.back()}
      style={{
        width: MIN_TARGET,
        height: MIN_TARGET,
        borderRadius: MIN_TARGET / 2,
        backgroundColor: t.card,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ rotate: "180deg" }],
      }}
    >
      <Icon name="chevronRight" color={t.text} size={20} />
    </Pressable>
  );
}
