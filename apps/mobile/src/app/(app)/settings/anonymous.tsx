import { useState } from "react";
import { View } from "react-native";
import type { AnonymousStatus } from "@/core/api/types";
import { ANONYMITY_NOTICE } from "@/core/constants";
import { describeError } from "@/core/lib/errors";
import { useIdentity } from "@/core/session/IdentityProvider";
import { useSession } from "@/core/session/SessionProvider";
import { spacing } from "@/theme/tokens";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { InlineError } from "@/ui/InlineError";
import { Checkbox } from "@/ui/Checkbox";
import { Notice } from "@/ui/Notice";
import { ProfileChip } from "@/ui/ProfileChip";
import { SettingsPage } from "@/ui/SettingsPage";
import { Text } from "@/ui/Text";
import { shortDate } from "@/core/lib/time";

const LOCKED: Partial<Record<AnonymousStatus, string>> = {
  locked_strikes:
    "Anonymous profiles are unavailable while your account has a warning against it.",
  locked_account_state:
    "Anonymous profiles are unavailable for your account right now. Confirm your email or contact us if you think this is wrong.",
  unavailable:
    "Your anonymous profile exists but is temporarily unavailable. Your known profile is not affected. Please try again later.",
};

export default function AnonymousSettings() {
  const { api } = useSession();
  const { profiles, refresh } = useIdentity();
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  if (!profiles) {
    return (
      <SettingsPage>
        <Text tone="muted">Loading…</Text>
      </SettingsPage>
    );
  }

  const eligibility = profiles.anonymousEligibility;
  const notice = profiles.notice || ANONYMITY_NOTICE;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createAnonymousProfile();
      setCreated(res.profile.handle);
      await refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (profiles.anonymous || created) {
    const handle = profiles.anonymous?.handle ?? created;
    return (
      <SettingsPage>
        <View style={{ alignItems: "center", gap: spacing.md }}>
          <Avatar kind="anonymous" name={handle} size="xl" />
          <Text variant="title">{`@${handle}`}</Text>
          <View style={{ alignSelf: "center" }}>
            <ProfileChip kind="anonymous" self />
          </View>
        </View>
        <Text>
          This is your anonymous profile. Choose it when you post, comment or react, and the app
          will always tell you which profile you are using.
        </Text>
        <Notice title="What anonymous means here">{notice}</Notice>
        <Text tone="muted">
          It does not stop someone recognising how you write, and it cannot stop a screenshot.
        </Text>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage>
      <Text variant="heading">Add an anonymous profile</Text>
      <Text>
        An anonymous profile lets you post under a generated name that is not linked to you in the
        eyes of other students.
      </Text>
      <Notice title="Please read this first">{notice}</Notice>
      <View style={{ gap: spacing.xs }}>
        <Text>
          We cannot stop screenshots, and people who know you may recognise how you write. Anyone who
          breaks the community rules is dealt with whichever profile they used.
        </Text>
      </View>

      {eligibility.status === "available" ? (
        <>
          <Checkbox
            testID="read-notice"
            checked={read}
            onChange={setRead}
            label="I have read this and I understand what anonymous does and does not mean"
          />
          <Button label="Create my anonymous profile" onPress={create} busy={busy} disabled={!read} testID="create-anon" />
        </>
      ) : eligibility.status === "locked_new_account" ? (
        <Notice title="Not available yet">
          Anonymous profiles unlock when your account is a few days old.
          {eligibility.unlocksAt ? ` Yours unlocks on ${shortDate(new Date(eligibility.unlocksAt))}.` : ""}
        </Notice>
      ) : (
        <Notice title="Not available">{LOCKED[eligibility.status] ?? "Not available right now."}</Notice>
      )}
      {error ? <InlineError>{error}</InlineError> : null}
    </SettingsPage>
  );
}
