import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import type { ReportReason, ReportTargetKind } from "@/core/api/types";
import { describeError } from "@/core/lib/errors";
import { useIdentity } from "@/core/session/IdentityProvider";
import { useSession } from "@/core/session/SessionProvider";
import { spacing } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const REASONS: { key: ReportReason; label: string; hint?: string }[] = [
  { key: "threat", label: "A threat or someone in danger" },
  { key: "harassment", label: "Harassment or bullying" },
  { key: "intimate_image", label: "Intimate images shared without consent" },
  { key: "private_info", label: "Someone's private details or photos" },
  { key: "hate", label: "Hate against a group" },
  { key: "impersonation", label: "Pretending to be someone else" },
  { key: "self_harm", label: "Someone may be thinking of harming themselves" },
  { key: "other", label: "Something else" },
];

export default function ReportScreen() {
  const { kind = "post", id = "" } = useLocalSearchParams<{ kind?: string; id?: string }>();
  const { api } = useSession();
  const { acting } = useIdentity();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!reason) {
      setError("Choose what is wrong.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.report(
        { targetKind: kind as ReportTargetKind, targetId: id, reason, detail: detail.trim() || null },
        acting,
      );
      setDone(true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Notice tone="success" title="Thank you">
          We have received your report. A moderator will look at it. We do not tell the person you
          reported that it was you.
        </Notice>
        <Button label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="heading">What is wrong?</Text>
      <Text tone="muted">
        Your report is confidential. The person you report is not told it was you, and moderators
        cannot see who sent it.
      </Text>
      <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
        {REASONS.map((r) => (
          <Checkbox
            key={r.key}
            checked={reason === r.key}
            onChange={() => setReason(r.key)}
            label={r.label}
          />
        ))}
      </View>
      {reason === "self_harm" ? (
        <Notice title="If someone is in immediate danger">
          Please contact local emergency services as well. A report here is reviewed by a person, but
          not instantly.
        </Notice>
      ) : null}
      <TextField
        label="Anything we should know? (optional)"
        value={detail}
        onChangeText={setDetail}
        multiline
        maxLength={1000}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button label="Send report" onPress={submit} busy={busy} testID="send-report" />
    </Screen>
  );
}
