import { router } from "expo-router";
import { View } from "react-native";
import { useSession } from "@/core/session/SessionProvider";
import { spacing } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Column } from "@/ui/Column";
import { ListRow } from "@/ui/ListRow";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="heading" style={{ paddingHorizontal: spacing.lg }}>
        {title}
      </Text>
      <View>{children}</View>
    </View>
  );
}

export default function SettingsIndex() {
  const { signOut, accountStatus } = useSession();
  return (
    <Screen padded={false}>
      <Column gap={spacing.xl}>
        <View style={{ paddingTop: spacing.lg, gap: spacing.xl }}>
          <Group title="Your profiles">
            <ListRow title="Edit your profile" onPress={() => router.push("/settings/edit-profile")} />
            <ListRow title="Anonymous profile" onPress={() => router.push("/settings/anonymous")} />
          </Group>

          <Group title="Your account">
            <ListRow
              title={accountStatus === "read_only" ? "Confirm your email (needed)" : "Confirm your email again"}
              tone={accountStatus === "read_only" ? "primary" : "default"}
              onPress={() => router.push("/settings/reverify")}
            />
            <ListRow
              title="Your data: download or close account"
              onPress={() => router.push("/settings/data")}
            />
          </Group>

          <Group title="About">
            <ListRow title="Privacy policy, terms and rules" onPress={() => router.push("/settings/legal")} />
          </Group>
        </View>

        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}>
          <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
        </View>
      </Column>
    </Screen>
  );
}
