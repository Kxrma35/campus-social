import { Pressable, StyleSheet, View } from "react-native";
import type { ProfileKind } from "@/core/api/types";
import { MIN_TARGET, radius, spacing } from "@/theme/tokens";
import { Avatar } from "./Avatar";
import { Text } from "./Text";
import { useTheme } from "./theme";

/**
 * Chooses which profile a post goes out under. Each option is a disc plus words, so the
 * choice never rests on colour alone. Only shown when there is an anonymous profile.
 */
export function PostingAsSwitch({
  value,
  onChange,
  knownHandle,
  anonymousHandle,
}: {
  value: ProfileKind;
  onChange: (next: ProfileKind) => void;
  knownHandle?: string | null;
  anonymousHandle?: string | null;
}) {
  const t = useTheme();
  const options: { kind: ProfileKind; title: string; detail: string; handle?: string | null }[] = [
    { kind: "known", title: "You", detail: "Your name is shown", handle: knownHandle },
    {
      kind: "anonymous",
      title: "Anonymous",
      detail: "Hidden from other students",
      handle: anonymousHandle,
    },
  ];

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Post as" style={styles.group}>
      {options.map((o) => {
        const selected = value === o.kind;
        const ink = o.kind === "anonymous" ? t.identity.anon : t.identity.known;
        return (
          <Pressable
            key={o.kind}
            testID={`as-${o.kind}`}
            accessibilityRole="radio"
            accessibilityLabel={`${o.title}. ${o.detail}`}
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            onPress={() => onChange(o.kind)}
            style={({ pressed }) => [
              styles.option,
              {
                borderColor: selected ? ink : t.hairline,
                borderWidth: selected ? 2 : 1,
                backgroundColor: selected ? (o.kind === "anonymous" ? t.anonymousSoft : t.primarySoft) : t.card,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Avatar kind={o.kind} name={o.handle} size="md" />
            <View style={styles.text}>
              <Text variant="label" style={{ color: selected ? ink : t.text }}>
                {o.title}
              </Text>
              <Text variant="small" tone="muted">
                {o.detail}
              </Text>
            </View>
            <View style={[styles.dot, { borderColor: selected ? ink : t.border }]}>
              {selected ? <View style={[styles.dotFill, { backgroundColor: ink }]} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: {
    flexGrow: 1,
    flexBasis: 150,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: MIN_TARGET + 20,
    padding: spacing.sm,
    borderRadius: radius.lg,
  },
  text: { flex: 1, gap: 2 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dotFill: { width: 10, height: 10, borderRadius: 5 },
});
