import { Tabs } from "expo-router";
import { FloatingTabBar } from "@/ui/FloatingTabBar";
import { Icon } from "@/ui/Icon";
import { useTheme } from "@/ui/theme";

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: t.ground },
        headerTintColor: t.text,
        headerTitleStyle: { color: t.text, fontWeight: "700" },
        headerTitleAlign: "left",
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: t.ground },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Feed",
          headerShown: false,
          tabBarAccessibilityLabel: "Feed",
          tabBarIcon: ({ color }) => <Icon name="home" color={String(color)} size={24} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Notifications",
          tabBarAccessibilityLabel: "Notifications",
          tabBarIcon: ({ color }) => <Icon name="bell" color={String(color)} size={24} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: "Me",
          tabBarAccessibilityLabel: "Me and settings",
          tabBarIcon: ({ color }) => <Icon name="person" color={String(color)} size={24} />,
        }}
      />
    </Tabs>
  );
}
