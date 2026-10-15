import { router } from "expo-router";
import { APP_NAME } from "@/theme/brand";
import { AuthShell } from "@/ui/AuthShell";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

export default function Underage() {
  return (
    <AuthShell
      showBack={false}
      title="Thanks for being honest"
      subtitle={`${APP_NAME} is only for students aged 18 and over, so we cannot create an account for you.`}
    >
      <Text tone="muted" style={{ textAlign: "center" }}>
        We have not created an account and we have not kept anything you entered.
      </Text>
      <Button label="Close" variant="secondary" onPress={() => router.replace("/welcome")} testID="underage-close" />
    </AuthShell>
  );
}
