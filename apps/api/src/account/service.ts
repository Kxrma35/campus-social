import { AuthError, type AuthService } from "../auth/service.js";
import { reverifyDueAt } from "../auth/rules.js";
import type { AuthStore } from "../auth/store.js";
import {
  AnonymousResolverMissing,
  type AccountExport,
  type LifecycleStore,
} from "./lifecycleStore.js";

export class AccountService {
  constructor(
    private readonly auth: AuthService,
    private readonly authStore: AuthStore,
    private readonly lifecycle: LifecycleStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async requestReverify(token: string): Promise<void> {
    const ctx = await this.auth.authenticate(token);
    await this.auth.issueCode(ctx.email, "reverify");
  }

  async verifyReverify(token: string, code: string) {
    const ctx = await this.auth.authenticate(token);
    await this.auth.consume(ctx.email, "reverify", code);

    const now = this.now();
    const dueAt = reverifyDueAt(now);
    await this.authStore.markReverified({ accountId: ctx.accountId, now, dueAt });
    return { status: "active" as const, reverifyDueAt: dueAt.toISOString() };
  }

  async requestClose(token: string): Promise<void> {
    const ctx = await this.auth.authenticate(token);
    await this.auth.issueCode(ctx.email, "close");
  }

  async confirmClose(token: string, code: string): Promise<void> {
    const ctx = await this.auth.authenticate(token);
    await this.auth.consume(ctx.email, "close", code);

    try {
      const closed = await this.lifecycle.closeAccount({
        accountId: ctx.accountId,
        reason: "user_request",
        now: this.now(),
      });
      if (!closed) {
        throw new AuthError("cannot_close", 409, "This account cannot be closed right now.");
      }
    } catch (err) {
      if (err instanceof AnonymousResolverMissing) {
        throw new AuthError(
          "not_available",
          501,
          "Closing accounts with an anonymous profile is not available yet.",
        );
      }
      throw err;
    }
  }

  async exportData(token: string): Promise<AccountExport> {
    const ctx = await this.auth.authenticate(token);
    try {
      return await this.lifecycle.exportAccount(ctx.accountId, this.now());
    } catch (err) {
      if (err instanceof AnonymousResolverMissing) {
        throw new AuthError(
          "not_available",
          501,
          "Data export for accounts with an anonymous profile is not available yet.",
        );
      }
      throw err;
    }
  }
}
