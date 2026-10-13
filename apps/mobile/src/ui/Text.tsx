import { Text as RNText } from "react-native";
import type { TextProps } from "react-native";
import { type } from "@/theme/tokens";
import { useTheme } from "./theme";

type Variant = keyof typeof type;
type Tone = "default" | "muted" | "danger" | "success" | "primary";

export interface AppTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
}

export function Text({ variant = "body", tone = "default", style, ...rest }: AppTextProps) {
  const t = useTheme();
  const color =
    tone === "muted"
      ? t.textMuted
      : tone === "danger"
        ? t.danger
        : tone === "success"
          ? t.success
          : tone === "primary"
            ? t.primary
            : t.text;
  return (
    <RNText
      {...rest}
      accessibilityRole={rest.accessibilityRole ?? (variant === "title" || variant === "heading" ? "header" : undefined)}
      style={[type[variant], { color }, style]}
    />
  );
}
