import { SettingsPage } from "@/ui/SettingsPage";
import { LegalLinks } from "@/ui/LegalLinks";
import { Text } from "@/ui/Text";

export default function LegalScreen() {
  return (
    <SettingsPage>
      <Text tone="muted">
        These open in your browser. You can read them at any time, including before you create an
        account.
      </Text>
      <LegalLinks />
    </SettingsPage>
  );
}
