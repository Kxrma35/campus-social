import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, View } from "react-native";
import type { Post, PostSort, Profile } from "@/core/api/types";
import { describeError } from "@/core/lib/errors";
import { useIdentity } from "@/core/session/IdentityProvider";
import { useSession } from "@/core/session/SessionProvider";
import { usePagedList } from "@/core/usePagedList";
import { useReactions } from "@/core/useReactions";
import { APP_NAME } from "@/theme/brand";
import { radius, spacing } from "@/theme/tokens";
import { ActingSwitcher } from "@/ui/ActingSwitcher";
import { Avatar } from "@/ui/Avatar";
import { EmptyState } from "@/ui/EmptyState";
import { FeedSkeleton } from "@/ui/FeedSkeleton";
import { Icon } from "@/ui/Icon";
import { IconButton } from "@/ui/IconButton";
import { Logomark } from "@/ui/Logomark";
import { ProfileChip } from "@/ui/ProfileChip";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { PostCard } from "@/ui/PostCard";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { StatusBanner } from "@/ui/StatusBanner";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

type Tab = "newest" | "top" | "following";
const TABS: { key: Tab; label: string }[] = [
  { key: "newest", label: "Newest" },
  { key: "top", label: "Top this week" },
  { key: "following", label: "Following" },
];

export default function FeedScreen() {
  const { api } = useSession();
  const { acting, profileIdFor, profiles } = useIdentity();
  const t = useTheme();
  const [tab, setTab] = useState<Tab>("newest");

  const list = usePagedList<Post>(
    useCallback(
      (cursor) =>
        tab === "following"
          ? api.followingFeed(cursor, acting)
          : api.feed({ sort: tab as PostSort, cursor }, acting),
      [api, tab, acting],
    ),
    `${tab}:${acting}`,
  );
  const reactions = useReactions(api, acting, (id, next) => list.replace(id, next));
  const mine = [profileIdFor("known"), profileIdFor("anonymous")];

  const [people, setPeople] = useState<Profile[]>([]);
  useEffect(() => {
    let alive = true;
    api
      .myFollowing(null, acting)
      .then((page) => alive && setPeople(page.items))
      .catch(() => alive && setPeople([]));
    return () => {
      alive = false;
    };
  }, [api, acting]);

  const header = (
    <View
      style={{
        gap: spacing.md,
        paddingTop: spacing.md,
        paddingBottom: spacing.md,
        width: "100%",
        maxWidth: 640,
        alignSelf: "center",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: spacing.lg,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Logomark size={30} />
          <Text variant="title">{APP_NAME}</Text>
        </View>
        <IconButton
          icon="bell"
          label="Notifications"
          onPress={() => router.navigate("/notifications")}
          testID="open-notifications"
        />
      </View>
      <View style={{ gap: spacing.md, paddingHorizontal: spacing.lg }}>
        <StatusBanner />
        <ActingSwitcher />
      </View>
      <Pressable
        testID="new-post"
        accessibilityRole="button"
        accessibilityLabel="Write a post"
        onPress={() => router.push("/compose")}
        style={({ pressed }) => ({
          marginHorizontal: spacing.lg,
          padding: spacing.md,
          gap: spacing.sm,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.card,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 }}>
          <Avatar
            kind={acting}
            name={acting === "known" ? profiles?.known?.handle : profiles?.anonymous?.handle}
            size="sm"
          />
          <Text tone="muted" style={{ flex: 1 }}>
            What is on your mind?
          </Text>
          <Icon name="image" color={t.textMuted} />
        </View>
        <ProfileChip kind={acting} self prefix="Posting as" />
      </Pressable>
      {tab !== "following" && people.length > 0 ? (
        <Text variant="label" style={{ paddingHorizontal: spacing.lg }}>
          People you follow
        </Text>
      ) : null}
      {tab !== "following" && people.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
          accessibilityLabel="People you follow"
        >
          {people.map((p) => (
            <Pressable
              key={p.profileId}
              accessibilityRole="button"
              accessibilityLabel={`View profile of ${p.displayName ?? p.handle}`}
              onPress={() => router.push({ pathname: "/profile/[id]", params: { id: p.profileId } })}
              style={{ alignItems: "center", gap: spacing.xs, width: 68, minHeight: 44 }}
            >
              <Avatar
                kind={p.kind}
                name={p.displayName ?? p.handle}
                size="lg"
                ringed
                profileId={p.profileId}
                hasAvatar={p.hasAvatar}
              />
              <View
                style={{
                  marginTop: -14,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 2,
                  borderRadius: radius.pill,
                  backgroundColor: t.card,
                  borderWidth: 1.5,
                  borderColor: t.text,
                }}
              >
                <Text variant="small" numberOfLines={1} style={{ maxWidth: 60, fontWeight: "600" }}>
                  {(p.displayName ?? p.handle).split(" ")[0]}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={{ paddingHorizontal: spacing.lg }}>
        <SegmentedControl
          label="Choose which posts to show"
          options={TABS}
          value={tab}
          onChange={setTab}
        />
      </View>
      {reactions.error ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <Notice tone="error">{reactions.error}</Notice>
        </View>
      ) : null}
    </View>
  );

  if (list.state === "loading" && list.items.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: t.ground }}>
        {header}
        <FeedSkeleton />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: t.ground }}
      data={list.items}
      keyExtractor={(p) => p.id}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      renderItem={({ item }) => (
        <View>
          <PostCard
            post={item}
            myProfileIds={mine}
            onOpen={(p) => router.push({ pathname: "/post/[id]", params: { id: p.id } })}
            onOpenAuthor={(p) =>
              router.push({ pathname: "/profile/[id]", params: { id: p.author.profileId } })
            }
            onToggleReaction={reactions.toggle}
            onReport={(p) =>
              router.push({
                pathname: "/report",
                params: { kind: "post", id: p.id },
              })
            }
          />
        </View>
      )}
      refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} />}
      onEndReached={() => void list.loadMore()}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        list.state === "error" ? (
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <Notice tone="error" title="Could not load posts">
              {describeError(list.error)}
            </Notice>
            <Button label="Try again" onPress={list.reload} />
          </View>
        ) : (
          <EmptyState
            title={tab === "following" ? "Nothing here yet" : "No posts yet"}
            action={
              tab === "following" ? (
                <Button variant="secondary" label="See the newest posts" onPress={() => setTab("newest")} />
              ) : (
                <Button label="Write a post" onPress={() => router.push("/compose")} />
              )
            }
          >
            {tab === "following"
              ? "Follow people from their profiles and their posts will show up here."
              : "Be the first to write one."}
          </EmptyState>
        )
      }
      ListFooterComponent={
        list.loadingMore ? <Text tone="muted" style={{ padding: spacing.lg }}>Loading more…</Text> : null
      }
    />
  );
}
