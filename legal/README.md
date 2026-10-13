# Legal and privacy drafts

All documents here are **drafts for a Kenyan data protection lawyer**. None are legal advice, none are ready to publish, and bracketed items are for the controller to fill in with real details. Nothing in them should be invented.

| Document | Version | Purpose |
|---|---|---|
| `DPIA.md` | 0.2 | Impact assessment for the identity link and anonymous profiles, with a verified gap list |
| `PRIVACY_POLICY.md` | 0.2 | What is collected, why, how long, your rights |
| `TERMS_OF_SERVICE.md` | 0.2 | Terms of use, moderation, appeals, closure |
| `COMMUNITY_RULES.md` | 0.2 | Short rules shown at sign-up |
| `COOKIES_AND_TRACKERS.md` | 0.2 | New. The service sets no cookies and uses no trackers; requirements for the app |

## Building the public pages

`npm install && npm run build` in this folder writes `site-dist/` (`privacy/`, `terms/`, `rules/`, `cookies/` and an index). Host it anywhere that serves static files and set `EXPO_PUBLIC_LEGAL_BASE_URL` in the app build to its address.

- Every page carries a visible draft notice, with a count of the `[bracketed]` details still to fill in, until the source documents no longer say DRAFT and have no placeholders left.
- `npm run build:release` **refuses to build** while any placeholder or DRAFT marker remains. Use that for the production site.
- The internal "do not publish until..." notes at the top of each draft are left out of the public page and stay in the source.
- The pages are plain HTML and CSS: no scripts, no external fonts, images or trackers, and they work at phone width and in dark mode.
- `DPIA.md` is internal and is not published by this script.

Last revised 2026-10-12 against the system as built (migrations `0001` to `0009`, 430 automated tests).

## What changed from v0.1 and why

v0.1 was written from the product spec before any code existed. v0.2 was written after building and testing the system, by checking each promise against the code. Result:

**Added or made specific**
- The real design: how the link is encrypted, which processes hold which keys, what moderators can and cannot see, and the database-enforced two-person rule for unmasking.
- Things v0.1 did not mention: follows and notifications, reports and the reporter's hidden identity, the automatic self-harm phrase check, appeals, warnings and their effect on anonymous profiles, sign-in records, server logs, and the banned-email fingerprint.
- Honest limits: operators hold the technical means to link profiles; style and screenshots are outside the app's control; a court order needs one approver.
- `COOKIES_AND_TRACKERS.md`, which the old policy referred to but did not exist.

**Corrected (v0.1 promised things the code did not do)**
- ~~Individually deleted posts and comments were not purged after 30 days.~~ **Fixed 2026-10-12.**
- ~~Photo files were never deleted, even when an account was purged.~~ **Fixed 2026-10-12.**
- ~~Expired codes, sessions and unattached uploads were not cleaned up.~~ **Fixed 2026-10-12.**
- ~~There was no way to correct profile details.~~ **Fixed 2026-10-12** (name, course, year; email and date of birth by request).
- ~~The data export was partial.~~ **Fixed 2026-10-12** (schema v2).
- ~~Retention periods for moderation records and the audit log were proposals, not implementations.~~ **Implemented 2026-10-12** with suggested starting values; counsel to confirm the periods.

## Publication blockers

Do not publish any of these until the items in `DPIA.md` section 0.1 are fixed (G1 to G5 and G8 are done; **only G6 and G7 remain**: both are drafted with working, verified tools, and are closed by a recorded rehearsal and a recorded restore drill, which only people can do), or the policy text that depends on them is removed. The retention fixes only take effect when the lifecycle job is run, so someone must own running it. The top of `PRIVACY_POLICY.md` lists the specific promises.

## Open decisions these documents depend on

1. Legal entity name, address and contact details.
2. Hosting provider and region (transfers, processors, encryption at rest).
3. The unmasking policy: which reasons are allowed, and whether university disciplinary cases count.
4. Whether warnings expire. **Suggested and implemented: 12 months.** Confirm.
5. Retention periods for moderation records, appeals and the audit log. **Suggested and implemented** (90 days dismissed, 1 year upheld, 3 years audit). Confirm with counsel. Also decide an appeal deadline: there is none yet.
6. Confirmed counselling and helpline details, and review of the self-harm phrases with counsellors.
7. Moderator coverage (nights, exams) and confidentiality terms.
8. Whether staff and students share an email domain.
