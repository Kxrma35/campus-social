import { randomUUID } from "node:crypto";
import type { AuthService } from "../auth/service.js";
import type { AuthStore } from "../auth/store.js";
import { ApiError } from "../errors.js";
import { generateAnonymousIdentity } from "./handles.js";
import type { LinkCrypto } from "./linkCrypto.js";

export const ANONYMITY_NOTICE =
  "Other students can't see who you are. We can, if you seriously break the rules or the law requires it.";

export type AnonymousStatus =
  | "available"
  | "exists"
  | "locked_new_account"
  | "locked_strikes"
  | "locked_account_state"
  | "unavailable";

export interface IdentityOptions {
  minAccountAgeDays: number;
}

export const DEFAULT_IDENTITY_OPTIONS: IdentityOptions = { minAccountAgeDays: 3 };

const DAY_MS = 24 * 60 * 60 * 1000;
const HANDLE_RETRIES = 8;

export interface AnonymousEligibility {
  status: AnonymousStatus;
  /** Present while the account is too new. */
  unlocksAt?: string;
}

export class IdentityService {
  constructor(
    private readonly auth: AuthService,
    private readonly store: AuthStore,
    private readonly crypto: LinkCrypto,
    private readonly opts: IdentityOptions = DEFAULT_IDENTITY_OPTIONS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async myProfiles(token: string) {
    const ctx = await this.auth.authenticate(token);

    const known = await this.store.getProfileBasics(ctx.knownProfileId);
    const enc = await this.store.getAnonymousLink(ctx.accountId);

    let anonymous: { profileId: string; handle: string; avatarKey: string | null } | null = null;
    let unreadable = false;
    if (enc) {
      try {
        const profileId = this.crypto.decrypt(enc, ctx.accountId);
        const basics = await this.store.getProfileBasics(profileId);
        if (basics) anonymous = { profileId, ...basics };
      } catch {
        unreadable = true;
      }
    }

    return {
      known: { profileId: ctx.knownProfileId, handle: known?.handle ?? null },
      anonymous,
      anonymousEligibility: unreadable
        ? ({ status: "unavailable" } as AnonymousEligibility)
        : await this.eligibility(ctx.accountId, anonymous !== null),
      notice: ANONYMITY_NOTICE,
    };
  }

  async createAnonymous(token: string, input: { acknowledged: boolean }) {
    const ctx = await this.auth.authenticate(token);
    if (!input.acknowledged) {
      throw new ApiError(
        "acknowledgement_required",
        422,
        "Confirm that you have read what anonymous means here.",
      );
    }

    const eligibility = await this.eligibility(ctx.accountId, false);
    if (eligibility.status !== "available") {
      throw this.lockedError(eligibility);
    }

    const now = this.now();
    for (let i = 0; i < HANDLE_RETRIES; i += 1) {
      const { handle, avatarKey } = generateAnonymousIdentity();
      const profileId = randomUUID();
      const { blob, keyVersion } = this.crypto.encrypt(profileId, ctx.accountId);

      const result = await this.store.createAnonymousProfile({
        accountId: ctx.accountId,
        profileId,
        handle,
        avatarKey,
        enc: blob,
        keyVersion,
        blindIndex: this.crypto.blindIndex(profileId),
        now,
      });

      if (result === "created") {
        return { profile: { profileId, handle, avatarKey }, notice: ANONYMITY_NOTICE };
      }
      if (result === "exists") {
        throw new ApiError("already_exists", 409, "You already have an anonymous profile.");
      }
      // handle_taken: generate another
    }
    throw new ApiError("try_again", 503, "Could not create the profile. Please try again.");
  }

  private async eligibility(accountId: string, hasProfile: boolean): Promise<AnonymousEligibility> {
    if (hasProfile) return { status: "exists" };
    const standing = await this.store.getStanding(accountId);
    if (!standing) return { status: "locked_account_state" };
    if (await this.store.getAnonymousLink(accountId)) return { status: "exists" };

    if (standing.status !== "active") return { status: "locked_account_state" };
    if (standing.strikeCount > 0) return { status: "locked_strikes" };

    const unlocks = new Date(standing.createdAt.getTime() + this.opts.minAccountAgeDays * DAY_MS);
    if (this.now() < unlocks) {
      return { status: "locked_new_account", unlocksAt: unlocks.toISOString() };
    }
    return { status: "available" };
  }

  private lockedError(e: AnonymousEligibility): ApiError {
    switch (e.status) {
      case "exists":
        return new ApiError("already_exists", 409, "You already have an anonymous profile.");
      case "locked_new_account":
        return new ApiError(
          "anonymous_locked",
          403,
          "Anonymous profiles unlock when your account is a few days old.",
        );
      case "locked_strikes":
        return new ApiError(
          "anonymous_locked",
          403,
          "Anonymous profiles are unavailable while your account has a warning.",
        );
      default:
        return new ApiError(
          "anonymous_locked",
          403,
          "Anonymous profiles are unavailable for your account right now.",
        );
    }
  }
}
