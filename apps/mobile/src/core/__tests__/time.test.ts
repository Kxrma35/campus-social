import { shortDate, timeAgo } from "@/core/lib/time";

const NOW = Date.parse("2026-10-12T10:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("timeAgo", () => {
  it("describes recent times in the right unit", () => {
    expect(timeAgo(ago(10_000), NOW)).toBe("just now");
    expect(timeAgo(ago(MIN), NOW)).toBe("1 minute ago");
    expect(timeAgo(ago(5 * MIN), NOW)).toBe("5 minutes ago");
    expect(timeAgo(ago(HOUR), NOW)).toBe("1 hour ago");
    expect(timeAgo(ago(3 * HOUR), NOW)).toBe("3 hours ago");
    expect(timeAgo(ago(DAY), NOW)).toBe("1 day ago");
    expect(timeAgo(ago(6 * DAY), NOW)).toBe("6 days ago");
  });

  it("uses a fixed-format date after a week, independent of the device's locale", () => {
    expect(timeAgo(ago(30 * DAY), NOW)).toBe("12 Sep 2026");
    expect(timeAgo("2025-01-05T08:00:00Z", NOW)).toBe("5 Jan 2025");
  });

  it("shortDate always uses a three-letter month", () => {
    expect(shortDate(new Date("2026-09-03T00:00:00Z"))).toBe("3 Sep 2026");
    expect(shortDate(new Date("2026-12-31T23:59:59Z"))).toBe("31 Dec 2026");
  });

  it("never claims false precision for a rounded (anonymous) time", () => {
    expect(timeAgo(ago(0), NOW, { rounded: true })).toBe("this hour");
    expect(timeAgo(ago(40 * MIN), NOW, { rounded: true })).toBe("this hour");
    expect(timeAgo(ago(59 * MIN), NOW, { rounded: true })).toBe("this hour");
    expect(timeAgo(ago(HOUR), NOW, { rounded: true })).toBe("1 hour ago");
  });

  it("copes with bad input and clock skew", () => {
    expect(timeAgo("not a date", NOW)).toBe("");
    expect(timeAgo(new Date(NOW + 5 * MIN).toISOString(), NOW)).toBe("just now");
  });
});
