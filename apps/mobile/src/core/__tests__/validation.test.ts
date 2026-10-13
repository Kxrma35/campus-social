import {
  checkCode,
  checkCourse,
  checkDateOfBirth,
  checkEmail,
  checkName,
  checkStudyYear,
  isAtLeast18,
} from "@/core/lib/validation";

describe("email", () => {
  it("normalises and accepts", () => {
    expect(checkEmail("  Jane.Doe@USIU.ac.ke ")).toEqual({ ok: true, value: "jane.doe@usiu.ac.ke" });
  });
  it.each(["", "   ", "jane", "jane@", "@usiu.ac.ke", "jane@usiu", "a b@c.de", "a@@b.cd"])(
    "rejects %j",
    (bad) => {
      expect(checkEmail(bad).ok).toBe(false);
    },
  );
});

describe("code", () => {
  it("accepts six digits, ignoring spaces", () => {
    expect(checkCode("123 456")).toEqual({ ok: true, value: "123456" });
  });
  it.each(["", "12345", "1234567", "12345a", "abcdef"])("rejects %j", (bad) => {
    expect(checkCode(bad).ok).toBe(false);
  });
});

describe("name, course and year", () => {
  it("collapses whitespace and bounds length", () => {
    expect(checkName("  Jane    Doe ").value).toBe("Jane Doe");
    expect(checkName("   ").ok).toBe(false);
    expect(checkName("x".repeat(81)).ok).toBe(false);
  });
  it("treats an empty course as none", () => {
    expect(checkCourse("   ")).toEqual({ ok: true, value: null });
    expect(checkCourse("x".repeat(121)).ok).toBe(false);
  });
  it("bounds the year", () => {
    expect(checkStudyYear("")).toEqual({ ok: true, value: null });
    expect(checkStudyYear("3").value).toBe(3);
  });
  it.each(["0", "9", "-1", "2.5", "two"])("rejects a study year of %j", (bad) => {
    expect(checkStudyYear(bad).ok).toBe(false);
  });
});

describe("date of birth", () => {
  it("builds an ISO date", () => {
    expect(checkDateOfBirth("5", "3", "2004")).toEqual({ ok: true, value: "2004-03-05" });
  });
  it("rejects impossible, malformed and future dates", () => {
    expect(checkDateOfBirth("31", "2", "2004").ok).toBe(false);
    expect(checkDateOfBirth("1", "13", "2004").ok).toBe(false);
    expect(checkDateOfBirth("1", "1", "04").ok).toBe(false);
    expect(checkDateOfBirth("a", "1", "2004").ok).toBe(false);
    expect(checkDateOfBirth("1", "1", "2999").ok).toBe(false);
  });
  it("accepts a leap day only in a leap year", () => {
    expect(checkDateOfBirth("29", "2", "2004").ok).toBe(true);
    expect(checkDateOfBirth("29", "2", "2005").ok).toBe(false);
  });
});

describe("isAtLeast18 (a hint, not the check)", () => {
  const now = new Date("2026-10-12T10:00:00Z");
  it("turns 18 on the birthday", () => {
    expect(isAtLeast18("2008-10-12", now)).toBe(true);
    expect(isAtLeast18("2008-10-13", now)).toBe(false);
    expect(isAtLeast18("2004-05-01", now)).toBe(true);
    expect(isAtLeast18("2012-01-01", now)).toBe(false);
  });
});
