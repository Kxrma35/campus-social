import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SessionResponse } from "@/core/api/types";

export interface AuthFlow {
  email: string;
  code: string;
  /** When the current code was requested, in ms since epoch. */
  codeSentAt: number | null;
  dateOfBirth: string;
  notice: string | null;
  /** The session from a finished sign-up, held until the student taps Open. */
  pendingSession: SessionResponse | null;
  setEmail(value: string): void;
  setCode(value: string): void;
  setCodeSentAt(value: number | null): void;
  setDateOfBirth(value: string): void;
  setNotice(value: string | null): void;
  setPendingSession(value: SessionResponse | null): void;
  /** Forget everything entered so far. */
  reset(): void;
}

const Ctx = createContext<AuthFlow | null>(null);

export function AuthFlowProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: { email?: string; code?: string; dateOfBirth?: string; pendingSession?: SessionResponse };
}) {
  const [email, setEmail] = useState(initial?.email ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [codeSentAt, setCodeSentAt] = useState<number | null>(null);
  const [dateOfBirth, setDateOfBirth] = useState(initial?.dateOfBirth ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingSession, setPendingSession] = useState<SessionResponse | null>(initial?.pendingSession ?? null);

  const value = useMemo<AuthFlow>(
    () => ({
      email,
      code,
      codeSentAt,
      dateOfBirth,
      notice,
      pendingSession,
      setEmail,
      setCode,
      setCodeSentAt,
      setDateOfBirth,
      setNotice,
      setPendingSession,
      reset() {
        setEmail("");
        setCode("");
        setCodeSentAt(null);
        setDateOfBirth("");
        setNotice(null);
        setPendingSession(null);
      },
    }),
    [email, code, codeSentAt, dateOfBirth, notice, pendingSession],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuthFlow(): AuthFlow {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuthFlow must be used inside <AuthFlowProvider>");
  return v;
}
