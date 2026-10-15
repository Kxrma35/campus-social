# Design: visual system and auth flow (M1)

Status: BUILT (2026-10-15) after owner approval. Decisions below were answered: the app is named Moku; this direction replaces the Dribbble one; the real API serves the flow and only the pending-approval screen is unreachable until open decision 3; dependencies `expo-image`, `expo-blur` and Figtree were added; the handle is now chosen at sign-up on the server. The profile photo was not built (see the end of this file). This replaces the system documented in commit 62a9375 (monochrome ink, Literata removed, floating tab bar); recover it with `git show 62a9375:apps/mobile/DESIGN.md`.

## Decisions I need from you before building

1. **App name.** The app was renamed to Moku in commit 62a9375 an hour before this brief, which says `APP_NAME` = "Campus Social". I will put the name in one `APP_NAME` constant. Which value should it hold: "Moku" (what is committed) or "Campus Social"?
2. **Visual direction.** PRODUCT.md currently records the Dribbble shot "Social Media App Design" (near-black ink, grey ground, pill tabs) as a binding brand commitment. This brief sets the sign-in reference as the direction instead. I read the new brief as superseding the old one for the whole app and will update PRODUCT.md's Brand Commitments on approval. Confirm.
3. **Mock API.** A real API for this flow already exists (sign-up, sign-in, codes, re-verification, 18+ check, rate limits) and the app is wired to it. "Never ship fake success" plus a mock behind a dev flag is only needed for the two screens the API cannot serve yet (below). Confirm that is acceptable, instead of mocking the whole auth module.
4. **Dependencies (ask-first rule).** Proposed additions: `expo-image` (placeholder and later real photos), `expo-blur` (glass caption card, with a solid fallback), and one bundled OFL font (below) via its `@expo-google-fonts` package. `expo-font` and `react-native-svg` are already installed. Nothing else, and no analytics or crash SDKs.
5. **Handle and photo at sign-up.** The API's sign-up accepts display name, course and year, and generates the handle on the server. Letting the student pick a handle or add a photo needs a backend change (endpoint fields, validation, photo upload before the account exists). Do you want that backend work in this pass, or should the setup screen show the generated handle read-only and leave the photo for the edit-profile screen?
6. **Pending approval (open decision 3).** The API has no "cannot classify this email" state, so the screen cannot be driven by real data. I will build the screen and its component, route to it only when the API says so, and leave it unreachable until decision 3 is made. It will not pretend to submit anything.

## What I take from the reference, and what I do not

Taken (language, not assets):
- A calm plain form beside a large rounded photo panel; on a phone the panel stacks above the form.
- The panel's concave top-left notch carrying a circular back button.
- A translucent dark glass caption card at the bottom of the panel with white text and a pair of small circular arrow buttons.
- A small centred logomark, short title, one-line subtitle, small labels above fields, hairline-bordered soft-radius inputs, a full-width near-black primary button with a soft shadow, underlined links, and the "Don't have an account? Sign up" line anchored near the bottom.
- Near-monochrome with a soft lavender-and-pink accent used sparingly.

Not taken: the photograph, the logomark (mine is an original pair of overlapping translucent circles, drawn in SVG, placeholder), the testimonial and its person, the "gigs" wording, the password field, the window chrome dots.

Fixed for accessibility: the reference's pale grey helper text (about 2.5:1) becomes `inkMuted` at 6.8:1; its small arrow buttons become 44pt targets.

## Layouts

**Phone (width under 600pt).** Scroll-free where possible, scrolling when the keyboard or font scale demands it.
- Photo panel on top, about half the screen height, inset 12pt from the edges, 28pt corner radius, concave notch top-left holding a 44pt circular back button (hidden on the first screen of the flow).
- Caption card inside the panel's bottom edge: dark glass, 16pt inset, a statement line, a supporting line, a "n of N" indicator, previous and next circular buttons (44pt targets).
- Below the panel: logomark, title, subtitle, fields, primary button, link row. "Don't have an account? Sign up" sits at the bottom edge of the safe area.
- When the keyboard opens, the panel collapses to a short band (about 25% of height) so the primary button stays reachable. With system font scale above 150% the panel is dropped to a 96pt decorative strip and the form scrolls.

**Tablet and wide (600pt and up).** The reference's split: form column left (max 420pt, vertically centred, logomark top), photo panel right (fills the remaining width, same radius and notch, caption card bottom). On portrait tablets the split is 45/55.

## Screen list

| # | Screen | Status |
|---|---|---|
| 1 | Sign in: university email, "Send code", inline error for non-USIU emails | Exists (email.tsx); restyle, add USIU-domain inline check mirrored from the server rule |
| 2 | Code entry: 6 digits, OS one-time-code autofill, 10-minute expiry countdown, resend with cooldown, change email | Exists (code.tsx); new OtpInput, expiry and cooldown |
| 3 | Sign-up details: date of birth with 18+ confirmation | Exists in details.tsx; split into its own step |
| 4 | Under-18 stop screen: respectful, creates nothing, clears entered data | New. The current screen shows an inline error and keeps the form state |
| 5 | Agreements: three separate unticked checkboxes (Terms, Privacy, Community Rules), each linking to a screen marked DRAFT | Changes. Today one bundled checkbox covers all three, which breaks the no-bundled-consent rule |
| 6 | Known profile setup: display name, course and year optional, handle and photo per decision 5 | Partly exists |
| 7 | Done | New, short |
| 8 | Pending approval | New, see decision 6 |
| 9 | Annual re-verification | Exists (settings/reverify.tsx); reuses OtpInput |
| 10 | DRAFT placeholder screens for the three agreements | Exist as legal links; restyled and clearly marked DRAFT, no legal text written |

Every screen covers: loading, wrong code, expired code, too many attempts, rate-limited, offline, server error. Errors render in an `InlineError` that is announced to screen readers (`accessibilityLiveRegion="polite"`, role alert).

## Token set (one theme module, light and dark)

No pure #000, #fff or flat grey anywhere. Ratios computed with WCAG relative luminance.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `bg` | #F6F4F7 | #14121A | tinted off-white / near-black |
| `surface` | #FCFBFD | #1D1A25 | inputs, cards |
| `ink` | #1B1822 | #EEEAF4 | 16.0:1 / 15.7:1 on bg |
| `inkMuted` | #58535F | #B2ACBD | helper text; 6.8:1 / 8.4:1 on bg |
| `border` | #8A8493 | #7C7689 | hairline, 3.3:1 / 4.3:1 on bg (component border floor is 3:1) |
| `primary` / `onPrimary` | #1B1822 / #F6F4F7 | #EEEAF4 / #14121A | the near-black button; 16.0:1 / 15.7:1 |
| `accentLavender` | #B8A6E8 | #8E7BD1 | decorative only, never text |
| `accentPink` | #E9A9D2 | #C77FB0 | decorative only, never text |
| `accentText` | #5B3FB5 | #C3B1FF | accent used as text or icon; 6.8:1 / 9.8:1 |
| `identity.known` | #3B3F9E (indigo) | #A9AEFF | 8.0:1 / 9.0:1 on bg |
| `identity.anon` | #9A2A6B (plum) | #F0A3CF | 6.6:1 / 9.6:1 on bg |
| `danger` | #A3262F | #FF9AA2 | 6.7:1 / 9.2:1 |
| `glass` | ink at 78% over the photo | same | caption card; white text 8.5:1 worst case over a white photo (70% would give 6.3:1, 60% fails at 4.4:1) |

Identity colours differ in hue, but colour is never the only signal: `IdentityBadge` always carries a text label ("Your profile" or "Anonymous profile") and an icon with different shapes (a single filled disc for known, two overlapping outline circles for anonymous).

Other values in the module: spacing 4/8/12/16/24/32/48, radius 10 (inputs), 14 (cards), 28 (photo panel), 999 (circles and pills), touch target 44, panel notch radius 20, shadow `button` (one soft, low-opacity drop) used only on the primary button.

## Typography

Quiet and small: title 22/28 semibold, subtitle 14/20, label 13/18 medium, body 16/24, input 16/24, helper 13/18, link 14/20 underlined, caption 12/16 (never below 12). All sizes scale with the system font setting up to 200%; layouts use min-heights, no fixed text boxes.

Font: **Figtree** (SIL OFL 1.1), weights 400, 500 and 600, bundled at build time through `@expo-google-fonts/figtree` and `expo-font`, never fetched at run time. Licence and source go into `docs/licences.md`. Alternative if you prefer something with more character: Instrument Sans (also OFL).

## Components

`Screen`, `Button` (primary, secondary, link), `TextField`, `OtpInput`, `Checkbox`, `IconButton` (circular, 44pt), `HeroPanel` (photo, notch, caption card, pager), `InlineError` and `Banner`, `IdentityBadge`, plus `Logomark` and an `APP_NAME` constant. Existing components with the same names are reworked in place, not duplicated.

`HeroPanel` details: slides are typed (`{ id, kind: "statement" | "quote", text, support?, attribution?, photo, alt }`). Day one ships real product statements only, for example "Only verified USIU-Africa students can see posts." and "You can post under your own name, or anonymously. Anonymous means hidden from other students, not from trust and safety staff." The `quote` kind is a typed slot for beta-tester quotes, empty until you provide real, consented text. The pager never auto-advances, previous and next are labelled buttons, and the "n of N" text is announced.

Photos: until real ones exist, the panel shows an original generated greyscale texture drawn locally, with a visible "Placeholder image" label in the corner, marked decorative for screen readers. No stock photo is bundled.

## Accessibility checks that become tests

- A unit test enumerates every text-on-background token pair in both themes and asserts the ratio (4.5 for text, 3 for large text, borders and icons).
- RNTL tests for each auth screen use accessible queries (role and label), covering error announcement, disabled states, focus order, and that the three agreement boxes start unticked and are independent.
- Reduce Motion is respected (no panel transition when it is on).
- No analytics, tracking, contacts, phone numbers, location or ID photos are collected; the only fields are those in the flow list.

## Files this will touch

Theme module and components under `src/theme` and `src/ui`; auth screens under `src/app/(auth)`; the re-verification screen; `src/core/config` for `APP_NAME`; `docs/licences.md` (new, consolidating the font, placeholder art and icon records that currently live in `legal/COOKIES_AND_TRACKERS.md`); `.gitignore` (the Impeccable block, only if missing when I get there); `PRODUCT.md` Brand Commitments (on approval of decision 2). The reference images live in `docs/design/reference/` (`signin-reference.png`, `feed-reference.png`).

## Blocked by open decisions in BUILD_PLAN.md

- Decision 2 (legal entity details): the DRAFT agreement screens carry no business details.
- Decision 3 (staff vs student emails): the pending-approval screen cannot be driven by real data.
- Decision 8 (app name and brand): `APP_NAME` and the placeholder logomark are constants to swap.

## Built, and what was left out

- Built: theme module with light and dark palettes and an AA contrast test; Figtree bundled; `Logomark`, `IconButton`, `InlineError`, `IdentityBadge`, `OtpInput`, `HeroPanel` (notch, glass caption card with solid fallback, labelled pager that never auto-advances), `AuthShell` (phone stack, tablet split, keyboard and large-text collapse); screens welcome, email, code, birthdate, underage, agreements, DRAFT documents, profile, done, pending approval; re-verification reuses `OtpInput`.
- Backend: sign-up accepts an optional chosen handle (3 to 20 characters, reserved words and anonymous-style handles refused, uniqueness checked before the code is used). A chosen handle is kept when the display name later changes.
- Not built: **profile photo at sign-up.** A photo other students can see needs moderator tooling to review and remove it, a data protection impact assessment update, and serving rules, which belong with milestone M3. Until then the profile shows initials.
- Not reachable yet: pending approval (open decision 3).
- Not changed: package ids, URL scheme and database name still use the old working name.

## Home feed (2026-10-15)

The feed follows the sign-in language: calm, tinted ground, Figtree, near-black actions.

- Top bar: the logomark and app name on the left, a circular bell on the right.
- Writing prompt: an input-styled row (hairline border, card surface) with the posting avatar, the placeholder "What is on your mind?" and a `ProfileChip` reading "Posting as you" or "Posting as anonymous", so the identity that will post is always visible before the composer opens.
- People you follow: a quiet rail with rounded-square avatars and name pills, hidden on the Following tab and when the student follows nobody.
- Tabs: three separate pills, the selected one filled near-black like the primary button.
- Posts: unboxed rows separated by a hairline, not cards. Author line with avatar, name, handle and time; an `IdentityBadge`-style chip with an icon and the words Student, You or Anonymous; text at 16/24; photos lead the text, 22pt rounded and inset; a quiet action row.
- States: a static skeleton while the first page loads (nothing animates), an empty state with the logomark and a plain sentence, an error notice with Try again.
- Wide screens: header, prompt, tabs and posts share one centred 640pt column.
- Not built: the two-disc posting-as switch in the composer, and haptics on like.

## Composer (2026-10-15)

- Posting-as switch: a radio group of two options, "You" and "Anonymous", each a rounded-square avatar (initial or the two-circle mark), a title, a short plain line ("Your name is shown", "Hidden from other students") and a radio dot. The selected option has a 2px border in its identity colour, a soft fill and a filled dot, so selection never rests on colour alone. Targets are at least 64pt tall. Shown only when the student has an anonymous profile, and the composer always opens on the known profile so anonymous posting stays a deliberate act.
- Below it, the `ProfileChip` "Posting as you" or "Posting as anonymous" and one sentence on what other students will see, announced politely when it changes. A 3px rule in the identity colour sits under the group.
- Switching with photos attached asks first: the photos were prepared under the current profile and are removed on switching, with "Switch and remove photos" and "Keep my photos". Without photos the switch is immediate.
- Unchanged: the first-few-times anonymity confirmation, photo descriptions, the character count under the field, and the support panel after a flagged post.
