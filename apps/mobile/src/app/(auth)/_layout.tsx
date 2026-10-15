import { Stack } from "expo-router";
import { AuthFlowProvider } from "@/core/authFlow";
import { useTheme } from "@/ui/theme";

export const unstable_settings = { initialRouteName: "welcome" };

export default function AuthLayout() {
  const t = useTheme();
  return (
    <AuthFlowProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.background } }} />
    </AuthFlowProvider>
  );
}
