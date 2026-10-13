import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { describeError } from "@/core/lib/errors";
import { checkCode } from "@/core/lib/validation";
import { useSession } from "@/core/session/SessionProvider";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export default function CodeScreen() {
  const { mode, email = "" } = useLocalSearchParams<{ mode?: string; email?: string }>();
  const signup = mode !== "login";
  const { api, signIn } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  async function submit() {
    const checked = checkCode(code);
    if (!checked.ok || !checked.value) {
      setError(checked.error ?? "Enter the 6-digit code.");
      return;
    }
    setError(null);

    if (signup) {
      router.push({ pathname: "/details", params: { email, code: checked.value } });
      return;
    }

    setBusy(true);
    try {
      const res = await api.verifyLogin(email, checked.value);
      await signIn(res);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      if (signup) await api.requestSignupCode(email);
      else await api.requestLoginCode(email);
      setResent(true);
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <Screen>
      <Text tone="muted">
        We sent a six-digit code to {email}. It works for 10 minutes. Check your spam folder if it
        does not arrive.
      </Text>
      <TextField
        label="6-digit code"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={7}
        error={error}
        testID="code-input"
      />
      <Button label={signup ? "Continue" : "Sign in"} onPress={submit} busy={busy} testID="submit-code" />
      <Button variant="link" label="Send a new code" onPress={resend} />
      {resent ? <Text tone="success" accessibilityLiveRegion="polite">A new code is on its way.</Text> : null}
    </Screen>
  );
}
