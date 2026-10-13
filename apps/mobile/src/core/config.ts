import Constants from "expo-constants";

const FALLBACK_API = "http://10.0.2.2:3000"; // Android emulator's route to the host machine

export function apiBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
  const value = process.env.EXPO_PUBLIC_API_BASE_URL ?? extra?.apiBaseUrl ?? FALLBACK_API;
  return value.replace(/\/+$/, "");
}

export function legalBaseUrl(): string | null {
  const value = process.env.EXPO_PUBLIC_LEGAL_BASE_URL;
  return value && value.trim() ? value.replace(/\/+$/, "") : null;
}

export const LEGAL_DOCUMENTS = [
  { slug: "privacy", title: "Privacy policy" },
  { slug: "terms", title: "Terms of service" },
  { slug: "rules", title: "Community rules" },
  { slug: "cookies", title: "Cookies and trackers" },
] as const;

export type LegalSlug = (typeof LEGAL_DOCUMENTS)[number]["slug"];
