import { Pressable, StyleSheet, View } from "react-native";
import type { Post } from "@/core/api/types";
import { timeAgo } from "@/core/lib/time";
import { MIN_TARGET, radius, spacing } from "@/theme/tokens";
import { Button } from "./Button";
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

  const summary = `${mine ? "Your " : ""}${anonymous ? "anonymous" : ""} post by ${title}, ${when}. ${post.body}`
    .replace(/\s+/g, " ")
    .trim();

  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View profile of ${title}`}
          onPress={() => onOpenAuthor?.(post)}
          style={styles.authorBtn}
        >
          <Text variant="label">{title}</Text>
          {!anonymous ? (
            <Text variant="small" tone="muted">
              {`@${author.handle}`}
            </Text>
          ) : null}
        </Pressable>
        <ProfileChip kind={author.kind} self={mine} />
      </View>
      <Text variant="small" tone="muted">
        {when}
        {post.edited ? " · edited" : ""}
      </Text>

      <Pressable
        accessible
        accessibilityRole={onOpen && !detail ? "button" : "text"}
        accessibilityLabel={summary}
        accessibilityHint={onOpen && !detail ? "Opens the post and its comments" : undefined}
        onPress={() => onOpen?.(post)}
        disabled={!onOpen || detail}
      >
        {post.body ? <Text>{post.body}</Text> : null}
      </Pressable>

      <PostPhotos photos={post.photos} describe={`attached to a post by ${title}`} />

      <View style={styles.actions}>
        <Button
          variant="secondary"
          label={`${post.viewerReacted ? "Liked" : "Like"} (${post.reactionCount})`}
          accessibilityLabel={`${post.viewerReacted ? "Remove like" : "Like"}, ${post.reactionCount} likes`}
          onPress={() => onToggleReaction?.(post)}
        />
        {!detail ? (
          <Button
            variant="secondary"
            label={`Comments (${post.commentCount})`}
            accessibilityLabel={`Open comments, ${post.commentCount} comments`}
            onPress={() => onOpen?.(post)}
          />
        ) : null}
        {!mine ? (
          <Button
            variant="link"
            label="Report"
            accessibilityLabel={`Report this post by ${title}`}
            onPress={() => onReport?.(post)}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.sm },
  authorBtn: { flexShrink: 1, minHeight: MIN_TARGET, justifyContent: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
});
