import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { KnownProfileDetails } from "@/core/api/types";
import { describeError } from "@/core/lib/errors";
import { useIdentity } from "@/core/session/IdentityProvider";
import { useSession } from "@/core/session/SessionProvider";
import { spacing } from "@/theme/tokens";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Column } from "@/ui/Column";
import { ListRow } from "@/ui/ListRow";
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
    <Screen padded={false}>
      <Column>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
          <StatusBanner />
        </View>

        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {me ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
                <Avatar
                  kind="known"
                  name={me.displayName}
                  size="xl"
                  profileId={me.profileId}
                  hasAvatar={me.hasAvatar}
                />
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <ProfileChip kind="known" self />
                  <Text variant="display">{me.displayName}</Text>
                </View>
              </View>
              <Text tone="muted">
                {`@${me.handle}`}
                {me.course ? ` · ${me.course}` : ""}
                {me.studyYear ? ` · Year ${me.studyYear}` : ""}
              </Text>
            </>
          ) : error ? (
            <Notice tone="error">{error}</Notice>
          ) : (
            <Text tone="muted">Loading…</Text>
          )}
        </View>

        <View style={{ paddingTop: spacing.lg }}>
          {me ? (
            <ListRow
              icon="person"
              title="See my profile and posts"
              onPress={() => router.push({ pathname: "/profile/[id]", params: { id: me.profileId } })}
            />
          ) : null}
          {anon ? (
            <ListRow
              icon="lock"
              title="See my anonymous posts"
              detail={`@${anon.handle}`}
              onPress={() => router.push({ pathname: "/profile/[id]", params: { id: anon.profileId } })}
            />
          ) : null}
          <ListRow
            icon="lock"
            title="Manage anonymous profile"
            detail={anon ? "You have an anonymous profile." : "You have not created one. It is optional."}
            onPress={() => router.push("/settings/anonymous")}
          />
          <ListRow title="Settings" onPress={() => router.push("/settings")} />
        </View>

        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl }}>
          <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
        </View>
      </Column>
    </Screen>
  );
}
