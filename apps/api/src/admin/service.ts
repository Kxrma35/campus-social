import { ApiError } from "../errors.js";
import { hashToken } from "../auth/crypto.js";
import type {
  AdminStore,
  AppealRow,
  Moderator,
  Outcome,
  PenaltyKind,
  QueueRow,
  TargetDetail,
  TargetKind,
} from "./store.js";

export interface AdminOptions {
  urgentSlaHours: number;
  normalSlaHours: number;
  maxSuspensionDays: number;
  maxPageSize: number;
  blindIndexFor?: (profileId: string) => Buffer;
}

export const DEFAULT_ADMIN_OPTIONS: AdminOptions = {
  urgentSlaHours: 1,
  normalSlaHours: 24,
  maxSuspensionDays: 30,
  maxPageSize: 50,
};

export interface QueueItem extends Omit<QueueRow, "oldestReportAt"> {
  oldestReportAt: string;
  dueAt: string;
  overdue: boolean;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIN_NOTE = 10;

export class AdminService {
  constructor(
    private readonly store: AdminStore,
    private readonly opts: AdminOptions = DEFAULT_ADMIN_OPTIONS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async authenticate(token: string): Promise<Moderator> {
    const m = await this.store.findModeratorByTokenHash(hashToken(token));
    if (!m) throw new ApiError("unauthorized", 401, "Invalid moderator token.");
    return m;
  }

  async queue(q: { limit?: number; offset?: number }): Promise<{ items: QueueItem[] }> {
    const limit = Math.min(Math.max(1, q.limit ?? 25), this.opts.maxPageSize);
    const offset = Math.max(0, q.offset ?? 0);
    const rows = await this.store.queue({ limit, offset });
    const now = this.now().getTime();

    const items = rows.map((r): QueueItem => {
      const sla = (r.urgent ? this.opts.urgentSlaHours : this.opts.normalSlaHours) * HOUR_MS;
      const due = r.oldestReportAt.getTime() + sla;
      return {
        ...r,
        oldestReportAt: r.oldestReportAt.toISOString(),
        dueAt: new Date(due).toISOString(),
        overdue: due < now,
      };
    });
    return { items };
  }

  async target(kind: TargetKind, id: string): Promise<TargetDetail> {
    const t = await this.store.targetDetail(kind, id);
    if (!t) throw new ApiError("not_found", 404, "Not found.");
    return t;
  }

  async resolve(
    moderator: Moderator,
    kind: TargetKind,
    id: string,
    outcome: Outcome,
    note: string | null,
  ) {
    const out = await this.store.resolveTarget({
      kind,
      id,
      outcome,
      moderator: moderator.name,
      note: note?.trim() || null,
      now: this.now(),
    });
    if (!out) throw new ApiError("not_found", 404, "Not found.");
    return out;
  }

  async penalize(
    moderator: Moderator,
    input: { profileId: string; kind: PenaltyKind; endsAt?: Date | null; note: string },
  ): Promise<{ status: "applied" }> {
    const note = input.note.trim();
    if (note.length < MIN_NOTE) {
      throw new ApiError("note_required", 422, `Record a reason of at least ${MIN_NOTE} characters.`);
    }

    let endsAt: Date | null = null;
    if (input.kind === "suspension") {
      if (!input.endsAt) {
        throw new ApiError("ends_at_required", 422, "A suspension needs an end date.");
      }
      const now = this.now().getTime();
      const t = input.endsAt.getTime();
      if (t <= now + HOUR_MS || t > now + this.opts.maxSuspensionDays * DAY_MS) {
        throw new ApiError(
          "invalid_ends_at",
          422,
          `A suspension must last between 1 hour and ${this.opts.maxSuspensionDays} days.`,
        );
      }
      endsAt = input.endsAt;
    } else if (input.endsAt) {
      throw new ApiError("invalid_ends_at", 422, "Only suspensions have an end date.");
    }

    const kind = await this.store.profileKind(input.profileId);
    if (!kind) throw new ApiError("not_found", 404, "Not found.");

    let blindIndex: Buffer | null = null;
    if (kind === "anonymous") {
      if (!this.opts.blindIndexFor) {
        throw new ApiError(
          "not_available",
          501,
          "Penalties against anonymous profiles are not available yet.",
        );
      }
      blindIndex = this.opts.blindIndexFor(input.profileId);
    }

    await this.store.penalize({
      profileId: input.profileId,
      profileKind: kind,
      blindIndex,
      kind: input.kind,
      endsAt,
      moderator: moderator.name,
      note,
    });
    return { status: "applied" };
  }

  async appeals(status: "open" | "upheld" | "denied"): Promise<{ items: AppealRow[] }> {
    return { items: await this.store.listAppeals(status) };
  }

  async decideAppeal(
    moderator: Moderator,
    id: string,
    decision: "upheld" | "denied",
    note: string,
  ): Promise<{ status: "decided" }> {
    const trimmed = note.trim();
    if (trimmed.length < MIN_NOTE) {
      throw new ApiError("note_required", 422, `Record a reason of at least ${MIN_NOTE} characters.`);
    }
    const ok = await this.store.decideAppeal({
      id,
      decision,
      moderator: moderator.name,
      note: trimmed,
    });
    if (!ok) throw new ApiError("not_found", 404, "No open appeal with that id.");
    return { status: "decided" };
  }

  async photoKey(uploadId: string): Promise<string> {
    const key = await this.store.photoStorageKey(uploadId);
    if (!key) throw new ApiError("not_found", 404, "Not found.");
    return key;
  }
}
