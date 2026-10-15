import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { Post, Profile } from "@/core/api/types";
import { describeError } from "@/core/lib/errors";
import { useIdentity } from "@/core/session/IdentityProvider";
import { useSession } from "@/core/session/SessionProvider";
import { usePagedList } from "@/core/usePagedList";
import { useReactions } from "@/core/useReactions";
import { spacing } from "@/theme/tokens";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Column } from "@/ui/Column";
import { EmptyState } from "@/ui/EmptyState";
import { Loading } from "@/ui/Loading";
import { Notice } from "@/ui/Notice";
import { PostCard } from "@/ui/PostCard";
import { ProfileChip } from "@/ui/ProfileChip";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

export default function ProfileScreen() {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const { api } = useSession();
  const { acting, profileIdFor } = useIdentity();
  const t = useTheme();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .profile(id, acting)
      .then((p) => alive && setProfile(p))
      .catch((e) => alive && setError(describeError(e)));
    return () => {
      alive = false;
    };
  }, [api, id, acting]);

  const posts = usePagedList<Post>(
    useCallback((cursor) => api.profilePosts(id, cursor, acting), [api, id, acting]),
    `${id}:${acting}`,
  );
  const reactions = useReactions(api, acting, (pid, next) => posts.replace(pid, next));
  const mine = [profileIdFor("known"), profileIdFor("anonymous")];

  async function toggleFollow() {
    if (!profile) return;
    setBusy(true);
    try {
      if (profile.viewerFollows) await api.unfollow(id, acting);
      else await api.follow(id, acting);
      setProfile(await api.profile(id, acting));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !profile) {
    return (
      <Screen>
        <Notice tone="error" title="Could not open this profile">
          {error}
        </Notice>
      </Screen>
    );
  }
  if (!profile) return <Loading label="Loading profile" />;

  const anonymous = profile.kind === "anonymous";
  const title = anonymous ? `@${profile.handle}` : (profile.displayName ?? `@${profile.handle}`);

  const stat = (n: number, label: string) => (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text variant="heading">{n}</Text>
      <Text variant="small" tone="muted">
        {label}
      </Text>
    </View>
  );

  return (
    <Screen padded={false}>
      <Column>
        <View style={{ alignItems: "center", gap: spacing.md, padding: spacing.lg, paddingTop: spacing.xl }}>
          <Avatar
            kind={profile.kind}
            name={profile.displayName ?? profile.handle}
            size="xl"
            profileId={profile.profileId}
            hasAvatar={profile.hasAvatar}
          />
          <View style={{ alignItems: "center", gap: spacing.sm }}>
            <Text variant="title" style={{ textAlign: "center" }}>
              {title}
            </Text>
            <View style={{ alignSelf: "center" }}>
              <ProfileChip kind={profile.kind} self={profile.isSelf} />
            </View>
            {!anonymous ? (
              <Text variant="small" tone="muted" style={{ textAlign: "center" }}>
                {`@${profile.handle}`}
                {profile.course ? ` · ${profile.course}` : ""}
                {profile.studyYear ? ` · Year ${profile.studyYear}` : ""}
              </Text>
            ) : (
              <Text variant="small" tone="muted" style={{ textAlign: "center" }}>
                An anonymous profile. Its owner is hidden from other students.
              </Text>
            )}
          </View>
          <View
            accessible
            accessibilityLabel={`${profile.postCount} ${profile.postCount === 1 ? "post" : "posts"}, ${profile.followerCount} ${profile.followerCount === 1 ? "follower" : "followers"}, ${profile.followingCount} following`}
            style={{
              flexDirection: "row",
              width: "100%",
              paddingVertical: spacing.md,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderColor: t.hairline,
            }}
          >
            {stat(profile.postCount, profile.postCount === 1 ? "post" : "posts")}
            {stat(profile.followerCount, profile.followerCount === 1 ? "follower" : "followers")}
            {stat(profile.followingCount, "following")}
          </View>
        </View>

        {!profile.isSelf ? (
          <View style={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}>
            <Button
              label={profile.viewerFollows ? "Unfollow" : "Follow"}
              variant={profile.viewerFollows ? "secondary" : "primary"}
              busy={busy}
              onPress={toggleFollow}
            />
            <Button
              variant="link"
              label="Report this profile"
              onPress={() => router.push({ pathname: "/report", params: { kind: "profile", id } })}
            />
          </View>
        ) : null}
        {error ? (
          <View style={{ padding: spacing.lg }}>
            <Notice tone="error">{error}</Notice>
          </View>
        ) : null}
        {reactions.error ? (
          <View style={{ padding: spacing.lg }}>
            <Notice tone="error">{reactions.error}</Notice>
          </View>
        ) : null}

        <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
          <Text variant="heading">Posts</Text>
          {posts.items.length === 0 && posts.state === "ready" ? (
            <EmptyState
              compact
              title={profile.isSelf ? "You have not posted yet" : "No posts yet"}
              action={
                profile.isSelf ? (
                  <Button label="Write a post" onPress={() => router.push("/compose")} />
                ) : undefined
              }
            />
          ) : null}
        </View>
        <View>
          {posts.items.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              myProfileIds={mine}
              onOpen={(x) => router.push({ pathname: "/post/[id]", params: { id: x.id } })}
              onToggleReaction={reactions.toggle}
              onReport={(x) => router.push({ pathname: "/report", params: { kind: "post", id: x.id } })}
            />
          ))}
        </View>
        {posts.state === "ready" && posts.items.length > 0 ? (
          <View style={{ padding: spacing.lg }}>
            <Button variant="secondary" label="Load more" onPress={() => void posts.loadMore()} />
          </View>
        ) : null}
      </Column>
    </Screen>
  );
}
