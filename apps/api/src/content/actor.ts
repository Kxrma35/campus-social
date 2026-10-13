import type { AuthService } from "../auth/service.js";
import type { AuthStore } from "../auth/store.js";
import { ApiError } from "../errors.js";
import type { LinkCrypto } from "../identity/linkCrypto.js";
import type { Actor, ProfileKind } from "./types.js";

export interface ActorResolver {
  resolve(token: string, kind: ProfileKind): Promise<Actor>;
}

export interface AnonymousSupport {
  store: AuthStore;
  crypto: LinkCrypto;
}

export class AuthActorResolver implements ActorResolver {
  constructor(
    private readonly auth: AuthService,
    private readonly anonymous?: AnonymousSupport,
  ) {}

  async resolve(token: string, kind: ProfileKind): Promise<Actor> {
    const ctx = await this.auth.authenticate(token);
    const canWrite = ctx.status === "active";

    if (kind === "known") {
      return { profileId: ctx.knownProfileId, kind: "known", canWrite };
    }

    if (!this.anonymous) {
      throw new ApiError("not_available", 501, "Anonymous profiles are not available yet.");
    }

    const enc = await this.anonymous.store.getAnonymousLink(ctx.accountId);
    if (!enc) {
      throw new ApiError("no_anonymous_profile", 404, "You have not created an anonymous profile.");
    }

    let profileId: string;
    try {
      profileId = this.anonymous.crypto.decrypt(enc, ctx.accountId);
    } catch {
      throw new ApiError(
        "anonymous_unavailable",
        503,
        "Your anonymous profile is temporarily unavailable.",
      );
    }
    return {
      profileId,
      kind: "anonymous",
      canWrite,
      blindIndex: this.anonymous.crypto.blindIndex(profileId),
    };
  }
}
