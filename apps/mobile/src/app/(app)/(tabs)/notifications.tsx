import { router } from "expo-router";
import { useCallback, useEffect } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import type { AppNotification } from "@/core/api/types";
import { describeError } from "@/core/lib/errors";
import { timeAgo } from "@/core/lib/time";
import { useIdentity } from "@/core/session/IdentityProvider";
import { useSession } from "@/core/session/SessionProvider";
import { usePagedList } from "@/core/usePagedList";
import { spacing } from "@/theme/tokens";
import { ActingSwitcher } from "@/ui/ActingSwitcher";
import { Button } from "@/ui/Button";
import { Loading } from "@/ui/Loading";
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
      style={{ backgroundColor: t.background }}
      data={list.items}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      ListHeaderComponent={<ActingSwitcher />}
      refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} />}
      onEndReached={() => void list.loadMore()}
      renderItem={({ item }) => {
        const text = describe(item);
        const when = timeAgo(item.createdAt, undefined, { rounded: item.actor.kind === "anonymous" });
        return (
          <Button
            variant="secondary"
            label={`${item.read ? "" : "New: "}${text} · ${when}`}
            accessibilityLabel={`${item.read ? "" : "New. "}${text}, ${when}`}
            onPress={() =>
              item.postId
                ? router.push({ pathname: "/post/[id]", params: { id: item.postId } })
                : router.push({ pathname: "/profile/[id]", params: { id: item.actor.profileId } })
            }
          />
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
          <Text tone="muted">Nothing yet. You will see replies, likes and new followers here.</Text>
        )
      }
    />
  );
}
