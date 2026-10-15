import { randomInt } from "node:crypto";
import { ApiError } from "../errors.js";
import { generateCode, hashCode, hashEmail, hashToken, newToken } from "./crypto.js";
import type { Mailer } from "./mailer.js";
import {
  checkAge,
  emailDomain,
  checkHandle,
  handleBase,
  normalizeEmail,
  reverifyDueAt,
} from "./rules.js";
import type { AccountStatus, AuthStore, CodePurpose } from "./store.js";

export class AuthError extends ApiError {}

export interface AuthOptions {
  codeHmacKey: string;
  codeTtlMinutes: number;
  maxCodesPerHour: number;
  /** Wrong guesses allowed against one code before it is locked. */
  maxCodeAttempts: number;
  sessionTtlDays: number;
  termsVersion: string;
}

export interface SignupVerifyInput {
  email: string;
  code: string;
  dateOfBirth: string;
  displayName: string;
  handle?: string | null;
  course?: string | null;
  studyYear?: number | null;
  deviceLabel?: string | null;
}

export interface SessionResult {
  sessionToken: string;
  expiresAt: string;
  account: { id: string; status: AccountStatus };
  profile: { id: string };
}

export interface AuthContext {
  accountId: string;
  email: string;
  knownProfileId: string;
  status: AccountStatus;
}

const HANDLE_RETRIES = 5;

export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly mailer: Mailer,
    private readonly opts: AuthOptions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async requestSignup(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const domain = emailDomain(email);
    const university = domain ? await this.store.findUniversityByDomain(domain) : null;
    if (!university || !university.active) {
      throw new AuthError(
        "university_not_supported",
        422,
        "This email address is not from a supported university.",
      );
    }

    if (await this.store.isEmailBanned(hashEmail(email))) return;

    if (await this.store.findAccountByEmail(email)) {
      await this.mailer.sendAlreadyRegistered(email);
      return;
    }

    await this.issueCode(email, "signup");
  }

  async verifySignup(input: SignupVerifyInput): Promise<SessionResult> {
    const email = normalizeEmail(input.email);
    const now = this.now();

    const domain = emailDomain(email);
    const university = domain ? await this.store.findUniversityByDomain(domain) : null;
    if (!university || !university.active) {
      throw new AuthError("university_not_supported", 422, "Unsupported university.");
    }

    const age = checkAge(input.dateOfBirth, now);
    if (age === "invalid") {
      throw new AuthError("invalid_date_of_birth", 422, "Enter a valid date of birth.");
    }
    if (age === "under_18") {
      throw new AuthError("must_be_18", 403, "You must be 18 or older to use this app.");
    }

    let chosen: string | null = null;
    if (input.handle) {
      const checked = checkHandle(input.handle);
      if (!checked.ok) throw new AuthError("invalid_handle", 422, checked.reason);
      if (await this.store.isHandleTaken(university.id, checked.handle)) {
        throw new AuthError("handle_taken", 409, "That handle is already taken. Choose another.");
      }
      chosen = checked.handle;
    }

    await this.consume(email, "signup", input.code);

    const base = handleBase(input.displayName);
    for (let i = 0; i < (chosen ? 1 : HANDLE_RETRIES); i += 1) {
      const handle = chosen ?? `${base}_${randomInt(1000, 10_000)}`;
      const created = await this.store.createAccountWithKnownProfile({
        universityId: university.id,
        email,
        dateOfBirth: input.dateOfBirth,
        termsVersion: this.opts.termsVersion,
        now,
        reverifyDueAt: reverifyDueAt(now),
        profile: {
          handle,
          displayName: input.displayName.trim(),
          course: input.course?.trim() || null,
          studyYear: input.studyYear ?? null,
        },
      });

      if (created.kind === "created") {
        const session = await this.openSession(created.accountId, input.deviceLabel ?? null);
        return {
          ...session,
          account: { id: created.accountId, status: "active" },
          profile: { id: created.profileId },
        };
      }
      if (created.kind === "email_taken") {
        throw new AuthError("account_exists", 409, "An account already exists for this email.");
      }
      if (chosen) throw new AuthError("handle_taken", 409, "That handle is already taken. Choose another.");
      // handle_taken: try another suffix
    }
    throw new AuthError("try_again", 503, "Could not create the account. Please try again.");
  }

  async requestLogin(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const account = await this.store.findAccountByEmail(email);
    if (!account || account.status === "banned" || account.status === "closed") return;
    await this.issueCode(email, "login");
  }

  async verifyLogin(rawEmail: string, code: string, deviceLabel?: string | null): Promise<SessionResult> {
    const email = normalizeEmail(rawEmail);
    await this.consume(email, "login", code);

    const account = await this.store.findAccountByEmail(email);
    if (!account || account.status === "banned" || account.status === "closed") {
      throw new AuthError("invalid_code", 400, "That code is not valid.");
    }
    if (account.status === "suspended") {
      throw new AuthError("account_suspended", 403, "This account is suspended.");
    }

    const session = await this.openSession(account.id, deviceLabel ?? null);
    const ctx = await this.authenticate(session.sessionToken);
    return {
      ...session,
      account: { id: account.id, status: account.status },
      profile: { id: ctx.knownProfileId },
    };
  }

  async requestAppeal(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const account = await this.store.findAccountByEmail(email);
    if (!account || account.status !== "banned") return;
    await this.issueCode(email, "appeal");
  }

  async submitAppeal(rawEmail: string, code: string, message: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const text = message.trim();
    if (text.length === 0 || text.length > 2000) {
      throw new AuthError("invalid_message", 422, "Write your appeal in 1 to 2000 characters.");
    }

    await this.consume(email, "appeal", code);

    const account = await this.store.findAccountByEmail(email);
    if (!account || account.status !== "banned") {
      throw new AuthError("invalid_code", 400, "That code is not valid.");
    }
    const result = await this.store.createAppeal({
      accountId: account.id,
      message: text,
      now: this.now(),
    });
    if (result === "exists") {
      throw new AuthError("already_appealed", 409, "An appeal has already been submitted.");
    }
  }

  async authenticate(token: string): Promise<AuthContext> {
    const row = await this.store.findSession(hashToken(token), this.now());
    if (!row || row.status === "banned" || row.status === "closed" || row.status === "suspended") {
      throw new AuthError("unauthorized", 401, "Sign in to continue.");
    }
    return {
      accountId: row.accountId,
      email: row.email,
      knownProfileId: row.knownProfileId,
      status: row.status,
    };
  }

  async logout(token: string): Promise<void> {
    await this.store.revokeSession(hashToken(token), this.now());
  }

  async issueCode(email: string, purpose: CodePurpose): Promise<void> {
    const now = this.now();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    if ((await this.store.countCodesSince(email, hourAgo)) >= this.opts.maxCodesPerHour) {
      throw new AuthError("too_many_requests", 429, "Too many codes requested. Try again later.");
    }

    const code = generateCode();
    await this.store.createCode({
      email,
      codeHash: hashCode(this.opts.codeHmacKey, email, code),
      purpose,
      expiresAt: new Date(now.getTime() + this.opts.codeTtlMinutes * 60 * 1000),
      now,
    });
    await this.mailer.sendCode(email, code, purpose, this.opts.codeTtlMinutes);
  }

  async consume(email: string, purpose: CodePurpose, code: string): Promise<void> {
    const outcome = await this.store.consumeCode({
      email,
      purpose,
      codeHash: hashCode(this.opts.codeHmacKey, email, code),
      now: this.now(),
      maxAttempts: this.opts.maxCodeAttempts,
    });
    if (outcome === "ok") return;
    if (outcome === "expired") {
      throw new AuthError("code_expired", 400, "That code has expired. Request a new one.");
    }
    if (outcome === "too_many_attempts") {
      throw new AuthError("too_many_attempts", 429, "Too many wrong codes. Request a new one.");
    }
    throw new AuthError("invalid_code", 400, "That code is not valid.");
  }

  private async openSession(accountId: string, deviceLabel: string | null) {
    const now = this.now();
    const token = newToken();
    const expiresAt = new Date(now.getTime() + this.opts.sessionTtlDays * 24 * 60 * 60 * 1000);
    await this.store.createSession({
      accountId,
      tokenHash: hashToken(token),
      deviceLabel,
      now,
      expiresAt,
    });
    return { sessionToken: token, expiresAt: expiresAt.toISOString() };
  }
}
