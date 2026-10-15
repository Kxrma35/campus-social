import { router } from "expo-router";
import { Button } from "@/ui/Button";
import { AuthShell } from "@/ui/AuthShell";
import { Text } from "@/ui/Text";
import { APP_NAME } from "@/theme/brand";

export default function Welcome() {
  return (
    <AuthShell
      showBack={false}
      title={`Welcome to ${APP_NAME}`}
      subtitle="A place for verified students at your university to post to each other, as yourself or anonymously."
      footer={
        <Text variant="small" tone="muted" style={{ textAlign: "center" }}>
          You need to be 18 or older and have a current university email address.
        </Text>
      }
    >
      <Text variant="small" tone="muted" style={{ textAlign: "center" }}>
        Only students at your campus can see what you post. That is a smaller audience, not a
        private one: another student can still take a screenshot, and someone may recognise how you
        write.
      </Text>
      <Button
        label="Create an account"
        onPress={() => router.push({ pathname: "/email", params: { mode: "signup" } })}
        testID="create-account-start"
      />
      <Button
        variant="secondary"
        label="Sign in"
        onPress={() => router.push({ pathname: "/email", params: { mode: "login" } })}
        testID="sign-in-start"
      />
    </AuthShell>
  );
}
