import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAuthFlow } from "@/core/authFlow";
import { checkDateOfBirth, isAtLeast18 } from "@/core/lib/validation";
import { spacing } from "@/theme/tokens";
import { AuthShell } from "@/ui/AuthShell";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { InlineError } from "@/ui/InlineError";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export default function BirthDate() {
  const flow = useAuthFlow();
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [over18, setOver18] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!flow.email || !flow.code) {
    return (
      <AuthShell title="Let's start again" subtitle="Your sign up was interrupted. Enter your email again to get a new code.">
        <Button label="Start again" onPress={() => router.replace("/welcome")} testID="start-again" />
      </AuthShell>
    );
  }

  function next() {
    const dob = checkDateOfBirth(day, month, year);
    if (!dob.ok || !dob.value) {
      setError(dob.error ?? "Check your date of birth and try again.");
      return;
    }
    if (!isAtLeast18(dob.value)) {
      // Nothing is kept: no account exists and the entered data is dropped.
      flow.reset();
      router.replace("/underage");
      return;
    }
    if (!over18) {
      setError("Confirm that you are 18 or older.");
      return;
    }
    setError(null);
    flow.setDateOfBirth(dob.value);
    router.push("/agreements");
  }

  return (
    <AuthShell title="Your date of birth" subtitle="Used once, to check you are 18 or older. We do not show it to anyone.">
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <TextField label="Day" value={day} onChangeText={setDay} keyboardType="number-pad" maxLength={2} testID="dob-day" />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label="Month" value={month} onChangeText={setMonth} keyboardType="number-pad" maxLength={2} testID="dob-month" />
        </View>
        <View style={{ flex: 1.4 }}>
          <TextField label="Year" value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} testID="dob-year" />
        </View>
      </View>
      <Checkbox
        testID="over18"
        checked={over18}
        onChange={setOver18}
        label="I confirm that I am 18 years old or older"
      />
      {error ? <InlineError testID="birthdate-error">{error}</InlineError> : null}
      <Button label="Continue" onPress={next} testID="birthdate-next" />
      <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
        Moku is only for students aged 18 and over.
      </Text>
    </AuthShell>
  );
}
