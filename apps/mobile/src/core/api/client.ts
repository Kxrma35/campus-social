import type {
  AccountStatus,
  AppNotification,
  Comment,
  KnownProfileDetails,
  MyProfiles,
  Page,
  Post,
  PostSort,
  Profile,
  ProfileKind,
  ReportReason,
  ReportTargetKind,
  SessionResponse,
  SignupInput,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: string[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NetworkError extends Error {
  constructor(message = "Could not reach the server.") {
    super(message);
    this.name = "NetworkError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => string | null;
  /** Called when an authenticated request is answered with 401. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  actingAs?: ProfileKind;
  auth?: boolean;
  rawBody?: { data: Blob; contentType: string };
}

function withQuery(path: string, query?: RequestOptions["query"]): string {
  if (!query) return path;
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `${path}?${parts.join("&")}` : path;
}

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  async function request<T>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    const useAuth = o.auth !== false;
    const token = useAuth ? opts.getToken() : null;
    if (token) headers.authorization = `Bearer ${token}`;
    if (o.actingAs && o.actingAs !== "known") headers["x-acting-as"] = o.actingAs;

    let body: BodyInit | undefined;
    if (o.rawBody) {
      headers["content-type"] = o.rawBody.contentType;
      body = o.rawBody.data;
    } else if (o.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(o.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${withQuery(path, o.query)}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch {
      throw new NetworkError();
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 204) return undefined as T;

    let payload: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!res.ok) {
      const p = payload as { error?: string; message?: string; fields?: string[] } | null;
      if (res.status === 401 && useAuth && token) opts.onUnauthorized?.();
      throw new ApiError(
        res.status,
        p?.error ?? "unknown_error",
        p?.message ?? "Something went wrong.",
        p?.fields,
      );
    }
    return payload as T;
  }

  const idPath = (prefix: string, id: string, suffix = "") =>
    `${prefix}/${encodeURIComponent(id)}${suffix}`;

  return {
    requestSignupCode: (email: string) =>
      request<{ status: string }>("POST", "/auth/signup/request", { body: { email }, auth: false }),
    verifySignup: (input: SignupInput) =>
      request<SessionResponse>("POST", "/auth/signup/verify", { body: input, auth: false }),
    requestLoginCode: (email: string) =>
      request<{ status: string }>("POST", "/auth/login/request", { body: { email }, auth: false }),
    verifyLogin: (email: string, code: string, deviceLabel?: string) =>
      request<SessionResponse>("POST", "/auth/login/verify", {
        body: { email, code, deviceLabel: deviceLabel ?? null },
        auth: false,
      }),
    requestAppealCode: (email: string) =>
      request<{ status: string }>("POST", "/appeals/request", { body: { email }, auth: false }),
    submitAppeal: (email: string, code: string, message: string) =>
      request<{ status: string }>("POST", "/appeals/submit", {
        body: { email, code, message },
        auth: false,
      }),
    logout: () => request<void>("POST", "/auth/logout"),

    me: () =>
      request<{ account: { id: string; status: AccountStatus }; profile: { id: string } }>(
        "GET",
        "/me",
      ),
    myProfiles: () => request<MyProfiles>("GET", "/me/profiles"),
    myFollowing: (cursor?: string | null, actingAs?: ProfileKind) =>
      request<Page<Profile>>("GET", "/me/following", {
        query: { cursor: cursor ?? undefined },
        actingAs,
      }),
    knownProfile: () => request<KnownProfileDetails>("GET", "/me/profile"),
    updateKnownProfile: (patch: {
      displayName?: string;
      course?: string | null;
      studyYear?: number | null;
    }) => request<KnownProfileDetails>("PATCH", "/me/profile", { body: patch }),
    createAnonymousProfile: () =>
      request<{ profile: { profileId: string; handle: string; avatarKey: string }; notice: string }>(
        "POST",
        "/profiles/anonymous",
        { body: { acknowledged: true } },
      ),

    feed: (q: { sort?: PostSort; cursor?: string | null }, actingAs?: ProfileKind) =>
      request<Page<Post>>("GET", "/feed", {
        query: { sort: q.sort, cursor: q.cursor ?? undefined },
        actingAs,
      }),
    followingFeed: (cursor: string | null | undefined, actingAs?: ProfileKind) =>
      request<Page<Post>>("GET", "/feed/following", {
        query: { cursor: cursor ?? undefined },
        actingAs,
      }),
    post: (id: string, actingAs?: ProfileKind) =>
      request<Post>("GET", idPath("/posts", id), { actingAs }),
    createPost: (
      input: {
        body: string;
        photoIds?: string[];
        /** Upload id to description. Only for photos in photoIds. */
        altTexts?: Record<string, string>;
        confirmedAnonymous?: boolean;
      },
      actingAs: ProfileKind,
    ) => request<Post>("POST", "/posts", { body: input, actingAs }),
    editPost: (id: string, body: string, actingAs?: ProfileKind) =>
      request<Post>("PATCH", idPath("/posts", id), { body: { body }, actingAs }),
    deletePost: (id: string, actingAs?: ProfileKind) =>
      request<void>("DELETE", idPath("/posts", id), { actingAs }),
    uploadPhoto: (data: Blob, contentType: string, actingAs?: ProfileKind) =>
      request<{ id: string; width: number; height: number }>("POST", "/photos", {
        rawBody: { data, contentType },
        actingAs,
      }),

    setPhotoAltText: (id: string, altText: string | null, actingAs?: ProfileKind) =>
      request<{ id: string; altText: string | null }>("PATCH", idPath("/photos", id), {
        body: { altText },
        actingAs,
      }),

    comments: (postId: string, cursor?: string | null, actingAs?: ProfileKind) =>
      request<Page<Comment>>("GET", idPath("/posts", postId, "/comments"), {
        query: { cursor: cursor ?? undefined },
        actingAs,
      }),
    createComment: (postId: string, body: string, actingAs: ProfileKind) =>
      request<Comment>("POST", idPath("/posts", postId, "/comments"), {
        body: { body },
        actingAs,
      }),
    deleteComment: (id: string, actingAs?: ProfileKind) =>
      request<void>("DELETE", idPath("/comments", id), { actingAs }),
    react: (target: { postId: string } | { commentId: string }, actingAs: ProfileKind) =>
      "postId" in target
        ? request<void>("PUT", idPath("/posts", target.postId, "/reaction"), { actingAs })
        : request<void>("PUT", idPath("/comments", target.commentId, "/reaction"), { actingAs }),
    unreact: (target: { postId: string } | { commentId: string }, actingAs: ProfileKind) =>
      "postId" in target
        ? request<void>("DELETE", idPath("/posts", target.postId, "/reaction"), { actingAs })
        : request<void>("DELETE", idPath("/comments", target.commentId, "/reaction"), { actingAs }),

    profile: (id: string, actingAs?: ProfileKind) =>
      request<Profile>("GET", idPath("/profiles", id), { actingAs }),
    profilePosts: (id: string, cursor?: string | null, actingAs?: ProfileKind) =>
      request<Page<Post>>("GET", idPath("/profiles", id, "/posts"), {
        query: { cursor: cursor ?? undefined },
        actingAs,
      }),
    follow: (id: string, actingAs: ProfileKind) =>
      request<void>("PUT", idPath("/profiles", id, "/follow"), { actingAs }),
    unfollow: (id: string, actingAs: ProfileKind) =>
      request<void>("DELETE", idPath("/profiles", id, "/follow"), { actingAs }),

    notifications: (cursor?: string | null, actingAs?: ProfileKind) =>
      request<Page<AppNotification>>("GET", "/notifications", {
        query: { cursor: cursor ?? undefined },
        actingAs,
      }),
    markNotificationsRead: (actingAs?: ProfileKind) =>
      request<{ marked: number }>("POST", "/notifications/read", { actingAs }),
    report: (
      input: {
        targetKind: ReportTargetKind;
        targetId: string;
        reason: ReportReason;
        detail?: string | null;
      },
      actingAs: ProfileKind,
    ) => request<{ status: string }>("POST", "/reports", { body: input, actingAs }),

    requestReverify: () => request<{ status: string }>("POST", "/account/reverify/request"),
    verifyReverify: (code: string) =>
      request<{ status: string; reverifyDueAt: string }>("POST", "/account/reverify/verify", {
        body: { code },
      }),
    requestClose: () => request<{ status: string }>("POST", "/account/close/request"),
    confirmClose: (code: string) => request<void>("POST", "/account/close/confirm", { body: { code } }),
    exportData: () => request<unknown>("GET", "/account/export"),

    photoRequest(path: string): { uri: string; headers: Record<string, string> } {
      const token = opts.getToken();
      return {
        uri: `${opts.baseUrl}${path}`,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      };
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
