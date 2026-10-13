
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
}

export const light: Palette = {
  background: "#FFFFFF",
  surface: "#F3F4F6",
  text: "#111827",
  textMuted: "#4B5563",
  border: "#6B7280",
  primary: "#1D4ED8",
  onPrimary: "#FFFFFF",
  danger: "#B91C1C",
  onDanger: "#FFFFFF",
  success: "#166534",
  known: "#1D4ED8",
  onKnown: "#FFFFFF",
  anonymous: "#6D28D9",
  onAnonymous: "#FFFFFF",
  focus: "#1D4ED8",
};

export const dark: Palette = {
  background: "#0B0F19",
  surface: "#161C2D",
  text: "#F3F4F6",
  textMuted: "#A8B0C0",
  border: "#8892A6",
  primary: "#93C5FD",
  onPrimary: "#0B0F19",
  danger: "#FCA5A5",
  onDanger: "#0B0F19",
  success: "#86EFAC",
  known: "#93C5FD",
  onKnown: "#0B0F19",
  anonymous: "#C4B5FD",
  onAnonymous: "#0B0F19",
  focus: "#93C5FD",
};

export type Scheme = "light" | "dark";
export const palettes: Record<Scheme, Palette> = { light, dark };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const type = {
  title: { fontSize: 24, lineHeight: 30, fontWeight: "700" as const },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "600" as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: "400" as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600" as const },
  small: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
};

export const MIN_TARGET = 44;
