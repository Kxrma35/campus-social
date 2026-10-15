# Moku App: V1 Build Plan

Status: draft, 2026-10-12. Source spec: `~/Downloads/Moku App — V1 Product Spec.docx` (Oct 10, 2026).
Working name only; the app's name and brand are still undecided.

## 1. Goal

Prove that students at one campus (USIU-Africa) will post regularly when the audience is limited to verified peers. Success is judged by **weekly posters**, not downloads.

## 2. Decisions made

| Decision | Choice | Notes |
|---|---|---|
| Platform | Native mobile app | Chosen 2026-10-12 |
| Client | React Native + Expo (proposed) | Android first in practice; iOS from the same codebase |
| Backend | Node/TypeScript API + Postgres (proposed) | Single deployable service |
| Media | Object storage, EXIF stripped on upload | |
| Audience | 18+ only, USIU-Africa only | |

## 3. Open decisions (block building)

| # | Question | Recommendation | Owner |
|---|---|---|---|
| 1 | Hosting provider and region | Choose a provider with documentable transfer safeguards (Kenya DPA 2019) | karma |
| 2 | Team, moderators, legal entity details | Needed for legal pages; do not invent | karma |
| 3 | Staff vs student emails at USIU | Inspect real email patterns; fall back to manual approval or ambassador vouching for the closed test | karma |
| 4 | Graduates | Close account + data export in V1 | decided in plan, confirm |
| 5 | Unmask policy | Court orders and listed serious-harm cases only; exclude disciplinary cases | confirm |
| 6 | Night and exam moderation | Needs named people; fallback is lower auto-hide thresholds at night | karma |
| 7 | Student affairs engagement | Tell them before the beta | karma |
| 8 | App name and brand | Needed before store listings and legal pages | karma |
| 9 | Numeric targets for metrics and second-campus gate | Set after the seeded beta | later |

## 4. Architecture

```
Mobile app (Expo)  ->  API (Node/TS)  ->  Postgres
                                      ->  Object storage (photos)
                                      ->  Email service (one-time codes)
                                      ->  Push service
Admin dashboard (web) -> API (moderator role)
```

### Identity model

- `accounts`: verified university email, date of birth, ban/strike state, re-verification date.
- `profiles`: one `known`, at most one `anonymous`, per account. Normal queries never join the two profile types.
- `identity_links`: account-to-anonymous mapping in its own table/service, encrypted, with a restricted trust-and-safety role.
- `audit_log`: every `identity_links` lookup records who, when, and why. Append-only.

### Anonymity safeguards (build as tests, not just features)

- Separate follower graphs, suggestions and notifications per profile.
- Rounded timestamps and no online status on anonymous activity.
- EXIF stripped from every photo.
- Anonymous profiles excluded from name search.
- No public pages, indexing or share links.
- Automated tests that assert no API response exposes both profile IDs for one account.

## 5. Milestones

### M0: Foundations
- Resolve open decisions 1, 2, 3, 8
- Repo, CI, environments, secrets handling
- Data model and API contract

### M1: Accounts and verification
- University-email sign-up with domain allowlist, one-time code (10 min expiry)
- 18+ confirmation, terms acceptance, known profile setup
- Annual re-verification, read-only then close flow, graduate export
- Optional two-factor login

### M2: Posting core
- Text and up to 4 photos, comments, reactions, edit/delete
- Campus feed (newest and top), following, following feed
- Per-profile notifications (in-app and push)
- Composer safeguards: profile colour, always-visible posting identity, first-few-times confirmation

### M3: Moderation (must complete before anonymous profiles unlock)
- Reporting on posts, comments and profiles
- Auto-hide at 3 distinct reporters
- Admin dashboard: queue, content, reason, actions
- Warnings, suspensions, bans at account level, email re-signup block, one appeal
- Crisis post flagging with counselling and helpline links (numbers confirmed first)
- Urgent review target 1 hour, other 24 hours

### M4: Anonymous profile
- Unlock rules: account age and no strikes
- Generated handle and avatar
- Restricted identity link + audit log + lookup tool for T&S role
- Anonymity test suite passing

### M5: Compliance and launch readiness
- DPIA written and reviewed
- Privacy policy, terms, community rules, cookie/consent handling, data download and deletion
- 72-hour breach notification procedure
- Accessibility pass (contrast, labels, alt text, screen reader)
- Licence record for fonts, images and libraries
- Third-party SDK/tracker audit
- Kenyan data protection lawyer review

### M6: Validation and rollout (runs in parallel from M0)
- USIU student interviews and survey (before heavy build)
- Closed test (gate: reporting, dashboard, bans work)
- Seeded beta with ambassadors and seeded content
- Public launch at semester start or orientation
- Second campus only after metrics and moderation hold

## 6. Compliance checklist (applies throughout)

- [ ] Legal pages with real business details (not invented)
- [ ] Consent flows: unticked boxes, clear purpose, no bundled consent
- [ ] Collect only what the spec lists; no student ID photos, national IDs, contacts or precise location
- [ ] Audit third-party SDKs and trackers; no non-essential analytics before consent
- [ ] Data deletion and download mechanism
- [ ] No dark patterns; honest anonymity claims (no screenshot-proof promise)
- [ ] WCAG AA contrast, alt text, keyboard/screen reader support
- [ ] Licensed fonts, images and data, with sources recorded
- [ ] Legal text flagged as draft until a qualified lawyer reviews it

## 7. Risks

| Risk | Mitigation |
|---|---|
| Posting from the wrong profile | Colour-coded composer, confirmation prompts |
| Abuse through anonymous posting | Moderation ships first; unlock delay; account-level penalties |
| Empty feed at launch | Ambassadors and seeded campus content |
| Moderation overload | Thresholds, queue tooling, named night/exam coverage |
| Identity link leak | Isolated encrypted store, role restriction, audit log, minimal access |
| Legal exposure | DPIA, lawyer review, 18+ only, honest messaging |
