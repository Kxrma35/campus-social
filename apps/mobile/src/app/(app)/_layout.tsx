import { Stack } from "expo-router";
import { useEffect } from "react";
import { useSession } from "@/core/session/SessionProvider";
import { BackButton } from "@/ui/BackButton";
import { useTheme } from "@/ui/theme";

export default function AppLayout() {
  const t = useTheme();
  const { api, setAccountStatus } = useSession();

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((me) => {
        if (alive) setAccountStatus(me.account.status);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, setAccountStatus]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.ground },
        headerTintColor: t.text,
        headerTitleStyle: { color: t.text, fontWeight: "700" },
        headerTitleAlign: "left",
        headerShadowVisible: false,
        headerBackVisible: false,
        headerLeft: ({ canGoBack }) => (canGoBack ? <BackButton /> : null),
        contentStyle: { backgroundColor: t.ground },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="compose" options={{ title: "New post", presentation: "modal" }} />
      <Stack.Screen name="post/[id]" options={{ title: "Post" }} />
      <Stack.Screen name="profile/[id]" options={{ title: "Profile" }} />
      <Stack.Screen name="report" options={{ title: "Report", presentation: "modal" }} />
      <Stack.Screen name="settings/index" options={{ title: "Settings" }} />
      <Stack.Screen name="settings/edit-profile" options={{ title: "Edit your profile" }} />
      <Stack.Screen name="settings/anonymous" options={{ title: "Anonymous profile" }} />
      <Stack.Screen name="settings/data" options={{ title: "Your data" }} />
      <Stack.Screen name="settings/reverify" options={{ title: "Confirm your email" }} />
      <Stack.Screen name="settings/legal" options={{ title: "Policies" }} />
    </Stack>
  );
}
