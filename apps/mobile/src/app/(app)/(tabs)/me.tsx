import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { KnownProfileDetails } from "@/core/api/types";
import { describeError } from "@/core/lib/errors";
import { useIdentity } from "@/core/session/IdentityProvider";
import { useSession } from "@/core/session/SessionProvider";
import { spacing } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { ProfileChip } from "@/ui/ProfileChip";
import { Screen } from "@/ui/Screen";
import { StatusBanner } from "@/ui/StatusBanner";
import { Text } from "@/ui/Text";

export default function MeScreen() {
  const { api, signOut } = useSession();
  const { profiles } = useIdentity();
  const [me, setMe] = useState<KnownProfileDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .knownProfile()
      .then((p) => alive && setMe(p))
      .catch((e) => alive && setError(describeError(e)));
    return () => {
      alive = false;
    };
  }, [api]);

  const anon = profiles?.anonymous;

  return (
    <Screen>
      <StatusBanner />
      <View style={{ gap: spacing.sm }}>
        <ProfileChip kind="known" self />
        {me ? (
          <>
            <Text variant="title">{me.displayName}</Text>
            <Text tone="muted">
              {`@${me.handle}`}
              {me.course ? ` · ${me.course}` : ""}
              {me.studyYear ? ` · Year ${me.studyYear}` : ""}
            </Text>
            <Button
              variant="secondary"
              label="See my profile and posts"
              onPress={() => router.push({ pathname: "/profile/[id]", params: { id: me.profileId } })}
            />
          </>
        ) : error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <Text tone="muted">Loading…</Text>
        )}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">Anonymous profile</Text>
        {anon ? (
          <>
            <ProfileChip kind="anonymous" self />
            <Text>{`@${anon.handle}`}</Text>
            <Button
              variant="secondary"
              label="See my anonymous posts"
              onPress={() => router.push({ pathname: "/profile/[id]", params: { id: anon.profileId } })}
            />
          </>
        ) : (
          <Text tone="muted">You have not created one. It is optional.</Text>
        )}
        <Button variant="secondary" label="Manage anonymous profile" onPress={() => router.push("/settings/anonymous")} />
      </View>

      <Button label="Settings" variant="secondary" onPress={() => router.push("/settings")} />
      <Button label="Sign out" variant="link" onPress={() => void signOut()} />
    </Screen>
  );
}
