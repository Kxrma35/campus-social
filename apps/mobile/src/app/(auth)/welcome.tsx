import { router } from "expo-router";
import { View } from "react-native";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { spacing } from "@/theme/tokens";

export default function Welcome() {
  return (
    <Screen>
      <View style={{ gap: spacing.sm, paddingTop: spacing.xxl }}>
        <Text variant="title">Campus Social</Text>
        <Text>
          A place for verified students at your university to post to each other, as yourself or
          anonymously.
        </Text>
      </View>

      <Notice title="What to expect">
        Only students at your campus can see what you post. That is a smaller audience, not a
        private one: another student can still take a screenshot, and someone may recognise how you
        write.
      </Notice>

      <View style={{ gap: spacing.md }}>
        <Button
          label="Create an account"
          onPress={() => router.push({ pathname: "/email", params: { mode: "signup" } })}
        />
        <Button
          variant="secondary"
          label="Sign in"
          onPress={() => router.push({ pathname: "/email", params: { mode: "login" } })}
        />
      </View>

      <Text variant="small" tone="muted">
        You need to be 18 or older and have a current university email address.
      </Text>
    </Screen>
  );
}
