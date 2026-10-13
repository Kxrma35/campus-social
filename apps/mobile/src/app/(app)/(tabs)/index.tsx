import { router } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import type { Post, PostSort } from "@/core/api/types";
import { describeError } from "@/core/lib/errors";
import { useIdentity } from "@/core/session/IdentityProvider";
import { useSession } from "@/core/session/SessionProvider";
import { usePagedList } from "@/core/usePagedList";
import { useReactions } from "@/core/useReactions";
import { spacing } from "@/theme/tokens";
import { ActingSwitcher } from "@/ui/ActingSwitcher";
import { Button } from "@/ui/Button";
import { Loading } from "@/ui/Loading";
import { Notice } from "@/ui/Notice";
import { PostCard } from "@/ui/PostCard";
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
  const { acting, profileIdFor } = useIdentity();
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

  const header = (
    <View style={{ gap: spacing.md, padding: spacing.lg }}>
      <StatusBanner />
      <ActingSwitcher />
      <Button label="Write a post" onPress={() => router.push("/compose")} testID="new-post" />
      <View
        accessibilityRole="tablist"
        style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}
      >
        {TABS.map((x) => (
          <Button
            key={x.key}
            variant={tab === x.key ? "primary" : "secondary"}
            label={x.label}
            accessibilityHint={tab === x.key ? "Selected" : undefined}
            onPress={() => setTab(x.key)}
          />
        ))}
      </View>
      {reactions.error ? <Notice tone="error">{reactions.error}</Notice> : null}
    </View>
  );

  if (list.state === "loading" && list.items.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: t.background }}>
        {header}
        <Loading label="Loading posts" />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: t.background }}
      data={list.items}
      keyExtractor={(p) => p.id}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: spacing.lg }}>
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
          <View style={{ padding: spacing.lg }}>
            <Text tone="muted">
              {tab === "following"
                ? "Nothing here yet. Follow people to see their posts in this tab."
                : "No posts yet. Be the first to write one."}
            </Text>
          </View>
        )
      }
      ListFooterComponent={
        list.loadingMore ? <Text tone="muted" style={{ padding: spacing.lg }}>Loading more…</Text> : null
      }
    />
  );
}
