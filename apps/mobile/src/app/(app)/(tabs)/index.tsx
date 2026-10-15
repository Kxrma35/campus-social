import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import type { Post, PostSort, Profile } from "@/core/api/types";
import { describeError } from "@/core/lib/errors";
import { useIdentity } from "@/core/session/IdentityProvider";
import { useSession } from "@/core/session/SessionProvider";
import { usePagedList } from "@/core/usePagedList";
import { useReactions } from "@/core/useReactions";
import { radius, spacing } from "@/theme/tokens";
import { ActingSwitcher } from "@/ui/ActingSwitcher";
import { Avatar } from "@/ui/Avatar";
import { Icon } from "@/ui/Icon";
import { Button } from "@/ui/Button";
import { Loading } from "@/ui/Loading";
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

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

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
    <View style={{ gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: spacing.lg,
        }}
      >
        <View style={{ flexShrink: 1 }}>
          <Text variant="heading">{greeting()}</Text>
          <Text variant="small" tone="muted">
            {todayLabel()}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          onPress={() => router.navigate("/notifications")}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: t.card,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="bell" color={t.text} size={22} />
        </Pressable>
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
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.sm,
          minHeight: 52,
          marginHorizontal: spacing.lg,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: t.border,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon name="plus" color={t.text} size={18} />
        <Text variant="label">Write a post</Text>
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
              <Avatar kind={p.kind} name={p.displayName ?? p.handle} size="lg" ringed />
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
        <Loading label="Loading posts" />
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
        <View style={{ marginHorizontal: spacing.lg, marginBottom: spacing.md }}>
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
