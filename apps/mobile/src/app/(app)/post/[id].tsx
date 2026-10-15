import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { Comment, Post } from "@/core/api/types";
import { describeError } from "@/core/lib/errors";
import { MAX_COMMENT_LENGTH } from "@/core/lib/validation";
import { useIdentity } from "@/core/session/IdentityProvider";
import { useSession } from "@/core/session/SessionProvider";
import { usePagedList } from "@/core/usePagedList";
import { useReactions } from "@/core/useReactions";
import { spacing } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { CommentItem } from "@/ui/CommentItem";
import { Loading } from "@/ui/Loading";
import { Notice } from "@/ui/Notice";
import { PhotoDescriptions } from "@/ui/PhotoDescriptions";
import { PostCard } from "@/ui/PostCard";
import { PostEditor } from "@/ui/PostEditor";
import { ProfileChip } from "@/ui/ProfileChip";
import { Screen } from "@/ui/Screen";
import { SupportPanel } from "@/ui/SupportPanel";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export default function PostScreen() {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const { api } = useSession();
  const { acting, profileIdFor } = useIdentity();

  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [support, setSupport] = useState<Comment["support"] | null>(null);
  const [editSupport, setEditSupport] = useState<Post["support"] | null>(null);

  const mine = [profileIdFor("known"), profileIdFor("anonymous")];

  useEffect(() => {
    let alive = true;
    setPost(null);
    api
      .post(id, acting)
      .then((p) => alive && setPost(p))
      .catch((e) => alive && setError(describeError(e)));
    return () => {
      alive = false;
    };
  }, [api, id, acting]);

  const comments = usePagedList<Comment>(
    useCallback((cursor) => api.comments(id, cursor, acting), [api, id, acting]),
    `${id}:${acting}`,
  );

  const reactions = useReactions(api, acting, (_id, next) => setPost(next));

  async function sendComment() {
    const text = draft.trim();
    if (!text) {
      setCommentError("Write a comment first.");
      return;
    }
    setSending(true);
    setCommentError(null);
    try {
      const c = await api.createComment(id, text, acting);
      setDraft("");
      if (c.support) setSupport(c.support);
      await comments.reload();
      setPost((p) => (p ? { ...p, commentCount: p.commentCount + 1 } : p));
    } catch (e) {
      setCommentError(describeError(e));
    } finally {
      setSending(false);
    }
  }

  async function toggleCommentLike(c: Comment) {
    const liked = !c.viewerReacted;
    comments.replace(c.id, {
      ...c,
      viewerReacted: liked,
      reactionCount: Math.max(0, c.reactionCount + (liked ? 1 : -1)),
    });
    try {
      if (liked) await api.react({ commentId: c.id }, acting);
      else await api.unreact({ commentId: c.id }, acting);
    } catch (e) {
      comments.replace(c.id, c);
      setCommentError(describeError(e));
    }
  }

  async function deleteComment(c: Comment) {
    try {
      await api.deleteComment(c.id, acting);
      comments.replace(c.id, null);
    } catch (e) {
      setCommentError(describeError(e));
    }
  }

  async function saveBody(text: string) {
    if (!post) return;
    const updated = await api.editPost(post.id, text, post.author.kind);
    const { support: crisis, ...view } = updated;
    setPost(view);
    if (crisis) setEditSupport(crisis);
  }

  async function saveDescription(photoId: string, altText: string | null) {
    if (!post) return;
    const saved = await api.setPhotoAltText(photoId, altText, post.author.kind);
    setPost((p) =>
      p
        ? { ...p, photos: p.photos.map((x) => (x.id === photoId ? { ...x, altText: saved.altText } : x)) }
        : p,
    );
  }

  async function deletePost() {
    try {
      await api.deletePost(id, acting);
      router.back();
    } catch (e) {
      setError(describeError(e));
    }
  }

  if (error && !post) {
    return (
      <Screen>
        <Notice tone="error" title="Could not open this post">
          {error}
        </Notice>
      </Screen>
    );
  }
  if (!post) return <Loading label="Loading post" />;

  const isMine = mine.includes(post.author.profileId);

  return (
    <Screen>
      <PostCard
        detail
        post={post}
        myProfileIds={mine}
        onOpenAuthor={(p) =>
          router.push({ pathname: "/profile/[id]", params: { id: p.author.profileId } })
        }
        onToggleReaction={reactions.toggle}
        onReport={(p) => router.push({ pathname: "/report", params: { kind: "post", id: p.id } })}
      />
      {isMine ? <PostEditor body={post.body} onSave={saveBody} /> : null}
      {editSupport ? <SupportPanel support={editSupport} onDone={() => setEditSupport(null)} /> : null}
      {isMine ? <PhotoDescriptions photos={post.photos} onSave={saveDescription} /> : null}
      {isMine ? <Button variant="danger" label="Delete this post" onPress={deletePost} /> : null}
      {reactions.error ? <Notice tone="error">{reactions.error}</Notice> : null}

      <Text variant="heading">Comments</Text>
      {comments.items.length === 0 && comments.state === "ready" ? (
        <Text tone="muted">No comments yet.</Text>
      ) : null}
      {comments.items.map((c) => (
        <CommentItem
          key={c.id}
          comment={c}
          mine={mine.includes(c.author.profileId)}
          onToggleReaction={toggleCommentLike}
          onDelete={deleteComment}
          onReport={(x) => router.push({ pathname: "/report", params: { kind: "comment", id: x.id } })}
        />
      ))}
      {comments.state === "error" ? (
        <Notice tone="error" title="Could not load comments">
          {describeError(comments.error)}
        </Notice>
      ) : null}

      {support ? (
        <SupportPanel support={support} onDone={() => setSupport(null)} />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <ProfileChip kind={acting} self prefix="Commenting as" />
          <TextField
            label="Add a comment"
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={MAX_COMMENT_LENGTH}
            error={commentError}
            testID="comment-input"
          />
          <Button label="Post comment" onPress={sendComment} busy={sending} testID="send-comment" />
        </View>
      )}
    </Screen>
  );
}
