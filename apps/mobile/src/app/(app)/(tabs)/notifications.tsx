import { router } from "expo-router";
import { useCallback, useEffect } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import type { AppNotification } from "@/core/api/types";
import { describeError } from "@/core/lib/errors";
import { timeAgo } from "@/core/lib/time";
import { useIdentity } from "@/core/session/IdentityProvider";
import { useSession } from "@/core/session/SessionProvider";
import { usePagedList } from "@/core/usePagedList";
import { radius, spacing } from "@/theme/tokens";
import { ActingSwitcher } from "@/ui/ActingSwitcher";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Loading } from "@/ui/Loading";
import { EmptyState } from "@/ui/EmptyState";
import { Notice } from "@/ui/Notice";
import { authorTitle } from "@/ui/PostCard";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

function describe(n: AppNotification): string {
  const who = authorTitle(n.actor);
  switch (n.kind) {
    case "comment":
      return `${who} commented on your post`;
    case "reaction":
      return `${who} liked your ${n.commentId ? "comment" : "post"}`;
    case "follow":
      return `${who} started following you`;
  }
}

export default function NotificationsScreen() {
  const { api } = useSession();
  const { acting } = useIdentity();
  const t = useTheme();

  const list = usePagedList<AppNotification>(
    useCallback((cursor) => api.notifications(cursor, acting), [api, acting]),
    acting,
  );

  useEffect(() => {
    if (list.state === "ready" && list.items.some((n) => !n.read)) {
      void api.markNotificationsRead(acting).catch(() => undefined);
    }
  }, [list.state]);

  if (list.state === "loading" && list.items.length === 0) return <Loading label="Loading notifications" />;

  return (
    <FlatList
      style={{ backgroundColor: t.ground }}
      data={list.items}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.xxl }}
      ListHeaderComponent={
        <View style={{ padding: spacing.lg }}>
          <ActingSwitcher />
        </View>
      }
      refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} />}
      onEndReached={() => void list.loadMore()}
      renderItem={({ item }) => {
        const text = describe(item);
        const when = timeAgo(item.createdAt, undefined, { rounded: item.actor.kind === "anonymous" });
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.read ? "" : "New. "}${text}, ${when}`}
            onPress={() =>
              item.postId
                ? router.push({ pathname: "/post/[id]", params: { id: item.postId } })
                : router.push({ pathname: "/profile/[id]", params: { id: item.actor.profileId } })
            }
            style={({ pressed }) => [
              styles.row,
              { borderColor: t.hairline, backgroundColor: pressed ? t.primarySoft : t.card },
            ]}
          >
            <Avatar kind={item.actor.kind} name={item.actor.displayName ?? item.actor.handle} size="md" />
            <View style={styles.text}>
              <Text variant="body" style={item.read ? undefined : { fontWeight: "700" }}>
                {text}
              </Text>
              <Text variant="small" tone="muted">
                {item.read ? when : `New · ${when}`}
              </Text>
            </View>
          </Pressable>
        );
      }}
      ListEmptyComponent={
        list.state === "error" ? (
          <View style={{ gap: spacing.md }}>
            <Notice tone="error" title="Could not load notifications">
              {describeError(list.error)}
            </Notice>
            <Button label="Try again" onPress={list.reload} />
          </View>
        ) : (
          <EmptyState title="No notifications yet">
            {acting === "anonymous"
              ? "Replies, likes and new followers for your anonymous profile will show up here. Your known profile has its own."
              : "Replies, likes and new followers will show up here."}
          </EmptyState>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: 2 },
});
