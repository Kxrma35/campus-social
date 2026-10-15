import { router } from "expo-router";
import { View } from "react-native";
import { useSession } from "@/core/session/SessionProvider";
import { spacing } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { ListRow } from "@/ui/ListRow";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export default function SettingsIndex() {
  const { signOut, accountStatus } = useSession();
  return (
    <Screen padded={false}>
      <View>
        <ListRow title="Edit your profile" onPress={() => router.push("/settings/edit-profile")} />
        <ListRow title="Anonymous profile" onPress={() => router.push("/settings/anonymous")} />
        <ListRow
          title="Your data: download or close account"
          onPress={() => router.push("/settings/data")}
        />
        <ListRow
          title={accountStatus === "read_only" ? "Confirm your email (needed)" : "Confirm your email again"}
          tone={accountStatus === "read_only" ? "primary" : "default"}
          onPress={() => router.push("/settings/reverify")}
        />
        <ListRow title="Privacy policy, terms and rules" onPress={() => router.push("/settings/legal")} />
      </View>
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
        <Text variant="small" tone="muted">
          Moku is a working title.
        </Text>
        <Button label="Sign out" variant="link" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}
