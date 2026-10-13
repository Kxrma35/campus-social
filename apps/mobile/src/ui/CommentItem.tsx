import { StyleSheet, View } from "react-native";
import type { Comment } from "@/core/api/types";
import { timeAgo } from "@/core/lib/time";
import { radius, spacing } from "@/theme/tokens";
import { Button } from "./Button";
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
  return (
    <View style={[styles.box, { borderColor: t.border }]}>
      <View style={styles.row}>
        <Text variant="label">{title}</Text>
        <ProfileChip kind={comment.author.kind} self={mine} />
      </View>
      <Text variant="small" tone="muted">
        {when}
      </Text>
      <Text accessibilityLabel={`Comment by ${title}, ${when}. ${comment.body}`}>{comment.body}</Text>
      <View style={styles.row}>
        <Button
          variant="secondary"
          label={`${comment.viewerReacted ? "Liked" : "Like"} (${comment.reactionCount})`}
          accessibilityLabel={`${comment.viewerReacted ? "Remove like" : "Like"} on this comment, ${comment.reactionCount} likes`}
          onPress={() => onToggleReaction?.(comment)}
        />
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
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
});
