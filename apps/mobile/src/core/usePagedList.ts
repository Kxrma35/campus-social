import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "@/core/api/types";

export type ListState = "loading" | "ready" | "error";

export function usePagedList<T extends { id: string }>(
  load: (cursor: string | null) => Promise<Page<T>>,
  key: string,
) {
  const [items, setItems] = useState<T[]>([]);
  const [state, setState] = useState<ListState>("loading");
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursor = useRef<string | null>(null);
  const hasMore = useRef(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);

  const fetchFirst = useCallback(async (isRefresh: boolean) => {
    const mine = ++generation.current;
    if (isRefresh) setRefreshing(true);
    else setState("loading");
    try {
      const page = await loadRef.current(null);
      if (mine !== generation.current) return;
      cursor.current = page.nextCursor;
      hasMore.current = page.nextCursor !== null;
      setItems(page.items);
      setError(null);
      setState("ready");
    } catch (e) {
      if (mine !== generation.current) return;
      setError(e);
      setState("error");
    } finally {
      if (mine === generation.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchFirst(false);
  }, [key, fetchFirst]);

  const loadMore = useCallback(async () => {
    if (!hasMore.current || loadingMore || state !== "ready") return;
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const page = await loadRef.current(cursor.current);
      if (mine !== generation.current) return;
      cursor.current = page.nextCursor;
      hasMore.current = page.nextCursor !== null;
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
      });
    } catch (e) {
      setError(e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, state]);

  const replace = useCallback((id: string, next: T | null) => {
    setItems((prev) =>
      next === null ? prev.filter((i) => i.id !== id) : prev.map((i) => (i.id === id ? next : i)),
    );
  }, []);

  return {
    items,
    state,
    error,
    refreshing,
    loadingMore,
    refresh: () => fetchFirst(true),
    reload: () => fetchFirst(false),
    loadMore,
    replace,
  };
}
