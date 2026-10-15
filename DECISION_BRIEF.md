# Moku: decisions needed before a pilot

**Prepared:** 2026-10-12 · **Status:** draft for discussion · **Audience:** the controller, a Kenyan data protection lawyer, USIU-Africa student affairs and counselling

## What it is

A mobile app for verified USIU-Africa students (18+). Each student has a known profile and may add one anonymous profile. Other students cannot link the two; the operator can, in defined cases, under a two-person rule. That link is the main privacy risk, and most decisions below follow from it.

## Where the work stands

The server and app are built and tested: sign-up with university email, posting, follows, reporting and moderation, appeals, data export, account closure, retention and deletion. Not done: a test on real phones, a breach rehearsal, a key restore drill, lawyer review, and hosting. Nothing has been published or piloted.

## Decisions needed

| # | Decision | Recommendation | Who decides | Blocks |
|---|---|---|---|---|
| 1 | **Who is the data controller** (legal entity, address, contacts, data protection contact) | A named, registered body. Not an individual's personal name | Project owner, with counsel | Policies, contracts, registration, sending domain |
| 2 | **Hosting provider and region** | Managed Postgres in an African or EU region with a documented transfer basis; link keys in the provider's secret store | Controller, counsel confirms transfer safeguards | Processor contracts, policy wording, launch |
| 3 | **When may an anonymous profile be unmasked** | Court orders and a short listed set of serious-harm cases only. Disciplinary cases excluded. Two named approvers | Controller, counsel, USIU | The "unmasking" section of the privacy policy |
| 4 | **Staff vs student email domains** | Inspect real address patterns; if staff share the domain, use manual approval or ambassador vouching for the closed test | Project owner with USIU IT | Who can sign up |
| 5 | **Moderation coverage and appeals** | Named people for nights and exam periods; a fixed appeal deadline | Controller, USIU student affairs | Safe operation; ban and appeal terms |
| 6 | **Crisis resources** | USIU counselling plus a verified national helpline, shown to a student whose post is flagged | USIU counselling; national line verified by the controller | Safety flow. No number is hard-coded |
| 7 | **Confirm retention periods** | Suggested: deleted posts 30 days; unfinished sign-ups and codes 24 hours; dismissed reports 90 days; upheld reports, actions and bans one year; unmask audit log three years | Controller, counsel | Deletion promises in the policy |
| 8 | **Email provider and processor contracts** | Any SMTP provider; contract with data-protection terms before launch | Controller | Sign-in codes reach students |
| 9 | **Engage student affairs before the beta** | Tell them before recruiting testers | Project owner | Trust and access |

## What each reader is asked to do

- **Lawyer:** confirm registration duty, lawful bases, transfer safeguards, the retention periods in #7, the unmasking policy in #3, and whether moderator notes are disclosed in a data request.
- **USIU:** confirm the email domain question (#4), provide counselling contacts (#6), and nominate a contact for escalations (#5).
- **Controller:** decide #1 and #2 first; the others depend on them.

## Main residual risk

Two things no design removes: an insider who holds both the encryption keys and database access, and identification by writing style. The impact assessment rates overall residual risk **high** until the breach procedure is rehearsed and a key restore drill is done, and **medium** after that.

*Detail: `legal/DPIA.md`, `ops/BREACH_PROCEDURE.md`, `ops/KEY_CUSTODY_AND_RESTORE.md`.*
