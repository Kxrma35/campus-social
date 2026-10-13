import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createApiClient } from "@/core/api/client";
import type { ApiClient } from "@/core/api/client";
import type { AccountStatus, SessionResponse } from "@/core/api/types";
import { apiBaseUrl } from "@/core/config";
import { defaultTokenStore } from "./tokenStore";
import type { TokenStore } from "./tokenStore";

export type SessionStatus = "loading" | "signedOut" | "signedIn";

interface SessionValue {
  status: SessionStatus;
  accountStatus: AccountStatus | null;
  api: ApiClient;
  signIn(res: SessionResponse): Promise<void>;
  signOut(): Promise<void>;
  setAccountStatus(s: AccountStatus): void;
}

const Ctx = createContext<SessionValue | null>(null);

export interface SessionProviderProps {
  children: ReactNode;
  tokenStore?: TokenStore;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function SessionProvider({
  children,
  tokenStore = defaultTokenStore,
  baseUrl,
  fetchImpl,
}: SessionProviderProps) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [accountStatus, setAccountStatusState] = useState<AccountStatus | null>(null);
  const tokenRef = useRef<string | null>(null);

  const clearLocal = useCallback(async () => {
    tokenRef.current = null;
    setAccountStatusState(null);
    await tokenStore.clear();
    setStatus("signedOut");
  }, [tokenStore]);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: baseUrl ?? apiBaseUrl(),
        getToken: () => tokenRef.current,
        onUnauthorized: () => {
          void clearLocal();
        },
        fetchImpl,
      }),
    [baseUrl, fetchImpl, clearLocal],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = await tokenStore.load();
      if (!alive) return;
      tokenRef.current = stored;
      setStatus(stored ? "signedIn" : "signedOut");
    })();
    return () => {
      alive = false;
    };
  }, [tokenStore]);

  const signIn = useCallback(
    async (res: SessionResponse) => {
      await tokenStore.save(res.sessionToken);
      tokenRef.current = res.sessionToken;
      setAccountStatusState(res.account.status);
      setStatus("signedIn");
    },
    [tokenStore],
  );

  const signOut = useCallback(async () => {
    if (tokenRef.current) {
      try {
        await api.logout();
      } catch {
        // Ignore: the local token is removed below regardless.
      }
    }
    await clearLocal();
  }, [api, clearLocal]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      accountStatus,
      api,
      signIn,
      signOut,
      setAccountStatus: setAccountStatusState,
    }),
    [status, accountStatus, api, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside <SessionProvider>");
  return v;
}

/** Shorthand for screens that only need the API client. */
export function useApi(): ApiClient {
  return useSession().api;
}
