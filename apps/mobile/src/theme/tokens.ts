export interface Palette {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  onPrimary: string;
  danger: string;
  onDanger: string;
  success: string;
  known: string;
  onKnown: string;
  anonymous: string;
  onAnonymous: string;
  focus: string;
  hairline: string;
  ground: string;
  card: string;
  primarySoft: string;
  anonymousSoft: string;
  accentLavender: string;
  accentPink: string;
  accentText: string;
  glass: string;
  onGlass: string;
  identity: { known: string; anon: string };
}

export const light: Palette = {
  background: "#F6F4F7",
  surface: "#FCFBFD",
  text: "#1B1822",
  textMuted: "#58535F",
  border: "#8A8493",
  primary: "#1B1822",
  onPrimary: "#F6F4F7",
  danger: "#A3262F",
  onDanger: "#FCFBFD",
  success: "#1F6B3A",
  known: "#3B3F9E",
  onKnown: "#FCFBFD",
  anonymous: "#9A2A6B",
  onAnonymous: "#FCFBFD",
  focus: "#5B3FB5",
  hairline: "#8A849366",
  ground: "#F6F4F7",
  card: "#FCFBFD",
  primarySoft: "#1B182210",
  anonymousSoft: "#9A2A6B1A",
  accentLavender: "#B8A6E8",
  accentPink: "#E9A9D2",
  accentText: "#5B3FB5",
  glass: "rgba(27, 24, 34, 0.78)",
  onGlass: "#F6F4F7",
  identity: { known: "#3B3F9E", anon: "#9A2A6B" },
};

export const dark: Palette = {
  background: "#14121A",
  surface: "#1D1A25",
  text: "#EEEAF4",
  textMuted: "#B2ACBD",
  border: "#7C7689",
  primary: "#EEEAF4",
  onPrimary: "#14121A",
  danger: "#FF9AA2",
  onDanger: "#14121A",
  success: "#86D9A0",
  known: "#A9AEFF",
  onKnown: "#14121A",
  anonymous: "#F0A3CF",
  onAnonymous: "#14121A",
  focus: "#C3B1FF",
  hairline: "#7C768966",
  ground: "#14121A",
  card: "#1D1A25",
  primarySoft: "#EEEAF41F",
  anonymousSoft: "#F0A3CF26",
  accentLavender: "#8E7BD1",
  accentPink: "#C77FB0",
  accentText: "#C3B1FF",
  glass: "rgba(20, 18, 26, 0.78)",
  onGlass: "#F6F4F7",
  identity: { known: "#A9AEFF", anon: "#F0A3CF" },
};

export type Scheme = "light" | "dark";
export const palettes: Record<Scheme, Palette> = { light, dark };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 6, md: 10, lg: 14, xl: 22, panel: 28, pill: 999 } as const;

export const fonts = {
  regular: "Figtree_400Regular",
  medium: "Figtree_500Medium",
  semibold: "Figtree_600SemiBold",
} as const;

export const type = {
  display: { fontFamily: fonts.semibold, fontSize: 30, lineHeight: 36 },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 },
  heading: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24 },
  reading: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  readingLarge: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 26 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
};

export const MIN_TARGET = 44;

/** Soft drop shadow for the primary button only. */
export const shadow = {
  button: {
    shadowColor: "#1B1822",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
} as const;
