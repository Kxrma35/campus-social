import { Tabs } from "expo-router";
import { useTheme } from "@/ui/theme";

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.background },
        headerTintColor: t.text,
        headerTitleStyle: { color: t.text },
        tabBarStyle: { backgroundColor: t.background, borderTopColor: t.border },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarShowLabel: true,
        tabBarLabelStyle: { fontSize: 13 },
        tabBarIconStyle: { display: "none" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Feed", tabBarAccessibilityLabel: "Feed" }} />
      <Tabs.Screen
        name="notifications"
        options={{ title: "Notifications", tabBarAccessibilityLabel: "Notifications" }}
      />
      <Tabs.Screen name="me" options={{ title: "Me", tabBarAccessibilityLabel: "Me and settings" }} />
    </Tabs>
  );
}
