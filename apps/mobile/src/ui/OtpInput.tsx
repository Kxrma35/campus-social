import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { MIN_TARGET, radius, spacing, type } from "@/theme/tokens";
import { Text } from "./Text";
import { hiddenFromReaders } from "./a11y";
import { useTheme } from "./theme";

export function OtpInput({
  value,
  onChange,
  label = "6-digit code",
  length = 6,
  error,
  testID,
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  length?: number;
  error?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const digits = value.replace(/\D/g, "").slice(0, length);

  return (
    <View style={styles.wrap}>
      <View style={styles.cells} pointerEvents="none" {...hiddenFromReaders}>
        {Array.from({ length }, (_, i) => {
          const active = focused && i === Math.min(digits.length, length - 1);
          return (
            <View
              key={i}
              style={[
                styles.cell,
                {
                  backgroundColor: t.card,
                  borderColor: error ? t.danger : active ? t.focus : t.border,
                  borderWidth: active ? 2 : 1,
                },
              ]}
            >
              <Text variant="title">{digits[i] ?? ""}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        testID={testID}
        value={digits}
        onChangeText={(v) => onChange(v.replace(/\D/g, "").slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={length + 2}
        caretHidden
        accessibilityLabel={label}
        accessibilityHint={`Enter the ${length} digits from your email`}
        style={[styles.input, type.body]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  cells: { flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  cell: {
    flex: 1,
    minHeight: MIN_TARGET + 12,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    color: "transparent",
    opacity: 0.02,
  },
});
