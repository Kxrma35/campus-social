import { useCallback, useState } from "react";
import type { Post, ProfileKind } from "@/core/api/types";
import { describeError } from "@/core/lib/errors";
import type { ApiClient } from "@/core/api/client";

export function useReactions(
  api: ApiClient,
  acting: ProfileKind,
  apply: (id: string, next: Post) => void,
) {
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(
    async (post: Post) => {
      const liked = !post.viewerReacted;
      const optimistic: Post = {
        ...post,
        viewerReacted: liked,
        reactionCount: Math.max(0, post.reactionCount + (liked ? 1 : -1)),
      };
      setError(null);
      apply(post.id, optimistic);
      try {
        if (liked) await api.react({ postId: post.id }, acting);
        else await api.unreact({ postId: post.id }, acting);
      } catch (e) {
        apply(post.id, post);
        setError(describeError(e));
      }
    },
    [api, acting, apply],
  );

  return { toggle, error, clearError: () => setError(null) };
}
