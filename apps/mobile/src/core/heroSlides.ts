export type HeroSlide =
  | { id: string; kind: "statement"; text: string; support: string }
  | { id: string; kind: "quote"; text: string; attribution: string; support?: string };

/** Real product statements only. Nothing here may be invented or overpromise anonymity. */
export const STATEMENT_SLIDES: HeroSlide[] = [
  {
    id: "verified",
    kind: "statement",
    text: "Only verified USIU-Africa students can see what you post.",
    support: "You sign in with your university email and a one-time code. There are no passwords.",
  },
  {
    id: "anonymous",
    kind: "statement",
    text: "Post as yourself, or anonymously.",
    support: "Anonymous profiles are hidden from other students, not from our trust and safety team.",
  },
  {
    id: "reports",
    kind: "statement",
    text: "Reporting is as easy as posting.",
    support: "A moderator reviews every report. The person you report is not told it was you.",
  },
];

/** Beta-tester quotes go here, only with the person's consent. Empty on purpose. */
export const BETA_QUOTES: Extract<HeroSlide, { kind: "quote" }>[] = [];

export const HERO_SLIDES: HeroSlide[] = [...STATEMENT_SLIDES, ...BETA_QUOTES];
