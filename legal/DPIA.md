# Data Protection Impact Assessment (DPIA)

> **DRAFT v0.2. Not legal advice.** Prepared under the Kenya Data Protection Act, 2019 (duty to assess high-risk processing). A Kenyan data protection lawyer should review and sign off before launch. Section numbers and exact regulatory duties are for counsel to confirm. Fill in [BRACKETS]; do not invent details.

**Project:** [app name], V1, USIU-Africa
**Controller:** [legal name, address]
**Assessor:** [name / role]
**Date:** 2026-10-12 · **Version:** 0.2 (v0.1 was written from the spec before any code existed)

**Basis for this version:** the system as built and tested on 2026-10-12: migrations `0001` to `0009`, 430 automated tests including 163 against a real PostgreSQL, and a deliberate-weakening check on the anonymity, moderation and retention controls. Claims below say whether something is **built and tested**, **built but not verified**, or **not built**. Where a claim in an earlier draft turned out not to be true, this document says so.

---

## 0. Summary

**What is strong.** The identity link between a student and their anonymous profile is encrypted with a key kept outside the database, bound to the account so it cannot be moved between accounts, and readable only through a database function that records every lookup and refuses non-court lookups without a second, different approver. Moderators can warn, suspend and ban an anonymous profile without ever learning who owns it, and cannot see who filed a report. Content is isolated per campus in the database itself. These properties were each checked by breaking them on purpose and confirming a test failed.

**What is not yet acceptable.** Several promises in the earlier policy drafts were not implemented. The retention ones (G1 to G3, and G5 pending counsel's confirmation of the periods) were fixed and verified on 2026-10-12. The data-subject-rights ones (G4, G8) were fixed and verified on the same day. Only the process ones (G6, G7) remain and are listed in section 0.1; they must be fixed or the policies must not make the promise.

**Residual risk overall:** **High until G6 and G7 in section 0.1 are closed (and counsel confirms the G5 periods and the export scope); Medium afterwards**, driven mainly by the two properties no design removes: insiders who hold both the keys and database access, and identification by writing style.

### 0.1 Must fix before launch

> **Status update (2026-10-12):** **G1, G2 and G3 are fixed and verified** (migration `0007`; 20 unit tests, plus 16 tests against a real PostgreSQL and a real directory, each also checked by deliberately weakening the code). They take effect **when the lifecycle sweep is run**, which is still a manual command (risk R21). **G5 is implemented and verified** with suggested starting values (dismissed reports 90 days; upheld reports, actions, ended suspensions and bans one year; warnings 12 months; appeal text one year; unmask audit log three years; legal holds), in migration `0008` and the same job. 36 tests run against a real PostgreSQL, and each rule was checked by deliberately weakening the database function. **The periods themselves still need counsel's confirmation.** **G4 (profile correction) and G8 (complete export) are fixed and verified** (migration `0009`; 20 unit tests plus 19 against a real PostgreSQL, with every guard also checked by deliberately weakening it; one test gap, the service trusting a request-supplied profile id, was found that way and closed). **G6 (breach procedure) and G7 (key restore drill) now have drafted runbooks and the tools they depend on (`ops/`), but remain open.** A runbook is closed by a rehearsal and a restore drill, which only people can do and record. The tools (session revocation, key verification, key rotation) are **verified against a real PostgreSQL** (23 tests; every safeguard also checked by deliberately weakening it), and the unreadable-link handling that writing the runbook exposed is fixed and verified.

| # | Gap (verified in code) | Why it matters | Needed |
|---|---|---|---|
| G1 | **Photo files are never deleted.** The storage interface has no delete operation. Purging an account removes database rows but leaves the image files. | A closed or purged student's photos persist indefinitely, contradicting the deletion promise. | **Fixed.** The photo store can delete; files are removed when posts, uploads and accounts are purged, through a queue that retries failures. |
| G2 | **A post or comment you delete yourself is never hard-deleted.** It is soft-deleted (hidden) and stays in the database. Only a *closed account's* content is purged. | The "removed within 30 days" promise is untrue for individual deletions. | **Fixed.** Items deleted more than 30 days ago are purged with their photos, unless a report on them is unresolved. |
| G3 | **Expired one-time codes, expired sessions and unattached photo uploads are never cleaned**, except when the whole account is purged. People who start sign-up and never finish keep a row holding their email address indefinitely. | Retention without a purpose; personal data on non-users. | **Fixed.** Codes after 24 hours; sessions 7 days after they expire or are revoked; unattached uploads after 24 hours. |
| G4 | **No way to correct profile details** (name, course, year). There is no edit endpoint. | The right to correction (Act, data subject rights) is not met by the product. | **Fixed.** `PATCH /me/profile`: name, course and year, with the handle refreshed when the name changes, 5 edits per 30 days, known profile only. **Email and date of birth are not self-editable** and need a documented request process (counsel to confirm). |
| G5 | **Retention of moderation records, appeals and the unmask audit log is a policy, not an implementation.** Nothing deletes them. | Records are kept longer than any stated period. | **Implemented and verified** with suggested starting values (migration `0008`). Counsel to confirm the periods. |
| G6 | **No breach-response procedure** and no monitoring that would detect a breach. | The Act's 72-hour notification duty cannot be met without detection and a rehearsed process. | **Drafted** (`ops/BREACH_PROCEDURE.md`): roles, 72-hour clock, severity, containment toolbox, assessment, notification templates, tabletop scenarios. **Still open:** name the people, run and record a rehearsal, and add detection (nothing alerts anyone today). Counsel to confirm the statutory references. |
| G7 | **Key backup and restore has not been tested.** Losing the link encryption keys makes every anonymous link permanently unrecoverable. | Closure, export, ban cleanup and acting as the anonymous profile would stop working for those profiles. | **Runbook and tools built** (`ops/KEY_CUSTODY_AND_RESTORE.md`, `npm run verify-keys`, `npm run rotate-keys`). **Still open:** choose custodians and storage, back the keys up, and run the restore drill with a second person. |
| G8 | **The data export is partial** (account, profiles, posts with photo references, comments, who you follow). It omits reactions, notifications, reports you filed and your moderation history. | The access right may require more. | **Fixed.** Export schema v2 covers 14 categories, counts followers rather than listing them, and withholds reporters, free-text from reporters, moderator names and other people's content, listing what is withheld. Counsel to confirm scope, including whether moderator notes are disclosed. |

G1 to G3 are done. The rest need a decision, a process, or counsel rather than only engineering.

---

## 1. Why a DPIA is needed

The service links a verified real identity (a university email) to an anonymous profile and keeps that link so that serious abuse can be acted on. A leak or misuse of the link could expose students to harassment, discipline, family conflict or physical harm. Other factors that raise the risk:

- Posts can reveal sensitive information (opinions, health, sexuality, religion, politics).
- The audience is young adults, some of whom may be vulnerable, and posts may disclose distress.
- Posts and comments are automatically checked for phrases that may suggest self-harm (section 3).
- Moderators, including trained student moderators, see reported content, which can be intimate or distressing.

---

## 2. Description of processing

**Purpose:** a student-only social app where each verified student has one known profile and may add one anonymous profile.

**Data subjects:** USIU-Africa students aged 18 or over. People who start sign-up without completing it are also affected: their email address is held until the one-time code is cleaned up (24 hours after the sweep runs).

### 2.1 Data inventory (as built)

| Data | Where | Visible to | Kept |
|---|---|---|---|
| University email | `accounts` | Sign-in service, lifecycle job; trust & safety only through an audited unmask | Account life; replaced by a placeholder at purge |
| Date of birth | `accounts` | Same | Account life; removed at purge. *Could be reduced to an "18+ confirmed" flag.* |
| Terms version accepted and when, last re-verification, due date, account status, warning count | `accounts` | Sign-in service, lifecycle job | Account life; tombstone keeps status |
| Known profile: real name, handle, course, year | `profiles` | Students at the same campus | Until purge |
| Profile photo for the known profile (optional; never for an anonymous profile, enforced by a database constraint) | image file in object storage, linked from `profiles.avatar_upload_id` through `photo_uploads` | Signed-in students at the same campus; moderators when the profile is reported | Until the student replaces or removes it, then the file is deleted by the next clean-up (released uploads are removed after 24 hours); deleted with the account at purge; included in the data export as an upload record |
| Anonymous profile: generated handle and avatar key; creation date rounded to the day | `profiles` | Students at the same campus | Until purge |
| **Encrypted link** account to anonymous profile, plus key version | `identity.anonymous_links` | Nobody by direct query; read only by the services that hold the key | Account life; deleted at purge |
| **Blind index** (keyed HMAC of the anonymous profile id) | `identity.anonymous_links` | Same | Same |
| Posts, comments, reactions | content tables | Campus students (anonymous authors shown with generated handle and times rounded to the hour) | Until deleted, then purged after 30 days (kept while a report on it is unresolved); purged with the account |
| Who a profile follows; follow counts | `follows` | Counts: campus students. Lists: only that profile | Until purge |
| In-app notifications | `notifications` | Recipient profile only | Until purge |
| Photos | image file in object storage plus `photo_uploads` and `post_photos` rows | Signed-in students at the uploader's campus; moderators if reported | Deleted with the post after 30 days, or at account purge; uploads never attached after 24 hours |
| Reports: reason, free-text detail, target, source (person or automatic), status, resolved-by | `moderation.reports` | Moderators (without the reporter) | Dismissed: 90 days after dismissal. Upheld: 1 year after resolution. Open: until resolved. Held under a legal hold. |
| **Reporter's account id** against each report | `moderation.reports` | Nobody through the application; only a database administrator | Same as the report it belongs to |
| Moderation actions, penalties (warning, suspension, ban), appeal text and decisions, moderator name | `moderation.*` | Moderators (without account ids) | Actions and ended suspensions or bans: 1 year after resolution. Warnings: stop counting and are deleted at 12 months. **A ban in force is kept.** Appeal text and notes: removed 1 year after the decision, leaving a bare row so "appeal once" holds. |
| Unmask audit log: who looked, with which login, why, case reference, second approver | `identity.lookup_audit` | Trust & safety | 3 years, then deleted through one audited database function, and each purge is itself logged. Rows for a case under legal hold are kept. Does not store the unmasked person's identity. |
| Photo descriptions (alt text), written by the author, up to 500 characters | `photo_uploads.alt_text` | Same as the photo: other students at the campus; moderators | Deleted with the photo; included in the data export. Treated as user content (can be reported with the post) and can identify someone if the author writes identifying details, so the composer warns anonymous authors |
| Rate limit counters: a short-lived count per network address or per hashed session token | API process memory only | The API process | Gone within 10 minutes to 1 hour, and on restart; never written to the database |
| Database backups: a copy of everything above except the keys, encrypted to a public key | Backup storage [to choose] | Custodians holding the private key | [Retention to set: suggest 35 days, then deleted] |
| Reminder log: account id, which reminder, the threshold and the cycle (no message text) | `account_reminders` | Maintenance job | 400 days after sending |
| One-time codes: the email address and a keyed hash of the code | `email_codes` | Sign-in service | 10 minute validity; rows deleted after 24 hours |
| Sessions: hashed token, account id, optional device label, created, expires, revoked | `sessions` | Sign-in service | 30 days validity; rows deleted 7 days after expiry or revocation |
| Banned email: **unsalted SHA-256 of the address** | `banned_emails` | Sign-in service | Indefinitely (needed to block re-sign-up) |
| Server request logs: IP address, time, method, URL path (which contains object ids), status. The Authorization header is redacted and request bodies are not logged. | Application logs | Operators | [period: set at hosting] |
| Push tokens | `push_tokens` table exists | | **Not collected yet** (push not built) |

Not collected: student ID photos, national ID numbers, phone contacts, precise location, advertising identifiers.

### 2.2 Flow and who can reach what

```
Student app --> Student API (own DB login: app_api / auth_service / account_lifecycle)
Moderators --> Admin service (separate process, moderator DB login, own tokens)
Trust & safety --> `unmask` command (their OWN named DB login)
```

| Process | Encryption keys | Blind-index key | Database login(s) | Can read `accounts` | Can read the link table |
|---|---|---|---|---|---|
| Student API | holds (needed to resolve the anonymous profile) | holds | `app_api` (content), `auth_service` (sign-in, identity), `account_lifecycle` (closure, export) | only via `auth_service` and `account_lifecycle` | forward lookup only, via `auth_service` and `account_lifecycle`; never by `app_api` |
| Lifecycle sweep (`npm run lifecycle`) | holds | holds | `account_lifecycle` | yes | forward lookup only |
| Admin service | **no** | holds | `moderator` | **no** | **no** |
| Trust & safety unmask | no | holds | the officer's own named `trust_safety` login | only through the audited function | only through the audited function |

Forward lookup means "this account's anonymous profile". Nothing except the audited functions can ask the reverse question, "which account owns this profile".

### 2.3 Recipients

[Hosting provider], [object storage provider] (photos, when not on the same host), [email provider] (one-time codes) and [push provider, when added], all as processors under contract; authorities on a valid legal order. Moderators (staff and trained student moderators) see reported content. No analytics, advertising or tracking SDKs are used by the server code. The email provider receives each recipient's university address and the one-time code in the message body, so it can see the content of every sign-in; it is a processor and needs a contract before launch. Messages are plain text with no links or tracking, and the server never logs addresses or codes. The mobile app now exists; its dependencies (Expo SDK 57 and listed packages) have not been through a formal licence and SDK privacy audit.

---

## 3. Necessity and proportionality

| Question | Assessment |
|---|---|
| Is each data item needed? | Yes, with one question: date of birth is only needed to check 18+, so an "18+ confirmed" flag would be more minimal. [Counsel/controller to decide.] |
| Lawful basis | Contract (the service), consent (optional features such as push when added), legitimate interests and legal obligation (safety, abuse prevention, legal orders). [Counsel to confirm per item.] |
| Is the identity link necessary? | Yes. It lets account-level penalties and bans work and lets legal orders be answered. A design with no link was considered and rejected because bans become trivially evaded. The link is minimised: encrypted, key held outside the database, reachable only through audited functions. |
| **Automated phrase check** | Posts and comments are matched against a short list of self-harm phrases. A match creates an urgent item for a moderator and shows the author support information. **It does not hide content, penalise anyone, or take any decision with a legal or similar effect**, so it is not solely automated decision-making in the sense of the Act [counsel to confirm]. It is crude: it misses indirect wording and other languages and flags quotes and lyrics. Necessity is high (a student in crisis); proportionality depends on human review and on disclosure, which the policy must make. |
| Transparency | A plain sentence is shown at sign-up and again when the anonymous profile is created ("Other students can't see who you are. We can, if you seriously break the rules or the law requires it."). The service never promises screenshot protection or protection from recognition by writing style. |
| Data subject rights | Access and portability: JSON export built (partial, G8). Deletion: account closure then purge built; individual-item purge not built (G2). Correction: not built (G4). Objection and consent withdrawal: no optional processing is live yet. |
| Minimisation of subjects | 18+ only; one campus; allowlisted university domain. |
| Processors | Contracts with data-protection terms required before launch; none exist yet. |
| Cross-border transfers | [Depends on the hosting choice; undecided.] |

---

## 4. Risk assessment

Likelihood (L) and severity (S): Low / Medium / High. "Built" means implemented **and** covered by an automated test unless stated otherwise.

| # | Risk | L | S | Mitigations built | Outstanding | Residual |
|---|---|---|---|---|---|---|
| R1 | **Database leak exposes who owns anonymous profiles** | Low–Med | High | AES-256-GCM with a key held outside the database; account id bound as authenticated data so a blob copied to another account fails; fresh IV each time; separate keyed blind index; no role can reverse-look-up; tampering and swapping are tested | Key management in hosting (KMS/secret store) | **Low–Med** |
| R2 | **Compromise of the student API host**, which holds the keys and database access and must decrypt links to let a student act anonymously | Low–Med | High | Least-privilege database roles; admin and unmask processes never hold the encryption key; keys are not in the database or the repo | Host hardening, secret storage, monitoring, consider KMS so keys never sit in application memory. Inherent in a server-side design. | **Medium–High** |
| R3 | **Insider misuse of unmasking** (curiosity, pressure) | Med | High | Only a database function can do it; every lookup, including empty ones, is audited with the officer's real login (cannot be spoofed); audit log is append-only; non-court reasons need a different second approver, enforced in the database before any lookup; the officer cannot read accounts directly or call the bare function | Alerts/review of the audit log; keeping the group small; **a court order needs only one person**, so counsel should require a documented check of the order; no technical control on *which* reasons are legitimate (policy decision #5) | **Medium** |
| R4 | **Loss of link encryption keys** | Low | High | Key versioning and rotation supported and tested; `verify-keys` proves a set of keys opens every link; runbook with custody rules, drill and loss consequences; an unreadable link is skipped and reported by the maintenance job and gives a clean 503 to the student, instead of crashing | **The restore drill has not been done (G7)**; custodians and storage are undecided | **Medium** until drilled |
| R5 | **Accidental unmasking through metadata** | Med | High | EXIF/GPS removed by re-encoding (tested with planted GPS); times rounded to the hour for anonymous posts, comments and the notifications they cause; separate follow graphs and notifications per profile; follower lists visible only to the profile itself; anonymous profiles are not searchable; generated handle and avatar use nothing from the person; profile creation date rounded to the day; no response about an anonymous profile (feed, profile, comments, notifications) carries the account id or the known profile id | **Exact timestamps are still stored** for anonymous posts (only the API view is rounded), so someone with database access could correlate them with the same person's other activity; server logs hold IP and exact request times | **Low–Med** |
| R6 | Identification by writing style or content | Med | Med | Disclosed; nothing claims otherwise | None possible | **Medium (accepted)** |
| R7 | Screenshots and resharing | High | Med | Honest wording; no public pages or share links | None possible | **Medium (accepted)** |
| R8 | Harassment through anonymous posting | High | High | Reporting; auto-hide at 3 different people (one person on two profiles counts once); urgent-first queue with response targets; penalties on the account; anonymous profile locked for new accounts and accounts with a warning; limits of 20 posts, 60 comments and 30 reports per hour per person | Moderator coverage at night and exams is undecided; **nothing alerts anyone when a report is overdue** | **Medium** |
| R9 | **Moderator access and abuse** | Med | Med | Moderators see content and reasons only, with no reporter id and no account id (enforced by column-level database privileges and tested); every action records the moderator; separate process and database login | Tokens are long random bearer secrets with no expiry or second factor; confidentiality terms and training for student moderators; some content is distressing | **Medium** |
| R10 | **Reporter exposure or retaliation** | Low–Med | Med | Reporter identity is stored only as an account id, unreadable to moderators and never shown to the reported person; one report per person per target; answers never reveal counts | A database administrator can read it; free-text detail may identify the reporter | **Low–Med** |
| R11 | Under-18s join | Low–Med | High | 18+ confirmation required and date of birth checked before the code is consumed or anything stored (tested) | No identity verification; a school-issued university email is the only gate | **Low–Med** |
| R12 | **Non-students or staff gain access** | Med | Med | Domain allowlist; annual re-verification | **Open question unresolved:** whether staff share the student email domain | **Medium (open)** |
| R13 | Sharing with the university or authorities beyond policy | Low | High | No routine sharing is built; unmasking only through the audited function | Policy decision #5 (court orders only, or also disciplinary cases); a written procedure for legal orders | **Low** (depends on policy) |
| R14 | Cross-border transfer without safeguards | Med | Med | None possible until hosting is chosen | Choose hosting; document safeguards or consent | **Open** |
| R15 | **Breach not detected or not notified in 72 hours** | Low | High | Draft procedure with roles, clock, containment toolbox and notice templates; session revocation tool; legal holds to preserve evidence | People not named; **no rehearsal (G6)**; no alerting, no export or moderator-view logging, request-log retention unset; hosting undecided | **Medium** |
| R16 | **Excess retention and orphaned data** | Med | Med | Closed-account purge; at purge the email is replaced and date of birth removed. **Self-deleted posts and comments are purged after 30 days** (kept while a report on them is unresolved, so deleting cannot destroy evidence). **Photo files are deleted** through an outbox queue written in the same transaction as the row deletion, so a failed deletion is retried rather than orphaned. Expired codes (24 hours), sessions (7 days) and unattached uploads (24 hours) are cleaned. All verified against real PostgreSQL and a real directory. | the periods are suggested values awaiting counsel; all of this runs only when the sweep is run (R21); files that were written but never got a database row (a crash between the two writes) are not reconciled | **Medium** |
| R17 | Third-party code | Low | Med | Server dependencies are Fastify, pg, zod and sharp (Apache-2.0); no analytics or advertising | Dependency and licence record; the **mobile app is not built**, so its SDKs are unaudited | **Low** |
| R18 | **Automated self-harm flag is wrong** | High | Med | Only creates a moderator item and shows the author support information; never penalises; an error never loses the post (tested); phrase list contains no helpline numbers | Review the phrases with counsellors; **helpline details are not configured**, so authors currently see a supportive message with no contact details; 24-hour moderator coverage | **Medium** |
| R19 | **Banned-email hash is unsalted** | Low | Low–Med | Only a hash is kept after purge | Someone with the table can test whether a known address was banned. A keyed hash would fix this but needs the check redesigned. | **Low–Med** |
| R20 | Server logs hold IP addresses and object ids in URLs | Med | Low–Med | Credentials and bodies are not logged | Set and enforce a log retention period; restrict access | **Low–Med** |
| R21 | **Manual jobs are not run** | Med | Med | The sweep is idempotent and safe to re-run; it reports what it skipped | Retention, suspension lifting, and hiding or restoring anonymous content after a ban or appeal all wait for `npm run lifecycle`. Decide who runs it and how often. | **Medium** |
| R22 | Incomplete rights handling | Med | Med | Export (v2, complete) and closure/purge built and verified; profile correction built and verified | No request-intake process for what cannot be self-served (email, date of birth, and anyone who cannot sign in because banned, suspended or closed); moderator-note disclosure needs counsel | **Low–Med** |
| R23 | **Profile photos of students** | Med | Med | A photo is a personal image of an identifiable person and can be abusive, sexual, or of someone else (impersonation). It exists only on known profiles (database check), is shown only to signed-in students at the same campus, is re-saved by the server with camera and location data removed, and can be replaced or removed by the student at any time. Moderation is after the fact: a profile report shows the moderator the photo, and a moderator can remove it with a recorded reason, separately from any penalty; the file is released and deleted by the next clean-up. | moderation is reactive, so an offending photo can be visible until it is reported and reviewed; there is no automated image screening and no check that the photo shows the account holder; the clean-up runs only when the sweep is run (R21); who is on call for urgent reports at night is undecided | **Medium** |

---

## 5. Measures and status

| Measure | Status |
|---|---|
| Identity link encrypted, key outside the database, audited and restricted lookup | **Built and tested** |
| Two-person rule for non-court lookups, enforced in the database | **Built and tested** |
| Moderators cannot see reporters or account owners | **Built and tested** |
| Anonymity leak tests (no account id in any response, swapped and tampered links fail) | **Built and tested** |
| Moderation (reports, queue, penalties, appeals) exists before anonymous profiles | **Built and tested.** No technical gate stops anonymous profiles launching without it; this is an operational commitment. |
| Closure and purge of accounts, both profiles included | **Built and tested** |
| Data export | **Built and tested** (schema v2, complete; counsel to confirm scope) |
| Purge of individually deleted content, photo files, expired codes, sessions and stale uploads | **Built and tested** (G1 to G3). Runs when the sweep is run, which is manual. |
| Correction of profile details | **Built and tested** for name, course and year. Email and date of birth go through a documented request (to write). |
| Retention periods for moderation records, appeals, audit log, and legal holds | **Built and tested** with suggested starting values (G5). **Periods await counsel's confirmation.** Appeal deadline is not set. |
| Key backup and restore drill | **Runbook and tools built; drill not done (G7).** Needs people and storage. |
| Breach-response procedure, detection and 72-hour rehearsal | **Procedure drafted; people not named, no rehearsal, no detection (G6).** |
| Unmask policy finalised and published | **Not done (decision #5)** |
| Helpline and counselling details configured; phrase list reviewed with counsellors | **Not done** |
| Processor contracts; transfer safeguards documented | **Not done (hosting undecided)** |
| TLS and storage encryption at rest | **Deployment concern; not configured by the application** |
| Mobile app SDK and tracker audit | **Cannot be done; app not built** |
| Moderator training, confidentiality commitments and night/exam coverage | **Not done** |
| Privacy policy, terms, community rules reviewed by counsel | **Not done** |

---

## 6. Consultation

- Students (interviews and survey): [status; instruments drafted, not run]
- University student affairs: [status; open question]
- USIU counselling services: [status; needed for the phrase list and helpline details]
- Counsel: [name, date]
- ODPC: consult if residual risk remains high after mitigation [counsel to advise].

## 7. Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Controller | | | |
| Counsel | | | |

**Review:** revisit before each new campus, before adding direct messages, video or any new data type, when the hosting provider is chosen, after any breach, and at least yearly.
