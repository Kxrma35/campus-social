import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MIN_TARGET, radius } from "@/theme/tokens";
import { Text } from "./Text";
import { useTheme } from "./theme";

export interface SegmentOption<T extends string> {
  key: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (key: T) => void;
  label: string;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState<T | null>(null);

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={styles.group}
    >
      {options.map((o, i) => {
        const selected = o.key === value;
        return (
          <View
            key={o.key}
            style={[
              styles.cell,
              { backgroundColor: selected ? t.primary : t.card, borderColor: selected ? t.primary : t.hairline },
            ]}
          >
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel={`${o.label}, ${i + 1} of ${options.length}`}
              accessibilityState={{ selected }}
              aria-selected={selected}
              onPress={() => onChange(o.key)}
              onFocus={() => setFocused(o.key)}
              onBlur={() => setFocused((f) => (f === o.key ? null : f))}
              style={({ pressed }) => [
                styles.segment,
                {
                  borderColor: focused === o.key ? t.focus : "transparent",
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text
                variant="label"
                style={{
                  color: selected ? t.onPrimary : t.textMuted,
                  textAlign: "center",
                  fontWeight: selected ? "700" : "500",
                }}
              >
                {o.label}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: "row",
    gap: 8,
  },
  cell: { flex: 1, borderRadius: radius.pill, overflow: "hidden", borderWidth: 1 },
  segment: {
    minHeight: MIN_TARGET,
    paddingHorizontal: 6,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: radius.pill,
  },
});
