import { describe, expect, it } from "vitest";
import {
  ageOn,
  checkAge,
  emailDomain,
  handleBase,
  normalizeEmail,
  parseDateOnly,
  reverifyDueAt,
} from "../src/auth/rules.js";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("email helpers", () => {
  it("normalises case and whitespace", () => {
    expect(normalizeEmail("  Jane.Doe@USIU.ac.ke ")).toBe("jane.doe@usiu.ac.ke");
  });

  it("extracts the domain, using the last @", () => {
    expect(emailDomain("a@usiu.ac.ke")).toBe("usiu.ac.ke");
    expect(emailDomain("weird@name@usiu.ac.ke")).toBe("usiu.ac.ke");
  });

  it("returns null for malformed addresses", () => {
    expect(emailDomain("nope")).toBeNull();
    expect(emailDomain("@usiu.ac.ke")).toBeNull();
    expect(emailDomain("a@")).toBeNull();
  });
});

describe("dates and age", () => {
  it("rejects impossible dates", () => {
    expect(parseDateOnly("2004-02-31")).toBeNull();
    expect(parseDateOnly("2004-13-01")).toBeNull();
    expect(parseDateOnly("04-01-2004")).toBeNull();
    expect(parseDateOnly("2004-1-1")).toBeNull();
  });

  it("accepts leap day", () => {
    expect(parseDateOnly("2004-02-29")).toEqual({ year: 2004, month: 2, day: 29 });
  });

  it("turns 18 exactly on the birthday", () => {
    const dob = parseDateOnly("2008-10-12");
    if (!dob) throw new Error("bad fixture");
    expect(ageOn(dob, at("2026-10-11"))).toBe(17);
    expect(ageOn(dob, at("2026-10-12"))).toBe(18);
  });

  it("checkAge classifies adults, minors and nonsense", () => {
    const now = at("2026-10-12");
    expect(checkAge("2004-05-01", now)).toBe("ok");
    expect(checkAge("2008-10-12", now)).toBe("ok");
    expect(checkAge("2008-10-13", now)).toBe("under_18");
    expect(checkAge("2030-01-01", now)).toBe("invalid");
    expect(checkAge("1850-01-01", now)).toBe("invalid");
    expect(checkAge("not-a-date", now)).toBe("invalid");
  });
});

describe("reverification", () => {
  it("is due one year later", () => {
    expect(reverifyDueAt(at("2026-10-12")).toISOString()).toBe("2027-10-12T12:00:00.000Z");
  });
});

describe("handleBase", () => {
  it("slugs names and strips accents", () => {
    expect(handleBase("Jane Doe")).toBe("jane_doe");
    expect(handleBase("Zoë  O'Brien")).toBe("zoe_o_brien");
  });

  it("falls back when nothing usable remains", () => {
    expect(handleBase("!!!")).toBe("student");
  });
});
