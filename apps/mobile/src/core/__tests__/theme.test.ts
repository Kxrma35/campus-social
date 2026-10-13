import { contrastRatio } from "@/theme/contrast";
import { palettes, type Palette } from "@/theme/tokens";

const TEXT_PAIRS: [keyof Palette, keyof Palette, string][] = [
  ["text", "background", "body text"],
  ["text", "surface", "text on cards"],
  ["textMuted", "background", "secondary text"],
  ["textMuted", "surface", "secondary text on cards"],
  ["onPrimary", "primary", "button label"],
  ["onDanger", "danger", "destructive button label"],
  ["onKnown", "known", "known profile chip"],
  ["onAnonymous", "anonymous", "anonymous profile chip"],
  ["danger", "background", "error text"],
  ["danger", "surface", "error text on cards"],
  ["primary", "background", "link text"],
  ["primary", "surface", "link text on cards"],
  ["success", "background", "success text"],
];

describe.each(Object.entries(palettes))("%s palette meets WCAG AA", (_scheme, palette) => {
  it.each(TEXT_PAIRS)("%s on %s is at least 4.5:1 (%s)", (fg, bg) => {
    expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it("component boundaries are at least 3:1 against the background", () => {
    expect(contrastRatio(palette.border, palette.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(palette.focus, palette.background)).toBeGreaterThanOrEqual(3);
  });

  it("the two profile colours differ from each other", () => {
    expect(palette.known).not.toBe(palette.anonymous);
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
