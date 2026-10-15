import { router } from "expo-router";
import { AuthShell } from "@/ui/AuthShell";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";

/**
 * Shown when an email cannot be classified as a student email. Nothing in the API
 * produces this state yet (open decision 3), so no route navigates here.
 */
export default function PendingApproval() {
  return (
    <AuthShell
      showBack={false}
      title="We need to check your address"
      subtitle="We could not tell automatically that this is a current student email."
    >
      <Notice title="What happens next">
        Someone will need to confirm your address before you can use the app. Nothing has been
        sent from this screen, and we will not guess: you will hear from us at this email address
        once it has been looked at.
      </Notice>
      <Button label="Back" variant="secondary" onPress={() => router.replace("/welcome")} testID="pending-back" />
    </AuthShell>
  );
}
