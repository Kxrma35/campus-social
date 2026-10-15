import { router } from "expo-router";
import { useAuthFlow } from "@/core/authFlow";
import { useSession } from "@/core/session/SessionProvider";
import { APP_NAME } from "@/theme/brand";
import { AuthShell } from "@/ui/AuthShell";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

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

  async function enter(thenPhoto: boolean) {
    flow.setPendingSession(null);
    await signIn(session!);
    if (thenPhoto) setTimeout(() => router.push("/settings/edit-profile"), 300);
  }

  return (
    <AuthShell
      showBack={false}
      title={`Welcome to ${APP_NAME}`}
      subtitle="Your account is ready. Other students at your campus can see your name and course on your known profile."
    >
      <Button label="Add a profile photo" onPress={() => void enter(true)} testID="done-photo" />
      <Button
        variant="secondary"
        label={`Open ${APP_NAME} without a photo`}
        onPress={() => void enter(false)}
        testID="done-open"
      />
      <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
        A photo is optional and you can add or remove it later in Settings. Other students at your
        campus can see it.
      </Text>
    </AuthShell>
  );
}
