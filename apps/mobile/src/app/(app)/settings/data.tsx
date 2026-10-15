import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/core/lib/errors";
import { checkCode } from "@/core/lib/validation";
import { shareJson } from "@/core/exportFile";
import { useSession } from "@/core/session/SessionProvider";
import { spacing } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { InlineError } from "@/ui/InlineError";
import { Notice } from "@/ui/Notice";
import { OtpInput } from "@/ui/OtpInput";
import { SettingsPage } from "@/ui/SettingsPage";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

export default function DataScreen() {
  const { api, signOut } = useSession();
  const t = useTheme();

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const [understood, setUnderstood] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [closeErr, setCloseErr] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  async function download() {
    setExporting(true);
    setExportErr(null);
    setExportMsg(null);
    try {
      const data = await api.exportData();
      const result = await shareJson("moku-data.json", data);
      setExportMsg(
        result === "shared"
          ? "Your data is ready. Keep the file private."
          : "Sharing is not available on this device.",
      );
    } catch (e) {
      setExportErr(describeError(e));
    } finally {
      setExporting(false);
    }
  }

  async function requestClose() {
    setClosing(true);
    setCloseErr(null);
    try {
      await api.requestClose();
      setCodeSent(true);
    } catch (e) {
      setCloseErr(describeError(e));
    } finally {
      setClosing(false);
    }
  }

  async function confirmClose() {
    const c = checkCode(code);
    if (!c.ok || !c.value) {
      setCloseErr(c.error ?? "Enter the 6-digit code.");
      return;
    }
    setClosing(true);
    setCloseErr(null);
    try {
      await api.confirmClose(c.value);
      await signOut();
    } catch (e) {
      setCloseErr(describeError(e));
    } finally {
      setClosing(false);
    }
  }

  return (
    <SettingsPage>
      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">Download your data</Text>
        <Text>
          A file with your account details, both profiles, posts, comments, reactions, notifications
          and moderation records about you.
        </Text>
        <Notice title="Keep it private">
          If you have an anonymous profile, this file connects it to your known profile. Anyone who
          has the file can see they are the same person.
        </Notice>
        <Button label="Download my data" onPress={download} busy={exporting} testID="download-data" />
        {exportMsg ? <Notice tone="success">{exportMsg}</Notice> : null}
        {exportErr ? <InlineError>{exportErr}</InlineError> : null}
      </View>

      <View
        style={{
          gap: spacing.sm,
          marginTop: spacing.md,
          paddingTop: spacing.xl,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: t.hairline,
        }}
      >
        <Text variant="heading">Close your account</Text>
        <Text>
          Your profiles and everything you posted disappear from view straight away. About 30 days
          later it is permanently deleted. Download your data first if you want a copy.
        </Text>
        <Notice title="This cannot be undone" tone="error">
          After 30 days we cannot restore anything. You would need to create a new account.
        </Notice>

        {!codeSent ? (
          <>
            <Checkbox
              testID="understand-close"
              checked={understood}
              onChange={setUnderstood}
              label="I understand this closes my account and deletes my data"
            />
            <Button
              variant="danger"
              label="Send me a confirmation code"
              disabled={!understood}
              busy={closing}
              onPress={requestClose}
              testID="request-close"
            />
          </>
        ) : (
          <>
            <Text variant="small" tone="muted">
              Enter the 6-digit code we emailed you.
            </Text>
            <OtpInput
              label="6-digit code from your email"
              value={code}
              onChange={setCode}
              error={Boolean(closeErr)}
              testID="close-code"
            />
            <Button
              variant="danger"
              label="Close my account"
              busy={closing}
              onPress={confirmClose}
              testID="confirm-close"
            />
          </>
        )}
        {closeErr ? <InlineError>{closeErr}</InlineError> : null}
      </View>
    </SettingsPage>
  );
}
