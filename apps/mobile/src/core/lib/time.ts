const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface TimeOptions {
  rounded?: boolean;
}

/** A short, human relative time. */
export function timeAgo(iso: string, now: number = Date.now(), opts: TimeOptions = {}): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, now - then);

  if (opts.rounded && diff < HOUR) return "this hour";
  if (diff < MIN) return "just now";
  if (diff < HOUR) {
    const n = Math.floor(diff / MIN);
    return `${n} minute${n === 1 ? "" : "s"} ago`;
  }
  if (diff < DAY) {
    const n = Math.floor(diff / HOUR);
    return `${n} hour${n === 1 ? "" : "s"} ago`;
  }
  if (diff < 7 * DAY) {
    const n = Math.floor(diff / DAY);
    return `${n} day${n === 1 ? "" : "s"} ago`;
  }
  return shortDate(new Date(then));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
