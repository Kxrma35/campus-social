import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { describeError } from "@/core/lib/errors";
import { checkEmail } from "@/core/lib/validation";
import { useApi } from "@/core/session/SessionProvider";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export default function EmailScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const signup = mode !== "login";
  const api = useApi();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const checked = checkEmail(email);
    if (!checked.ok || !checked.value) {
      setError(checked.error ?? "Enter a valid email address.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (signup) await api.requestSignupCode(checked.value);
      else await api.requestLoginCode(checked.value);
      router.push({ pathname: "/code", params: { mode: signup ? "signup" : "login", email: checked.value } });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text variant="heading">{signup ? "Create your account" : "Sign in"}</Text>
      <Text tone="muted">
        {signup
          ? "Use your university email so we know you are a current student. We send a six-digit code to confirm it is yours."
          : "We will email a six-digit code to your university address."}
      </Text>
      <TextField
        label="University email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={submit}
        error={error}
        testID="email-input"
      />
      <Button label="Send me a code" onPress={submit} busy={busy} testID="send-code" />
      {signup ? (
        <Notice>
          If this address can be used, a code is on its way. If you already have an account, sign in
          instead.
        </Notice>
      ) : null}
    </Screen>
  );
}
