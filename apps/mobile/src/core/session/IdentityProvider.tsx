import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { MyProfiles, ProfileKind } from "@/core/api/types";
import { useSession } from "./SessionProvider";

interface IdentityValue {
  /** Null until loaded. */
  profiles: MyProfiles | null;
  acting: ProfileKind;
  setActing(k: ProfileKind): void;
  refresh(): Promise<void>;
  canUseAnonymous: boolean;
  profileIdFor(kind: ProfileKind): string | null;
}

const Ctx = createContext<IdentityValue | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const { status, api } = useSession();
  const [profiles, setProfiles] = useState<MyProfiles | null>(null);
  const [acting, setActing] = useState<ProfileKind>("known");

  const refresh = useCallback(async () => {
    try {
      setProfiles(await api.myProfiles());
    } catch {
    }
  }, [api]);

  useEffect(() => {
    if (status === "signedIn") {
      void refresh();
    } else {
      // Always start from the known profile after signing in again.
      setProfiles(null);
      setActing("known");
    }
  }, [status, refresh]);

  const canUseAnonymous = profiles?.anonymous != null;

  useEffect(() => {
    if (acting === "anonymous" && profiles && !canUseAnonymous) setActing("known");
  }, [acting, profiles, canUseAnonymous]);

  const value = useMemo<IdentityValue>(
    () => ({
      profiles,
      acting,
      setActing,
      refresh,
      canUseAnonymous,
      profileIdFor: (kind) =>
        kind === "anonymous"
          ? (profiles?.anonymous?.profileId ?? null)
          : (profiles?.known.profileId ?? null),
    }),
    [profiles, acting, refresh, canUseAnonymous],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIdentity(): IdentityValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useIdentity must be used inside <IdentityProvider>");
  return v;
}
