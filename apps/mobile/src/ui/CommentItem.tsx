import { Pressable, StyleSheet, View } from "react-native";
import type { Comment } from "@/core/api/types";
import { timeAgo } from "@/core/lib/time";
import { spacing } from "@/theme/tokens";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { authorTitle } from "./PostCard";
import { ProfileChip } from "./ProfileChip";
import { Text } from "./Text";
import { useTheme } from "./theme";

export function CommentItem({
  comment,
  mine,
  now,
  onToggleReaction,
  onReport,
  onDelete,
}: {
  comment: Comment;
  mine: boolean;
  now?: number;
  onToggleReaction?: (c: Comment) => void;
  onReport?: (c: Comment) => void;
  onDelete?: (c: Comment) => void;
}) {
  const t = useTheme();
  const anonymous = comment.author.kind === "anonymous";
  const title = authorTitle({ ...comment.author });
  const when = timeAgo(comment.createdAt, now, { rounded: anonymous });
  const heart = comment.viewerReacted ? t.primary : t.textMuted;
  return (
    <View style={[styles.box, { borderBottomColor: t.hairline }]}>
      <Avatar kind={comment.author.kind} name={comment.author.displayName ?? comment.author.handle} size="sm" />
      <View style={styles.main}>
        <View style={styles.row}>
          <Text variant="label">{title}</Text>
          <ProfileChip kind={comment.author.kind} self={mine} />
        </View>
        <Text variant="small" tone="muted">
          {when}
        </Text>
        <Text accessibilityLabel={`Comment by ${title}, ${when}. ${comment.body}`}>{comment.body}</Text>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${comment.viewerReacted ? "Remove like" : "Like"} on this comment, ${comment.reactionCount} likes`}
            onPress={() => onToggleReaction?.(comment)}
            style={styles.action}
          >
            <Icon name={comment.viewerReacted ? "heartFilled" : "heart"} size={20} color={heart} />
            <Text variant="label" style={{ color: heart }}>
              {comment.reactionCount}
            </Text>
          </Pressable>
          {mine ? (
            <Button
              variant="link"
              label="Delete"
              accessibilityLabel="Delete your comment"
              onPress={() => onDelete?.(comment)}
            />
          ) : (
            <Button
              variant="link"
              label="Report"
              accessibilityLabel={`Report this comment by ${title}`}
              onPress={() => onReport?.(comment)}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  main: { flex: 1, gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
    minWidth: 44,
    paddingRight: spacing.sm,
  },
});
