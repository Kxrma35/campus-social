import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useAuthFlow } from "@/core/authFlow";
import { CODE_EXPIRY_MINUTES, CODE_RESEND_COOLDOWN_SECONDS } from "@/core/constants";
import { describeError } from "@/core/lib/errors";
import { checkCode } from "@/core/lib/validation";
import { useSession } from "@/core/session/SessionProvider";
import { AuthShell } from "@/ui/AuthShell";
import { Button } from "@/ui/Button";
import { InlineError } from "@/ui/InlineError";
import { Notice } from "@/ui/Notice";
import { OtpInput } from "@/ui/OtpInput";
import { Text } from "@/ui/Text";
import { spacing } from "@/theme/tokens";

function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function CodeScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const flow = useAuthFlow();
  const email = flow.email;
  const signup = mode !== "login";
  const { api, signIn } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(flow.notice);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const mountedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const sentAt = flow.codeSentAt ?? mountedAt.current;
  const expiresIn = Math.max(0, CODE_EXPIRY_MINUTES * 60_000 - (now - sentAt));
  const cooldown = Math.max(0, CODE_RESEND_COOLDOWN_SECONDS - Math.floor((now - sentAt) / 1000));
  const expired = expiresIn === 0;

  async function submit() {
    const checked = checkCode(code);
    if (!checked.ok || !checked.value) {
      setError(checked.error ?? "Enter the 6-digit code.");
      return;
    }
    setError(null);
    flow.setNotice(null);

    if (signup) {
      flow.setCode(checked.value);
      router.push("/birthdate");
      return;
    }

    setBusy(true);
    try {
      await signIn(await api.verifyLogin(email, checked.value));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setResent(false);
    try {
      if (signup) await api.requestSignupCode(email);
      else await api.requestLoginCode(email);
      flow.setCodeSentAt(Date.now());
      setNow(Date.now());
      setCode("");
      setResent(true);
    } catch (e) {
      setError(describeError(e));
    }
  }

  if (!email) {
    return (
      <AuthShell title="Let's start again" subtitle="Your sign in was interrupted, for example by reloading the page.">
        <Button label="Start again" onPress={() => router.replace("/welcome")} testID="start-again" />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Check your email"
      subtitle={`We sent a 6-digit code to ${email}. Check your spam folder if it does not arrive.`}
      footer={
        <Button
          variant="link"
          label="Change email"
          onPress={() => router.replace({ pathname: "/email", params: { mode: signup ? "signup" : "login" } })}
          testID="change-email"
        />
      }
    >
      <OtpInput value={code} onChange={setCode} error={Boolean(error)} testID="code-input" />
      {error ? <InlineError>{error}</InlineError> : null}
      <View accessibilityLiveRegion={expired ? "polite" : "none"}>
        <Text variant="small" tone={expired ? "danger" : "muted"} style={{ textAlign: "center" }}>
          {expired ? "This code has expired. Send a new one." : `Code expires in ${clock(expiresIn)}`}
        </Text>
      </View>
      <Button
        label={signup ? "Continue" : "Sign in"}
        onPress={submit}
        busy={busy}
        disabled={expired}
        testID="submit-code"
      />
      <View style={{ gap: spacing.xs, alignItems: "center" }}>
        <Button
          variant="link"
          label={cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
          onPress={resend}
          disabled={cooldown > 0}
          testID="resend-code"
        />
      </View>
      {resent ? (
        <Notice tone="success">A new code is on its way.</Notice>
      ) : null}
    </AuthShell>
  );
}
