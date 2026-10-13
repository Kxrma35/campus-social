import { router } from "expo-router";
import { useState } from "react";
import { describeError } from "@/core/lib/errors";
import { checkCode } from "@/core/lib/validation";
import { useSession } from "@/core/session/SessionProvider";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export default function Reverify() {
  const { api, setAccountStatus } = useSession();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      await api.requestReverify();
      setSent(true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const c = checkCode(code);
    if (!c.ok || !c.value) {
      setError(c.error ?? "Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.verifyReverify(c.value);
      setAccountStatus("active");
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
          Your email is confirmed for another year.
        </Notice>
        <Button label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text>
        Once a year we ask you to confirm your university email so only current students stay on
        Campus Social. We send a six-digit code to your university address.
      </Text>
      {!sent ? (
        <Button label="Send me a code" onPress={request} busy={busy} testID="request-reverify" />
      ) : (
        <>
          <TextField label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={7} testID="reverify-code" />
          <Button label="Confirm" onPress={confirm} busy={busy} testID="confirm-reverify" />
        </>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Notice title="Graduated, or lost access to your university email?">
        You will not be able to confirm. Download your data before your account closes, from
        Settings.
      </Notice>
    </Screen>
  );
}
