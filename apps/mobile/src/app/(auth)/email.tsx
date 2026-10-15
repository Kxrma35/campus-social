import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAuthFlow } from "@/core/authFlow";
import { UNIVERSITY_EMAIL_DOMAINS } from "@/core/constants";
import { describeError } from "@/core/lib/errors";
import { checkUniversityEmail } from "@/core/lib/validation";
import { useApi } from "@/core/session/SessionProvider";
import { APP_NAME } from "@/theme/brand";
import { AuthShell } from "@/ui/AuthShell";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export default function EmailScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const signup = mode !== "login";
  const api = useApi();
  const flow = useAuthFlow();
  const [email, setEmail] = useState(flow.email);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const checked = checkUniversityEmail(email, UNIVERSITY_EMAIL_DOMAINS);
    if (!checked.ok || !checked.value) {
      setError(checked.error ?? "Enter a valid email address.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (signup) await api.requestSignupCode(checked.value);
      else await api.requestLoginCode(checked.value);
      flow.setEmail(checked.value);
      flow.setCode("");
      flow.setCodeSentAt(Date.now());
      flow.setNotice(null);
      router.push({ pathname: "/code", params: { mode: signup ? "signup" : "login" } });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  function other() {
    router.replace({ pathname: "/email", params: { mode: signup ? "login" : "signup" } });
  }

  return (
    <AuthShell
      title={signup ? `Create your ${APP_NAME} account` : `Sign in to ${APP_NAME}`}
      subtitle={
        signup
          ? "Use your university email so we know you are a current student."
          : "We will email a one-time code to your university address."
      }
      footer={
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
          <Text variant="small" tone="muted">
            {signup ? "Already have an account? " : "Don't have an account? "}
          </Text>
          <Button variant="link" label={signup ? "Sign in" : "Sign up"} onPress={other} testID="switch-mode" />
        </View>
      }
    >
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
        placeholder={`you@${UNIVERSITY_EMAIL_DOMAINS[0]}`}
        error={error}
        testID="email-input"
      />
      <Button label="Send code" onPress={submit} busy={busy} testID="send-code" />
      {signup ? (
        <Notice>
          If this address can be used, a code is on its way. If you already have an account, sign in
          instead.
        </Notice>
      ) : null}
    </AuthShell>
  );
}
