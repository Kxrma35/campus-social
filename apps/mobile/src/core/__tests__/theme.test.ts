import { contrastRatio } from "@/theme/contrast";
import { palettes, type Palette } from "@/theme/tokens";

type StringKey = {
  [K in keyof Palette]: Palette[K] extends string ? K : never;
}[keyof Palette];

const TEXT_PAIRS: [StringKey, StringKey, string][] = [
  ["text", "background", "body text"],
  ["text", "surface", "text on cards"],
  ["textMuted", "background", "secondary and helper text"],
  ["textMuted", "surface", "secondary text on cards"],
  ["onPrimary", "primary", "button label"],
  ["onDanger", "danger", "destructive button label"],
  ["onKnown", "known", "known profile chip"],
  ["onAnonymous", "anonymous", "anonymous profile chip"],
  ["danger", "background", "error text"],
  ["danger", "surface", "error text on cards"],
  ["primary", "background", "link text"],
  ["accentText", "background", "accent text"],
  ["accentText", "surface", "accent text on cards"],
  ["known", "background", "known identity on page"],
  ["known", "surface", "known identity on cards"],
  ["anonymous", "background", "anonymous identity on page"],
  ["anonymous", "surface", "anonymous identity on cards"],
  ["success", "background", "success text"],
];

/** Blend an rgba() colour over an opaque hex background. */
function over(rgba: string, bg: string): string {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(rgba);
  if (!m) throw new Error(`not rgba: ${rgba}`);
  const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  const base = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
  const mixed = [r, g, b].map((c, i) => Math.round(a * c + (1 - a) * base[i]!));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

describe.each(Object.entries(palettes))("%s palette meets WCAG AA", (_scheme, palette) => {
  it.each(TEXT_PAIRS)("%s on %s is at least 4.5:1 (%s)", (fg, bg) => {
    expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it("component boundaries are at least 3:1 against the page and cards", () => {
    expect(contrastRatio(palette.border, palette.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(palette.border, palette.card)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(palette.focus, palette.background)).toBeGreaterThanOrEqual(3);
  });

  it("caption text on the glass card holds 4.5:1 over the brightest possible photo", () => {
    expect(contrastRatio(palette.onGlass, over(palette.glass, "#FFFFFF"))).toBeGreaterThanOrEqual(4.5);
  });

  it("the two identity colours differ and mirror the profile colours", () => {
    expect(palette.identity.known).not.toBe(palette.identity.anon);
    expect(palette.identity.known).toBe(palette.known);
    expect(palette.identity.anon).toBe(palette.anonymous);
  });

  it("uses no pure black or white", () => {
    const values = Object.values(palette).filter((v): v is string => typeof v === "string" && v.startsWith("#"));
    for (const v of values) {
      expect(v.slice(0, 7).toUpperCase()).not.toBe("#000000");
      expect(v.slice(0, 7).toUpperCase()).not.toBe("#FFFFFF");
    }
  });
});

describe("contrastRatio", () => {
  it("matches known reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeLessThan(4.5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#123456", "#ABCDEF")).toBeCloseTo(contrastRatio("#ABCDEF", "#123456"), 10);
  });
});
