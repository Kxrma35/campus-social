import { Linking, View } from "react-native";
import type { SupportInfo } from "@/core/api/types";
import { spacing } from "@/theme/tokens";
import { Button } from "./Button";
import { Notice } from "./Notice";
import { Text } from "./Text";

export function SupportPanel({ support, onDone }: { support: SupportInfo; onDone: () => void }) {
  return (
    <View style={{ gap: spacing.md }}>
      <Notice title="Support is available">
        <Text>{support.message}</Text>
        {support.resources.length === 0 ? (
          <Text tone="muted">
            If you are in immediate danger, contact your local emergency services.
          </Text>
        ) : null}
      </Notice>
      {support.resources.map((r) => (
        <View key={r.name} style={{ gap: spacing.xs }}>
          <Text variant="label">{r.name}</Text>
          <Text>{r.contact}</Text>
          {/^\+?[\d\s()-]{3,}$/.test(r.contact) ? (
            <Button
              variant="secondary"
              label={`Call ${r.name}`}
              onPress={() => void Linking.openURL(`tel:${r.contact.replace(/[^\d+]/g, "")}`)}
            />
          ) : null}
        </View>
      ))}
      <Button label="Done" onPress={onDone} />
    </View>
  );
}
