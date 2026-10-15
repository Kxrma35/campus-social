import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { AuthFlowProvider } from "@/core/authFlow";
import { IdentityProvider } from "@/core/session/IdentityProvider";
import { SessionProvider } from "@/core/session/SessionProvider";
import type { TokenStore } from "@/core/session/tokenStore";
import { ThemeProvider } from "@/ui/theme";

export function memoryTokenStore(initial: string | null = "tok_test"): TokenStore {
  let token = initial;
  return {
    load: async () => token,
    save: async (t) => {
      token = t;
    },
    clear: async () => {
      token = null;
    },
  };
}

export function mockFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  const calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({
      method,
      path,
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const key = `${method} ${path.split("?")[0]}`;
    const r = routes[key] ?? { status: 404, body: { error: "not_found", message: "Not found." } };
    const status = r.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => (r.body === undefined ? "" : JSON.stringify(r.body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

export async function renderApp(
  ui: ReactElement,
  opts: {
    fetchImpl?: typeof fetch;
    token?: string | null;
    scheme?: "light" | "dark";
    identity?: boolean;
    authFlow?: {
      email?: string;
      code?: string;
      dateOfBirth?: string;
      pendingSession?: import("@/core/api/types").SessionResponse;
    };
  } = {},
) {
  return render(
    <ThemeProvider scheme={opts.scheme ?? "light"}>
      <SessionProvider
        tokenStore={memoryTokenStore(opts.token === undefined ? "tok_test" : opts.token)}
        baseUrl="https://api.test"
        fetchImpl={opts.fetchImpl ?? (jest.fn() as never)}
      >
        <AuthFlowProvider initial={opts.authFlow}>
          {opts.identity ? <IdentityProvider>{ui}</IdentityProvider> : ui}
        </AuthFlowProvider>
      </SessionProvider>
    </ThemeProvider>,
  );
}

export const author = (over: Partial<import("@/core/api/types").Author> = {}) => ({
  profileId: "prof-1",
  kind: "known" as const,
  handle: "jane_doe_4821",
  displayName: "Jane Doe",
  hasAvatar: false,
  ...over,
});

export const post = (over: Partial<import("@/core/api/types").Post> = {}) => ({
  id: "post-1",
  author: author(),
  body: "Hello campus",
  photos: [],
  createdAt: "2026-10-12T08:00:00.000Z",
  edited: false,
  reactionCount: 2,
  commentCount: 1,
  viewerReacted: false,
  ...over,
});
