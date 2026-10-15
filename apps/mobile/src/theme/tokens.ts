
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
}

export const light: Palette = {
  background: "#FFFFFF",
  surface: "#F3F4F6",
  text: "#0B0B12",
  textMuted: "#5B5F68",
  border: "#6B7280",
  primary: "#0B0B12",
  onPrimary: "#FFFFFF",
  danger: "#B91C1C",
  onDanger: "#FFFFFF",
  success: "#166534",
  known: "#0B0B12",
  onKnown: "#FFFFFF",
  anonymous: "#6D28D9",
  onAnonymous: "#FFFFFF",
  focus: "#0B0B12",
  hairline: "#6B728033",
  ground: "#F2F3F5",
  card: "#FFFFFF",
  primarySoft: "#0B0B1210",
  anonymousSoft: "#6D28D91A",
};

export const dark: Palette = {
  background: "#0B0B0F",
  surface: "#1F1F26",
  text: "#F5F5F7",
  textMuted: "#A5A8B2",
  border: "#8892A6",
  primary: "#F5F5F7",
  onPrimary: "#0B0B0F",
  danger: "#FCA5A5",
  onDanger: "#0B0F19",
  success: "#86EFAC",
  known: "#F5F5F7",
  onKnown: "#0B0B0F",
  anonymous: "#C4B5FD",
  onAnonymous: "#0B0F19",
  focus: "#F5F5F7",
  hairline: "#8892A640",
  ground: "#0B0B0F",
  card: "#17171C",
  primarySoft: "#F5F5F71F",
  anonymousSoft: "#C4B5FD26",
};

export type Scheme = "light" | "dark";
export const palettes: Record<Scheme, Palette> = { light, dark };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, xl: 22, pill: 999 } as const;

export const type = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: "700" as const },
  reading: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
  readingLarge: { fontSize: 17, lineHeight: 26, fontWeight: "400" as const },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "700" as const },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "600" as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: "400" as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600" as const },
  small: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
};

export const MIN_TARGET = 44;
