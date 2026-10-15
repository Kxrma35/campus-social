import { Stack } from "expo-router";
import { AuthFlowProvider } from "@/core/authFlow";
import { useTheme } from "@/ui/theme";

export default function AuthLayout() {
  const t = useTheme();
  return (
    <AuthFlowProvider>
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: t.background },
        headerTintColor: t.text,
        headerTitleStyle: { color: t.text },
        contentStyle: { backgroundColor: t.background },
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="email" options={{ title: "Your university email" }} />
      <Stack.Screen name="code" options={{ title: "Enter your code" }} />
      <Stack.Screen name="details" options={{ title: "About you" }} />
    </Stack>
    </AuthFlowProvider>
  );
}
