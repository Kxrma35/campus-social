import { router } from "expo-router";
import { useSession } from "@/core/session/SessionProvider";
import { Button } from "./Button";
import { Notice } from "./Notice";
import { Text } from "./Text";
import { View } from "react-native";
import { spacing } from "@/theme/tokens";

export function StatusBanner() {
  const { accountStatus } = useSession();
  if (accountStatus === "read_only") {
    return (
      <Notice tone="info" title="Your account is read-only">
        <View style={{ gap: spacing.sm }}>
          <Text>
            You need to confirm your university email once a year. Until you do, you can read, and
            download or delete your data, but you cannot post, comment or react.
          </Text>
          <Button
            label="Confirm my email"
            onPress={() => router.push("/settings/reverify")}
          />
        </View>
      </Notice>
    );
  }
  return null;
}
