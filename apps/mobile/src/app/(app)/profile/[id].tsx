import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { Post, Profile } from "@/core/api/types";
import { describeError } from "@/core/lib/errors";
import { useIdentity } from "@/core/session/IdentityProvider";
import { useSession } from "@/core/session/SessionProvider";
import { usePagedList } from "@/core/usePagedList";
import { useReactions } from "@/core/useReactions";
import { spacing } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Loading } from "@/ui/Loading";
import { Notice } from "@/ui/Notice";
import { PostCard } from "@/ui/PostCard";
import { ProfileChip } from "@/ui/ProfileChip";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export default function ProfileScreen() {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const { api } = useSession();
  const { acting, profileIdFor } = useIdentity();
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

  return (
    <Screen>
      <View style={{ gap: spacing.sm }}>
        <Text variant="title">{title}</Text>
        <ProfileChip kind={profile.kind} self={profile.isSelf} />
        {!anonymous ? (
          <Text tone="muted">
            {`@${profile.handle}`}
            {profile.course ? ` · ${profile.course}` : ""}
            {profile.studyYear ? ` · Year ${profile.studyYear}` : ""}
          </Text>
        ) : null}
        <Text accessibilityLabel={`${profile.postCount} posts, ${profile.followerCount} followers, ${profile.followingCount} following`}>
          {profile.postCount} posts · {profile.followerCount} followers · {profile.followingCount} following
        </Text>
      </View>

      {!profile.isSelf ? (
        <View style={{ gap: spacing.sm }}>
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
      {error ? <Notice tone="error">{error}</Notice> : null}
      {reactions.error ? <Notice tone="error">{reactions.error}</Notice> : null}

      <Text variant="heading">Posts</Text>
      {posts.items.length === 0 && posts.state === "ready" ? <Text tone="muted">No posts yet.</Text> : null}
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
      {posts.state === "ready" && posts.items.length > 0 ? (
        <Button variant="secondary" label="Load more" onPress={() => void posts.loadMore()} />
      ) : null}
    </Screen>
  );
}
