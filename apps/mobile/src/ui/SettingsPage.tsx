import { View } from "react-native";
import type { ReactNode } from "react";
import { spacing } from "@/theme/tokens";
import { Column } from "./Column";
import { Screen } from "./Screen";

/** Shared frame for the settings sub-screens: the 640pt column with even padding and gaps. */
export function SettingsPage({ children }: { children: ReactNode }) {
  return (
    <Screen padded={false}>
      <Column>
        <View style={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg }}>{children}</View>
      </Column>
    </Screen>
  );
}
