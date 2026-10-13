import type { Pool } from "pg";
import type { Actor } from "../content/types.js";
import { ApiError } from "../errors.js";

export type ReportTarget = "post" | "comment" | "profile";
export type ReportReason =
  | "threat"
  | "harassment"
  | "private_info"
  | "intimate_image"
  | "hate"
  | "self_harm"
  | "impersonation"
  | "other";

export const REPORT_REASONS: readonly ReportReason[] = [
  "threat",
  "harassment",
  "private_info",
  "intimate_image",
  "hate",
  "self_harm",
  "impersonation",
  "other",
];

export interface FileReportInput {
  reporterProfileId: string;
  reporterBlindIndex: Buffer | null;
  targetKind: ReportTarget;
  targetId: string;
  reason: ReportReason;
  detail: string | null;
}

export interface ReportStore {
  fileReport(input: FileReportInput): Promise<{ isNew: boolean; autoHidden: boolean }>;
  fileAutoFlag(kind: "post" | "comment", targetId: string): Promise<void>;
}

export class PgReportStore implements ReportStore {
  constructor(private readonly pool: Pool) {}

  async fileReport(input: FileReportInput) {
    try {
      const r = await this.pool.query(
        `select is_new, auto_hidden
           from moderation.file_report($1, $2, $3::report_target, $4, $5::report_reason, $6)`,
        [
          input.reporterProfileId,
          input.reporterBlindIndex,
          input.targetKind,
          input.targetId,
          input.reason,
          input.detail,
        ],
      );
      return { isNew: r.rows[0].is_new as boolean, autoHidden: r.rows[0].auto_hidden as boolean };
    } catch (err) {
      throw mapReportError(err);
    }
  }

  async fileAutoFlag(kind: "post" | "comment", targetId: string): Promise<void> {
    try {
      await this.pool.query(
        `select moderation.file_auto_flag($1::report_target, $2, 'self_harm'::report_reason)`,
        [kind, targetId],
      );
    } catch (err) {
      throw mapReportError(err);
    }
  }
}

function mapReportError(err: unknown): unknown {
  const code = (err as { code?: string }).code;
  switch (code) {
    case "MD001":
      return new ApiError("not_found", 404, "Not found.");
    case "MD002":
      return new ApiError("rate_limited", 429, "You are reporting too fast. Try again later.");
    case "MD003":
      return new ApiError("not_available", 501, "Reporting as an anonymous profile is not available yet.");
    case "MD004":
      return new ApiError("own_content", 422, "You cannot report your own content.");
    default:
      return err;
  }
}

export class ReportService {
  constructor(private readonly store: ReportStore) {}

  async report(
    actor: Actor,
    input: {
      targetKind: ReportTarget;
      targetId: string;
      reason: ReportReason;
      detail?: string | null;
    },
  ): Promise<{ status: "received" }> {
    if (!actor.canWrite) {
      throw new ApiError(
        "read_only",
        403,
        "Your account is read-only. Re-verify your email to report content.",
      );
    }
    if (actor.kind === "anonymous" && !actor.blindIndex) {
      throw new ApiError(
        "not_available",
        501,
        "Reporting as an anonymous profile is not available yet.",
      );
    }

    await this.store.fileReport({
      reporterProfileId: actor.profileId,
      reporterBlindIndex: actor.kind === "anonymous" ? (actor.blindIndex ?? null) : null,
      targetKind: input.targetKind,
      targetId: input.targetId,
      reason: input.reason,
      detail: input.detail?.trim() ? input.detail.trim().slice(0, 1000) : null,
    });
    return { status: "received" };
  }
}
