import { router } from "expo-router";
import { View } from "react-native";
import { useSession } from "@/core/session/SessionProvider";
import { spacing } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export default function SettingsIndex() {
  const { signOut, accountStatus } = useSession();
  return (
    <Screen>
      <View style={{ gap: spacing.md }}>
        <Button variant="secondary" label="Edit your profile" onPress={() => router.push("/settings/edit-profile")} />
        <Button variant="secondary" label="Anonymous profile" onPress={() => router.push("/settings/anonymous")} />
        <Button variant="secondary" label="Your data: download or close account" onPress={() => router.push("/settings/data")} />
        <Button
          variant="secondary"
          label={accountStatus === "read_only" ? "Confirm your email (needed)" : "Confirm your email again"}
          onPress={() => router.push("/settings/reverify")}
        />
        <Button variant="secondary" label="Privacy policy, terms and rules" onPress={() => router.push("/settings/legal")} />
      </View>
      <Text variant="small" tone="muted">
        Campus Social is a working title.
      </Text>
      <Button label="Sign out" variant="link" onPress={() => void signOut()} />
    </Screen>
  );
}
