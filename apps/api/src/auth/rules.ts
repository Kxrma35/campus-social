export interface DateOnly {
  year: number;
  month: number;
  day: number;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1);
}

export function parseDateOnly(value: string): DateOnly | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function ageOn(dob: DateOnly, now: Date): number {
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  let age = now.getUTCFullYear() - dob.year;
  if (month < dob.month || (month === dob.month && day < dob.day)) age -= 1;
  return age;
}

export type AgeCheck = "ok" | "invalid" | "under_18";

export function checkAge(value: string, now: Date): AgeCheck {
  const dob = parseDateOnly(value);
  if (!dob) return "invalid";
  const age = ageOn(dob, now);
  if (age < 0 || age > 120) return "invalid";
  return age >= 18 ? "ok" : "under_18";
}

export function reverifyDueAt(from: Date): Date {
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

const RESERVED_HANDLES = new Set([
  "admin", "administrator", "moderator", "mod", "staff", "support", "help", "official", "system",
  "root", "moku", "campus", "usiu", "security", "safety", "trust", "team", "anonymous", "student",
]);

const ANONYMOUS_HANDLE_SHAPE = /^[a-z]+_[a-z]+_\d{4}$/;

export type HandleCheck = { ok: true; handle: string } | { ok: false; reason: string };

/** A handle the student chose: 3 to 20 letters, digits or underscores, starting with a letter. */
export function checkHandle(raw: string): HandleCheck {
  const handle = raw.trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(handle)) {
    return {
      ok: false,
      reason: "Use 3 to 20 letters, numbers or underscores, starting with a letter.",
    };
  }
  if (handle.includes("__") || handle.endsWith("_")) {
    return { ok: false, reason: "Do not use two underscores in a row or end with one." };
  }
  if (RESERVED_HANDLES.has(handle)) {
    return { ok: false, reason: "That handle is reserved. Choose another." };
  }
  if (ANONYMOUS_HANDLE_SHAPE.test(handle)) {
    return { ok: false, reason: "That handle looks like an anonymous one. Choose another." };
  }
  return { ok: true, handle };
}

/** Public handle for the known profile, e.g. "jane_doe_4821". */
export function handleBase(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  return slug.length > 0 ? slug : "student";
}
