import { randomInt } from "node:crypto";
import { handleBase } from "../auth/rules.js";
import type { AuthService } from "../auth/service.js";
import type { AuthStore } from "../auth/store.js";
import { ApiError } from "../errors.js";

export interface ProfileOptions {
  maxEditsPerWindow: number;
  windowDays: number;
}

export const DEFAULT_PROFILE_OPTIONS: ProfileOptions = { maxEditsPerWindow: 5, windowDays: 30 };

export interface ProfilePatch {
  displayName?: string;
  course?: string | null;
  studyYear?: number | null;
}

const HANDLE_RETRIES = 5;

function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export class ProfileService {
  constructor(
    private readonly auth: AuthService,
    private readonly store: AuthStore,
    private readonly opts: ProfileOptions = DEFAULT_PROFILE_OPTIONS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(token: string) {
    const ctx = await this.auth.authenticate(token);
    const p = await this.store.getKnownProfileDetails(ctx.knownProfileId);
    if (!p) throw new ApiError("not_found", 404, "Not found.");
    return p;
  }

  async update(token: string, patch: ProfilePatch) {
    const ctx = await this.auth.authenticate(token);
    const current = await this.store.getKnownProfileDetails(ctx.knownProfileId);
    if (!current) throw new ApiError("not_found", 404, "Not found.");

    const set: {
      displayName?: string;
      course?: string | null;
      studyYear?: number | null;
      handle?: string;
    } = {};

    if (patch.displayName !== undefined) {
      const name = cleanName(patch.displayName);
      if (name.length === 0 || name.length > 80) {
        throw new ApiError("invalid_name", 422, "Your name must be 1 to 80 characters.");
      }
      if (name !== current.displayName) set.displayName = name;
    }
    if (patch.course !== undefined) {
      const course = patch.course === null ? null : cleanName(patch.course) || null;
      if (course !== null && course.length > 120) {
        throw new ApiError("invalid_course", 422, "Your course must be at most 120 characters.");
      }
      if (course !== current.course) set.course = course;
    }
    if (patch.studyYear !== undefined) {
      const year = patch.studyYear;
      if (year !== null && (!Number.isInteger(year) || year < 1 || year > 8)) {
        throw new ApiError("invalid_year", 422, "Your year of study must be between 1 and 8.");
      }
      if (year !== current.studyYear) set.studyYear = year;
    }

    if (Object.keys(set).length === 0) return current;

    const base = set.displayName !== undefined ? handleBase(set.displayName) : null;
    const now = this.now();

    for (let attempt = 0; attempt < HANDLE_RETRIES; attempt += 1) {
      const result = await this.store.updateKnownProfile({
        profileId: ctx.knownProfileId,
        now,
        set: base ? { ...set, handle: `${base}_${randomInt(1000, 10_000)}` } : set,
        maxEdits: this.opts.maxEditsPerWindow,
        windowDays: this.opts.windowDays,
      });

      if (result === "updated") {
        const fresh = await this.store.getKnownProfileDetails(ctx.knownProfileId);
        if (!fresh) throw new ApiError("not_found", 404, "Not found.");
        return fresh;
      }
      if (result === "rate_limited") {
        throw new ApiError(
          "too_many_edits",
          429,
          `You can change your profile ${this.opts.maxEditsPerWindow} times in ${this.opts.windowDays} days. Try again later.`,
        );
      }
      if (result === "not_found") throw new ApiError("not_found", 404, "Not found.");
      // handle_taken: try another suffix
    }
    throw new ApiError("try_again", 503, "Could not save your profile. Please try again.");
  }
}
