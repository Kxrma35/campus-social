import { StyleSheet, TextInput, View } from "react-native";
import type { TextInputProps } from "react-native";
import { MIN_TARGET, radius, spacing, type } from "@/theme/tokens";
import { Text } from "./Text";
import { useTheme } from "./theme";

export interface TextFieldProps
  extends Omit<TextInputProps, "style" | "accessibilityLabel" | "accessibilityHint"> {
  label: string;
  hint?: string;
  error?: string | null;
  testID?: string;
  /** A borderless, large, serif surface for writing a post or a comment. */
  writing?: boolean;
}

export function TextField({ label, hint, error, testID, multiline, writing = false, ...rest }: TextFieldProps) {
  const t = useTheme();
  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      {hint && !writing ? (
        <Text variant="small" tone="muted">
          {hint}
        </Text>
      ) : null}
      <TextInput
        {...rest}
        testID={testID}
        multiline={multiline}
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={t.textMuted}
        style={[
          writing ? styles.writing : styles.input,
          writing ? type.readingLarge : type.body,
          {
            color: t.text,
            backgroundColor: t.card,
            borderColor: error ? t.danger : t.border,
            minHeight: writing ? 180 : multiline ? 96 : MIN_TARGET,
            textAlignVertical: multiline ? "top" : "center",
          },
        ]}
      />
      {hint && writing ? (
        <Text variant="small" tone="muted" style={{ textAlign: "right" }}>
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text variant="small" tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  writing: {
    borderWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 0,
    paddingVertical: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
