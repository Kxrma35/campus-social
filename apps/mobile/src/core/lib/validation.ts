
export interface Checked<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

const pass = <T>(value: T): Checked<T> => ({ ok: true, value });
const fail = <T>(error: string): Checked<T> => ({ ok: false, error });

export function checkEmail(raw: string): Checked<string> {
  const value = raw.trim().toLowerCase();
  if (value.length === 0) return fail("Enter your university email address.");
  if (value.length > 254) return fail("That email address is too long.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return fail("Enter a valid email address.");
  return pass(value);
}

export function checkCode(raw: string): Checked<string> {
  const value = raw.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(value)) return fail("Enter the 6-digit code from your email.");
  return pass(value);
}

export function checkName(raw: string): Checked<string> {
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length === 0) return fail("Enter your name.");
  if (value.length > 80) return fail("Your name must be 80 characters or fewer.");
  return pass(value);
}

export function checkCourse(raw: string): Checked<string | null> {
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length === 0) return pass(null);
  if (value.length > 120) return fail("Your course must be 120 characters or fewer.");
  return pass(value);
}

export function checkStudyYear(raw: string): Checked<number | null> {
  const t = raw.trim();
  if (t === "") return pass(null);
  if (!/^\d+$/.test(t)) return fail("Enter your year of study as a number.");
  const n = Number(t);
  if (n < 1 || n > 8) return fail("Your year of study must be between 1 and 8.");
  return pass(n);
}

export function checkDateOfBirth(day: string, month: string, year: string): Checked<string> {
  const d = Number(day.trim());
  const m = Number(month.trim());
  const y = Number(year.trim());
  if (![d, m, y].every((n) => Number.isInteger(n)) || year.trim().length !== 4) {
    return fail("Enter your date of birth as day, month and a four-digit year.");
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return fail("That date does not exist.");
  }
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (date.getTime() > Date.now()) return fail("Your date of birth cannot be in the future.");
  return pass(iso);
}

export function isAtLeast18(isoDob: string, now: Date = new Date()): boolean {
  const [y, m, d] = isoDob.split("-").map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  const month = now.getUTCMonth() + 1;
  if (month < m || (month === m && now.getUTCDate() < d)) age -= 1;
  return age >= 18;
}

export const MAX_POST_LENGTH = 5000;
export const MAX_COMMENT_LENGTH = 2000;
export const MAX_PHOTOS = 4;
/** Courtesy limit; the server is the authority. */
export const MAX_ALT_TEXT = 500;
