import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { IdentityProvider } from "@/core/session/IdentityProvider";
import { SessionProvider, useSession } from "@/core/session/SessionProvider";
import { Loading } from "@/ui/Loading";
import { ThemeProvider, useTheme } from "@/ui/theme";

function Gate() {
  const { status } = useSession();
  const t = useTheme();
  if (status === "loading") return <Loading label="Starting Moku" />;
  const signedIn = status === "signedIn";

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.background },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <IdentityProvider>
            <StatusBar style="auto" />
            <Gate />
          </IdentityProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
