const PATTERNS: RegExp[] = [
  /\bkill(?:ing)?\s+(?:my\s*self|myself)\b/i,
  /\bend(?:ing)?\s+(?:it\s+all|my\s+life)\b/i,
  /\bsuicid(?:e|al)\b/i,
  /\bwant(?:ed)?\s+to\s+die\b/i,
  /\bdon'?t\s+want\s+to\s+(?:live|be\s+here|be\s+alive)\b/i,
  /\b(?:hurt|hurting|harm|harming|cut|cutting)\s+my\s*self\b/i,
  /\bself[-\s]?harm\b/i,
  /\bbetter\s+off\s+(?:dead|without\s+me)\b/i,
  /\bno\s+reason\s+to\s+(?:live|go\s+on)\b/i,
  /\bcan'?t\s+go\s+on\b/i,
];

export function suggestsSelfHarm(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
}

export interface SupportResource {
  name: string;
  contact: string;
}

export interface SupportInfo {
  message: string;
  resources: SupportResource[];
}

export const DEFAULT_SUPPORT_MESSAGE =
  "If you are going through a hard time, you do not have to face it alone. " +
  "Please talk to someone you trust or reach out to a support service.";

export function buildSupportInfo(resources: SupportResource[] = []): SupportInfo {
  return { message: DEFAULT_SUPPORT_MESSAGE, resources };
}
