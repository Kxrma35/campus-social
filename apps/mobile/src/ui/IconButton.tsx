import { Pressable, StyleSheet } from "react-native";
import { MIN_TARGET } from "@/theme/tokens";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { useTheme } from "./theme";

export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  tone = "default",
  rotate = 0,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "glass";
  rotate?: number;
  testID?: string;
}) {
  const t = useTheme();
  const bg = tone === "glass" ? "transparent" : t.card;
  const fg = tone === "glass" ? t.onGlass : t.text;
  const border = tone === "glass" ? t.onGlass : t.hairline;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={0}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: bg,
          borderColor: border,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
          transform: [{ rotate: `${rotate}deg` }],
        },
      ]}
    >
      <Icon name={icon} color={fg} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    borderRadius: MIN_TARGET / 2,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
