import { View } from "react-native";
import { useIdentity } from "@/core/session/IdentityProvider";
import { spacing } from "@/theme/tokens";
import { Button } from "./Button";
import { ProfileChip } from "./ProfileChip";
import { Text } from "./Text";

export function ActingSwitcher() {
  const { acting, setActing, canUseAnonymous } = useIdentity();
  if (!canUseAnonymous) return null;
  const other = acting === "known" ? "anonymous" : "known";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
      <Text variant="small" tone="muted">
        Viewing as
      </Text>
      <ProfileChip kind={acting} self />
      <Button
        variant="link"
        label={`Switch to ${other === "anonymous" ? "anonymous" : "your known profile"}`}
        onPress={() => setActing(other)}
      />
    </View>
  );
}
