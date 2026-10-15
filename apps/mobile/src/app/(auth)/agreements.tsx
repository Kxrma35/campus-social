import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAuthFlow } from "@/core/authFlow";
import { spacing } from "@/theme/tokens";
import { AuthShell } from "@/ui/AuthShell";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { InlineError } from "@/ui/InlineError";
import { Text } from "@/ui/Text";

const ITEMS = [
  { key: "terms", label: "I agree to the Terms of service", read: "Read the Terms (draft)" },
  { key: "privacy", label: "I have read the Privacy policy", read: "Read the Privacy policy (draft)" },
  { key: "rules", label: "I agree to the Community rules", read: "Read the Community rules (draft)" },
] as const;

export default function Agreements() {
  const flow = useAuthFlow();
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  if (!flow.email || !flow.code || !flow.dateOfBirth) {
    return (
      <AuthShell title="Let's start again" subtitle="Your sign up was interrupted. Enter your email again to get a new code.">
        <Button label="Start again" onPress={() => router.replace("/welcome")} testID="start-again" />
      </AuthShell>
    );
  }

  function next() {
    if (ITEMS.some((i) => !ticked[i.key])) {
      setError("Tick each box to continue. You can read each document first.");
      return;
    }
    setError(null);
    router.push("/profile");
  }

  return (
    <AuthShell
      title="Before you join"
      subtitle="Each of these is a separate choice. Nothing is ticked for you."
    >
      <View style={{ gap: spacing.lg }}>
        {ITEMS.map((i) => (
          <View key={i.key} style={{ gap: spacing.xs }}>
            <Checkbox
              testID={`agree-${i.key}`}
              checked={Boolean(ticked[i.key])}
              onChange={(v) => setTicked((s) => ({ ...s, [i.key]: v }))}
              label={i.label}
            />
            <Button
              variant="link"
              label={i.read}
              onPress={() => router.push({ pathname: "/draft/[slug]", params: { slug: i.key } })}
              testID={`read-${i.key}`}
            />
          </View>
        ))}
      </View>
      {error ? <InlineError testID="agreements-error">{error}</InlineError> : null}
      <Button label="Continue" onPress={next} testID="agreements-next" />
      <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
        These documents are drafts and have not been reviewed by a lawyer yet.
      </Text>
    </AuthShell>
  );
}
