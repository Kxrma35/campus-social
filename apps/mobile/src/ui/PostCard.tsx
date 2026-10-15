import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from "react-native";
import type { Post } from "@/core/api/types";
import { timeAgo } from "@/core/lib/time";
import { MIN_TARGET, radius, spacing } from "@/theme/tokens";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { PostPhotos } from "./PostPhotos";
import { ProfileChip } from "./ProfileChip";
import { Text } from "./Text";
import { useTheme } from "./theme";

export interface PostCardProps {
  post: Post;
  myProfileIds?: (string | null)[];
  now?: number;
  onOpen?: (post: Post) => void;
  onOpenAuthor?: (post: Post) => void;
  onToggleReaction?: (post: Post) => void;
  onReport?: (post: Post) => void;
  /** Hide the comment and open actions on the detail screen. */
  detail?: boolean;
}

export function authorTitle(a: Post["author"]): string {
  if (a.kind === "anonymous") return `@${a.handle}`;
  return a.displayName ?? `@${a.handle}`;
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => alive && setReduce(Boolean(v)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return reduce;
}

export function PostCard({
  post,
  myProfileIds = [],
  now,
  onOpen,
  onOpenAuthor,
  onToggleReaction,
  onReport,
  detail = false,
}: PostCardProps) {
  const t = useTheme();
  const { author } = post;
  const anonymous = author.kind === "anonymous";
  const mine = myProfileIds.includes(author.profileId);
  const when = timeAgo(post.createdAt, now, { rounded: anonymous });
  const title = authorTitle(author);
  const [moreOpen, setMoreOpen] = useState(false);
  const reduceMotion = useReduceMotion();
  const pop = useRef(new Animated.Value(1)).current;

  const summary = `${mine ? "Your " : ""}${anonymous ? "anonymous" : ""} post by ${title}, ${when}. ${post.body}`
    .replace(/\s+/g, " ")
    .trim();

  function like() {
    if (!reduceMotion) {
      pop.setValue(0.8);
      Animated.spring(pop, { toValue: 1, friction: 3, tension: 220, useNativeDriver: true }).start();
    }
    onToggleReaction?.(post);
  }

  const heart = post.viewerReacted ? t.primary : t.textMuted;

  return (
    <View style={[styles.post, { backgroundColor: t.card, borderColor: t.hairline }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View profile of ${title}`}
          onPress={() => onOpenAuthor?.(post)}
          style={styles.person}
        >
          <Avatar kind={author.kind} name={author.displayName ?? author.handle} size="md" />
          <View style={styles.names}>
            <Text variant="label" numberOfLines={1}>
              {title}
            </Text>
            <Text variant="small" tone="muted">
              {anonymous ? "" : `@${author.handle} · `}
              {when}
              {post.edited ? " · edited" : ""}
            </Text>
          </View>
        </Pressable>
        <ProfileChip kind={author.kind} self={mine} />
      </View>

      {post.photos.length > 0 ? (
        <View style={styles.photos}>
          <View style={styles.photoClip}>
            <PostPhotos photos={post.photos} describe={`attached to a post by ${title}`} />
          </View>
        </View>
      ) : null}

      {post.body ? (
        <Pressable
          accessible
          accessibilityRole={onOpen && !detail ? "button" : "text"}
          accessibilityLabel={summary}
          accessibilityHint={onOpen && !detail ? "Opens the post and its comments" : undefined}
          onPress={() => onOpen?.(post)}
          disabled={!onOpen || detail}
          style={styles.bodyWrap}
        >
          <Text variant={detail ? "readingLarge" : "reading"} numberOfLines={detail ? undefined : 8}>
            {post.body}
          </Text>
          {!detail && post.body.length > 400 ? (
            <Text variant="label" style={{ color: t.primary }}>
              Read more
            </Text>
          ) : null}
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${post.viewerReacted ? "Remove like" : "Like"}, ${post.reactionCount} likes`}
          onPress={like}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Animated.View style={{ transform: [{ scale: pop }] }}>
            <Icon name={post.viewerReacted ? "heartFilled" : "heart"} color={heart} />
          </Animated.View>
          <Text variant="label" style={{ color: heart }}>
            {post.reactionCount}
          </Text>
        </Pressable>

        {!detail ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open comments, ${post.commentCount} comments`}
            onPress={() => onOpen?.(post)}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Icon name="comment" color={t.textMuted} />
            <Text variant="label" tone="muted">
              {post.commentCount}
            </Text>
          </Pressable>
        ) : null}

        {!mine && onReport ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`More about this post by ${title}`}
            accessibilityState={{ expanded: moreOpen }}
            aria-expanded={moreOpen}
            onPress={() => setMoreOpen((v) => !v)}
            style={({ pressed }) => [styles.action, styles.more, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Icon name="more" color={t.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {moreOpen && !mine && onReport ? (
        <View style={[styles.moreBox, { borderTopColor: t.hairline }]}>
          <Text variant="small" tone="muted">
            A moderator reviews every report. The person who wrote this post is not told it was
            you.
          </Text>
          <Button
            variant="secondary"
            label="Report this post"
            accessibilityLabel={`Report this post by ${title}`}
            onPress={() => {
              setMoreOpen(false);
              onReport(post);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  post: {
    paddingTop: spacing.lg,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    borderRadius: radius.xl,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  photos: { paddingTop: spacing.md, paddingHorizontal: spacing.md },
  photoClip: { borderRadius: radius.lg, overflow: "hidden" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  person: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexShrink: 1, minHeight: MIN_TARGET },
  names: { flexShrink: 1 },
  bodyWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  more: { marginLeft: "auto", justifyContent: "center" },
  moreBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
});
