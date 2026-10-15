import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface AuthFlow {
  email: string;
  code: string;
  setEmail(value: string): void;
  setCode(value: string): void;
  reset(): void;
}

const Ctx = createContext<AuthFlow | null>(null);

export function AuthFlowProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: { email?: string; code?: string };
}) {
  const [email, setEmail] = useState(initial?.email ?? "");
  const [code, setCode] = useState(initial?.code ?? "");

  const value = useMemo<AuthFlow>(
    () => ({
      email,
      code,
      setEmail,
      setCode,
      reset() {
        setEmail("");
        setCode("");
      },
    }),
    [email, code],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuthFlow(): AuthFlow {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuthFlow must be used inside <AuthFlowProvider>");
  return v;
}
