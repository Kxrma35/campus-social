import type { BottomTabBarProps } from "expo-router/build/layouts/Tabs";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { MIN_TARGET, radius } from "@/theme/tokens";
import { Icon } from "./Icon";
import { useTheme } from "./theme";

const SIZE = 48;

export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const t = useTheme();
  return (
    <View style={styles.outer} pointerEvents="box-none">
      <View
        accessibilityRole="tablist"
        style={[styles.bar, { backgroundColor: t.card, borderColor: t.hairline }]}
      >
        {state.routes.map((route, index) => {
          const options = descriptors[route.key]?.options;
          if (!options) return null;
          const focused = state.index === index;
          const label = String(options.tabBarAccessibilityLabel ?? options.title ?? route.name);
          const color = focused ? t.onPrimary : t.textMuted;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: focused }}
              aria-selected={focused}
              onPress={() => {
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={[styles.item, { backgroundColor: focused ? t.primary : "transparent" }]}
            >
              {options.tabBarIcon?.({ focused, color, size: 22 })}
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Write a post"
          testID="tab-compose"
          onPress={() => router.push("/compose")}
          style={[styles.item, { borderWidth: 1.5, borderColor: t.text }]}
        >
          <Icon name="plus" color={t.text} size={22} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { paddingHorizontal: 16, paddingBottom: 12 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 8,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "center",
    width: "100%",
    maxWidth: 420,
  },
  item: {
    width: SIZE,
    height: SIZE,
    minWidth: MIN_TARGET,
    minHeight: MIN_TARGET,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
