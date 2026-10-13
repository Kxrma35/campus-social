import { act, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { SessionProvider, useSession } from "@/core/session/SessionProvider";
import type { TokenStore } from "@/core/session/tokenStore";

function memoryStore(initial: string | null = null) {
  let token = initial;
  const store: TokenStore & { current(): string | null } = {
    load: async () => token,
    save: async (t) => {
      token = t;
    },
    clear: async () => {
      token = null;
    },
    current: () => token,
  };
  return store;
}

let latest: ReturnType<typeof useSession> | null = null;
function Probe() {
  latest = useSession();
  return <Text testID="status">{latest.status}</Text>;
}

const SESSION = {
  sessionToken: "tok_new",
  expiresAt: "2027-01-01T00:00:00Z",
  account: { id: "a1", status: "active" as const },
  profile: { id: "p1" },
};

describe("SessionProvider", () => {
  beforeEach(() => {
    latest = null;
  });

  it("starts loading, then signed out when nothing is stored", async () => {
    await render(
      <SessionProvider tokenStore={memoryStore(null)} fetchImpl={jest.fn() as never}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("signedOut"));
  });

  it("restores a stored session", async () => {
    await render(
      <SessionProvider tokenStore={memoryStore("tok_saved")} fetchImpl={jest.fn() as never}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("signedIn"));
  });

  it("saves the token on sign-in and uses it for API calls", async () => {
    const store = memoryStore(null);
    const fetchImpl = jest.fn(async () => ({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ account: { id: "a1", status: "active" }, profile: { id: "p1" } }),
    })) as unknown as typeof fetch;

    await render(
      <SessionProvider tokenStore={store} baseUrl="https://api.test" fetchImpl={fetchImpl}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(latest?.status).toBe("signedOut"));

    await act(async () => {
      await latest!.signIn(SESSION);
    });
    expect(store.current()).toBe("tok_new");
    expect(latest!.status).toBe("signedIn");
    expect(latest!.accountStatus).toBe("active");

    await act(async () => {
      await latest!.api.me();
    });
    const init = (fetchImpl as unknown as jest.Mock).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok_new");
  });

  it("signs out locally even if the server cannot be reached", async () => {
    const store = memoryStore("tok_saved");
    const fetchImpl = jest.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    await render(
      <SessionProvider tokenStore={store} baseUrl="https://api.test" fetchImpl={fetchImpl}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(latest?.status).toBe("signedIn"));

    await act(async () => {
      await latest!.signOut();
    });
    expect(latest!.status).toBe("signedOut");
    expect(store.current()).toBeNull();
  });

  it("signs out when the server says the session has expired", async () => {
    const store = memoryStore("tok_saved");
    const fetchImpl = jest.fn(async () => ({
      status: 401,
      ok: false,
      text: async () => JSON.stringify({ error: "unauthorized", message: "Sign in to continue." }),
    })) as unknown as typeof fetch;

    await render(
      <SessionProvider tokenStore={store} baseUrl="https://api.test" fetchImpl={fetchImpl}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(latest?.status).toBe("signedIn"));

    await act(async () => {
      await latest!.api.feed({}).catch(() => undefined);
    });
    await waitFor(() => expect(latest!.status).toBe("signedOut"));
    expect(store.current()).toBeNull();
  });

  it("keeps nothing but the token in storage", async () => {
    const saved: Record<string, string> = {};
    const store: TokenStore = {
      load: async () => null,
      save: async (t) => {
        saved.token = t;
      },
      clear: async () => undefined,
    };
    await render(
      <SessionProvider tokenStore={store} fetchImpl={jest.fn() as never}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(latest?.status).toBe("signedOut"));
    await act(async () => {
      await latest!.signIn(SESSION);
    });
    expect(Object.keys(saved)).toEqual(["token"]);
  });
});
