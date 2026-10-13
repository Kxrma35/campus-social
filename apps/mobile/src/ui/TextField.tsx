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
}

export function TextField({ label, hint, error, testID, multiline, ...rest }: TextFieldProps) {
  const t = useTheme();
  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      {hint ? (
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
          styles.input,
          type.body,
          {
            color: t.text,
            backgroundColor: t.background,
            borderColor: error ? t.danger : t.border,
            minHeight: multiline ? 96 : MIN_TARGET,
            textAlignVertical: multiline ? "top" : "center",
          },
        ]}
      />
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
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
