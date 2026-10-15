import { router } from "expo-router";
import { useAuthFlow } from "@/core/authFlow";
import { useSession } from "@/core/session/SessionProvider";
import { APP_NAME } from "@/theme/brand";
import { AuthShell } from "@/ui/AuthShell";
import { Button } from "@/ui/Button";

export default function Done() {
  const flow = useAuthFlow();
  const { signIn } = useSession();
  const session = flow.pendingSession;

  if (!session) {
    return (
      <AuthShell title="You're all set" subtitle="Sign in to continue." showBack={false}>
        <Button label="Sign in" onPress={() => router.replace("/welcome")} testID="done-signin" />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      showBack={false}
      title={`Welcome to ${APP_NAME}`}
      subtitle="Your account is ready. Other students at your campus can see your name and course on your known profile."
    >
      <Button
        label={`Open ${APP_NAME}`}
        onPress={async () => {
          flow.setPendingSession(null);
          await signIn(session);
        }}
        testID="done-open"
      />
    </AuthShell>
  );
}
