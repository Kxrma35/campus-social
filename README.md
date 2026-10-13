# Campus Social App (working name)

Student-only social app with a known profile and an optional anonymous profile. V1 targets USIU-Africa.
Specs and plans: see `BUILD_PLAN.md`, `research/`, and `legal/`.

## Layout

```
apps/api/            Node/TypeScript API (Fastify)
apps/mobile/         Expo React Native app (not yet generated, see its README)
db/migrations/       PostgreSQL schema and roles
research/            Interview guide and survey
legal/               Privacy policy, terms, community rules, DPIA (drafts)
BUILD_PLAN.md        Milestones and open decisions
```

## Data model in one paragraph

`accounts` hold the verified student. `profiles` (known or anonymous) hold everything public and carry no account reference. Posts, comments, follows, reactions and notifications point to profiles only. The account-to-anonymous-profile link lives alone in the `identity` schema, encrypted, with a blind index for restricted reverse lookup. Reverse lookups go through `identity.unmask_profile()`, which writes an append-only audit row in the same transaction. Moderators apply penalties through `identity.apply_penalty_for_profile()` without ever seeing the owner.

## Run the API (manual, on demand)

```bash
cd apps/api
npm install
npm run typecheck
npm test            # schema and anonymity checks, no database needed
# configure first: see Configuration below
npm run dev         # http://127.0.0.1:3000/health
```

Nothing is installed as a background service. Start and stop things yourself.

## Configuration

Everything is configured through environment variables. **Nothing loads a `.env` file for you**, so export it into your shell first:

```bash
cp .env.example .env          # then edit; .env is git-ignored
set -a; . ./.env; set +a      # export every variable in it
```

Never commit real values. Generate secrets with `openssl rand -base64 48` (the code key) and `openssl rand -base64 32` (the link keys). Settings are validated at start-up, so a missing or malformed value stops the process with a message rather than running half-configured.

**Different processes need different settings.** The API requires `DATABASE_URL` and `CODE_HMAC_KEY` (it exits with a message if they are missing). The admin service and the maintenance job do not, so they can run without the sign-in settings. For containers, `deploy/` splits these into one env file per privilege level.

### Core

| Variable | Default | What it does |
|---|---|---|
| `NODE_ENV` | `development` | `production` makes the console mailer and `DEV_CORS_ORIGIN` refuse to run. |
| `PORT` | `3000` | API port. |
| `HOST` | `127.0.0.1` | Address to listen on, for the API and the admin service. The container image sets `0.0.0.0`; keep loopback anywhere else and put a reverse proxy with TLS in front. |
| `DATABASE_URL` | required for the API | Connection as the `auth_service` role: sign-in, sessions, appeals. |
| `CODE_HMAC_KEY` | required for the API, 32+ characters | Keyed hash for one-time codes. Changing it invalidates codes already issued, nothing else. |
| `CONTENT_DATABASE_URL` | unset | Connection as `app_api`: posting, feeds, follows, reports. **Without it those routes are not registered.** |
| `LIFECYCLE_DATABASE_URL` | unset | Connection as `account_lifecycle`: closure, re-verification, export and the maintenance job. **Without it the `/account/*` routes are not registered and `npm run lifecycle` cannot run.** |
| `PHOTO_STORAGE` | `local` | `local` keeps photos in `PHOTO_DIR`; `s3` keeps them in an S3 compatible bucket (AWS S3, Cloudflare R2, MinIO and similar). The API, the admin service and the maintenance job must all use the **same** storage. |
| `PHOTO_DIR` | `./data/photos` | Used when `PHOTO_STORAGE=local`. Development only: one API instance, and the job must point at the same directory. |
| `S3_BUCKET`, `S3_REGION` | unset | Required when `PHOTO_STORAGE=s3`. |
| `S3_ENDPOINT` | unset | Only for non-AWS stores, for example `http://minio:9000`. |
| `S3_FORCE_PATH_STYLE` | `false` | Set `true` for MinIO and some other stores. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | unset | Set both or neither. Neither means the platform's own credential chain (for example an instance role), which is preferable on AWS. |
| `S3_KEY_PREFIX` | unset | Optional folder inside the bucket. Empty, or ending in `/`. |
| `TERMS_VERSION` | `draft-0` | Stored with each acceptance. Bump it when the terms change. |
| `SUPPORT_RESOURCES_JSON` | `[]` | JSON array of `{"name": "...", "contact": "..."}` shown to a student whose post is flagged as a possible crisis. Leave empty until the numbers are confirmed with USIU counselling and a national helpline; nothing is hard-coded. |
| `DEV_CORS_ORIGIN` | unset | **Development only.** One browser origin allowed to call the API (for the web preview of the app). Refused when `NODE_ENV=production`. |

### Sign-in codes and sessions

| Variable | Default | What it does |
|---|---|---|
| `SMTP_URL` | unset | Outgoing email, for example `smtps://USER:PASS@smtp.example.com:465` or `smtp://USER:PASS@host:587` (STARTTLS, required in production). URL-encode the user and password. **Required in production: the API refuses to start without it.** Unset in development, codes are printed in the API log instead. |
| `MAIL_FROM` | unset | Sender address, for example `Campus Social <no-reply@your-verified-domain>`. Required whenever `SMTP_URL` is set. |
| `EMAIL_CODE_TTL_MINUTES` | `10` | How long a one-time code is valid. |
| `MAX_CODES_PER_HOUR` | `5` | Codes one address may request per hour. |
| `MAX_CODE_ATTEMPTS` | `5` | Wrong guesses allowed against one code before it is locked. |
| `SESSION_TTL_DAYS` | `30` | Session lifetime. |

### Anonymous profiles and the identity link

| Variable | Default | What it does |
|---|---|---|
| `LINK_ENCRYPTION_KEYS` | unset | `version:base64key`, comma separated to rotate (`1:...,2:...`). The highest version encrypts new links; every listed version can still decrypt. |
| `LINK_BLIND_INDEX_KEY` | unset | Base64 key for the profile-id blind index. Not versioned. The admin service uses this one when it is set, and should **never** be given the encryption key. |
| `ANON_MIN_ACCOUNT_AGE_DAYS` | `3` | How old an account must be before it can create an anonymous profile. `0` is useful in a test setup. |

**Without both keys, anonymous profiles are disabled** (the routes answer `501`) rather than guessed. Keep the keys in a secret store, never in the database or the repository, and **back them up**: if `LINK_ENCRYPTION_KEYS` is lost, every anonymous link is unrecoverable and closure, export, ban cleanup and unmasking of those profiles stop working. See `ops/KEY_CUSTODY_AND_RESTORE.md` before generating or rotating them.

### Moderation (admin service)

| Variable | Default | What it does |
|---|---|---|
| `ADMIN_DATABASE_URL` | required for `npm run admin` | Connection as the `moderator` role. The admin service will not start without it. Nothing in the student API uses it. |
| `ADMIN_PORT` | `3100` | Admin service port, also bound to `127.0.0.1`. |

### Retention and cleanup (read by `npm run lifecycle`)

The job is manual: nothing runs it for you. The defaults are suggested starting values for counsel to confirm. Start-up refuses values below the minimums shown, and for the moderation record periods the database enforces them as well.

| Variable | Default | Minimum | Meaning |
|---|---|---|---|
| `REVERIFY_GRACE_DAYS` | `30` | 1 | Time after the re-verification due date before the account closes. |
| `PURGE_AFTER_DAYS` | `30` | 1 | A closed account, or content its author deleted, is hard-deleted after this. |
| `CODE_RETENTION_HOURS` | `24` | 1 | One-time codes older than this are deleted. |
| `SESSION_RETENTION_DAYS` | `7` | 1 | Expired or revoked sessions older than this are deleted. |
| `STALE_UPLOAD_HOURS` | `24` | 1 | Photo uploads never attached to a post are deleted (file and row). |
| `RETENTION_DISMISSED_REPORT_DAYS` | `90` | 30 | Dismissed reports. |
| `RETENTION_RESOLVED_RECORD_DAYS` | `365` | 180 | Upheld reports, actions, ended suspensions and bans. |
| `RETENTION_APPEAL_DAYS` | `365` | 180 | Appeal text; the row stays to enforce one appeal per account. |
| `WARNING_EXPIRY_MONTHS` | `12` | 3 | Warnings stop counting and are deleted. |
| `AUDIT_LOG_RETENTION_YEARS` | `3` | 1 | Unmask audit log. |

### Used by one command only

These are never set in the API's environment. Give each command its own connection, and use the least powerful login that works.

| Variable | Command | Connection |
|---|---|---|
| `TS_DATABASE_URL` | `npm run unmask` | The trust and safety officer's **own** database login, so the audit trail names them. Never a shared account. |
| `MODERATOR_SETUP_DATABASE_URL` | `npm run moderator -- create\|revoke "<name>"` | The database owner, to write the moderator token table. |
| `LEGAL_HOLD_DATABASE_URL` | `npm run legal-hold` | The database owner. |
| `KEY_CHECK_DATABASE_URL` | `npm run verify-keys`, `npm run rotate-keys` | The database owner (it must read every anonymous link in full). Also needs both link keys. |

### The mobile app

Set at build time, not on the server.

| Variable | What it does |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Where the app finds the API. Falls back to `http://10.0.2.2:3000` (the Android emulator's route to your computer). Must be `https://` for a release build. |
| `EXPO_PUBLIC_LEGAL_BASE_URL` | Where the reviewed policy pages are hosted. Unset, the app says the documents are not published yet. |

See `apps/mobile/README.md` for the build profiles and the release check.

## Deployment

`deploy/` has a Dockerfile, a compose file with on-demand profiles, a migration runner, and env templates split by privilege. See `deploy/README.md` for the first-run steps and for what is deliberately not included (TLS, backups, object storage).

## Database

Migrations are plain SQL for PostgreSQL 15+, applied in order (`0001` to `0010`). All ten have been applied to PostgreSQL 16 in a throwaway container and the full test suite run against the result.

```bash
for f in db/migrations/*.sql; do
  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

Set role passwords and connection strings outside the repo. The services use five logins plus one per trust & safety officer: `auth_service` (sign-in and appeals), `account_lifecycle` (closure, export, sweep), `app_api` (posting, feeds and filing reports, no access to accounts or identity) `moderator` (the separate admin service, no access to accounts, reporters or the identity schema), and `trust_safety` (one named login per officer, only able to call the audited unmask function).

### Database integration tests

`apps/api/test/pg.integration.test.ts` is skipped unless `TEST_PG_PASSWORD` is set. It needs a **throwaway** Postgres with all six migrations applied and login passwords set on `auth_service`, `account_lifecycle`, `app_api`, `moderator` and `trust_safety`. The other `*.integration.test.ts` files follow the same rules. It truncates tables, so never point it at real data. Start the container yourself when you want it:

```bash
docker run --rm -d --name campus-pg -e POSTGRES_PASSWORD=<pw> -e POSTGRES_DB=campus_social \
  -p 127.0.0.1:5432:5432 postgres:16
# apply the six migrations as postgres, then in psql:
#   alter role auth_service login password '<pw>';
#   alter role account_lifecycle login password '<pw>';
#   alter role app_api login password '<pw>';
#   alter role moderator login password '<pw>';
#   alter role trust_safety login password '<pw>';
cd apps/api && TEST_PG_PASSWORD=<pw> npm test
docker stop campus-pg
```

## M1 status (accounts and verification)

Built: university-email sign-up with domain allowlist, 6-digit one-time codes (hashed, 10 minute expiry, attempt and hourly request limits), 18+ check, terms acceptance, known profile creation, login by code, opaque session tokens (stored hashed), logout, `GET /me`.

Endpoints: `POST /auth/signup/request`, `POST /auth/signup/verify`, `POST /auth/login/request`, `POST /auth/login/verify`, `POST /auth/logout`, `GET /me`.

### Re-verification, closure and export

- **Re-verification:** each account has a due date one year out. `POST /account/reverify/request` and `/verify` (signed in, one-time code) restart the year and return a `read_only` account to `active`.
- **Overdue:** a sweep moves overdue accounts to `read_only`, then closes them once `REVERIFY_GRACE_DAYS` (default 30) have passed. Read-only students can still sign in, re-verify and export.
- **Graduates:** they lose the mailbox, so they cannot re-verify. They have the grace period to use `GET /account/export` (JSON download), then the account closes.
- **Closure on request:** `POST /account/close/request` then `/confirm` with a fresh code. Sessions end and content disappears from view immediately.
- **Purge:** `PURGE_AFTER_DAYS` (default 30) after closure, content, profiles, links and sessions are hard-deleted, and the account is reduced to a tombstone (email replaced, date of birth removed) because moderation records reference it.
- **Bans:** migration `0003` also fixes a gap: a ban now records the email hash, so a banned student cannot sign up again.

The sweep is a manual command, not a service. Nothing schedules it:

```bash
npm run lifecycle -- --dry   # print settings only
npm run lifecycle            # run once
```

Tested with 99 tests: unit and HTTP tests against in-memory stores, plus 19 integration tests against real PostgreSQL 16 (2026-10-12) that connect as the actual `auth_service` and `account_lifecycle` roles. Migrations `0001` to `0003` apply in order, and `0003` re-applies cleanly.

Known limits:
- **Anonymous profiles:** closing, purging and exporting stop (HTTP 501, or "skipped" in the sweep) for any account that has an anonymous link, because resolving it needs the M4 encryption. This is deliberate: it never leaves anonymous content behind or hands back a partial export.
- **Bans:** a ban sets the status but does not yet remove content. That belongs to M3 moderation.
- **Photo descriptions (alt text):** the person posting can describe each photo (`altTexts` on `POST /posts`, or `PATCH /photos/:id` for the uploader to change or clear it later; max 500 characters, optional). Stored on the upload row by migration `0010_photo_alt_text.sql`, so it is hidden, exported and purged with the photo; shown to moderators with the photo. Verified with in-memory tests and against real PostgreSQL (grants, check constraint, uploader-only edits, anonymous profile, moderator view, data export).
- **Email:** one-time codes are sent over SMTP (`SMTP_URL`, `MAIL_FROM`; any provider that offers SMTP). Plain text only, no links or tracking, code never in the subject; STARTTLS is enforced in production; a failed send is one generic 503 that does not reveal whether an address has an account; addresses and codes are never logged. Without `SMTP_URL`, development prints codes to the API log and the console mailer refuses to run in production. Tested against a local SMTP sink, **not yet against a real provider**: confirm delivery, SPF/DKIM/DMARC and spam placement for a USIU address before any pilot.
- **Reminders:** no re-verification reminder emails yet.
- **Still to build in M1:** optional two-factor login and per-IP rate limiting at the edge.

## M2 status (posting, feed and follows)

Built: text posts with up to 4 photos, edit and soft-delete, comments, reactions, follows, a newest and a top campus feed, a following feed, profile pages, per-profile notifications, and server-enforced safeguards for anonymous posting.

| Area | Endpoints |
|---|---|
| Photos | `POST /photos` (raw JPEG/PNG/WebP body), `GET /photos/:id` |
| Posts | `POST /posts`, `GET/PATCH/DELETE /posts/:id` |
| Feeds | `GET /feed?sort=newest\|top`, `GET /feed/following` |
| Comments | `POST/GET /posts/:id/comments`, `DELETE /comments/:id` |
| Reactions | `PUT/DELETE /posts/:id/reaction`, `PUT/DELETE /comments/:id/reaction` |
| Profiles | `GET /profiles/:id`, `GET /profiles/:id/posts`, `PUT/DELETE /profiles/:id/follow` |
| Own lists | `GET /me/following`, `GET /me/followers` |
| Notifications | `GET /notifications`, `POST /notifications/read` |

Requests act as the signed-in student's known profile. `X-Acting-As: anonymous` selects the anonymous profile, which returns `501` until M4 builds it.

Design rules worth knowing:
- **Profiles only:** the content layer never sees an account id. A test fails if any content module mentions accounts, identity or sessions, and `app_api` has no database access to them.
- **Campus isolation:** every read is scoped to the viewer's university inside the SQL, so another campus's posts, profiles, photos and follow targets return `404`.
- **Photos:** every upload is decoded and re-encoded as JPEG (max 2048 px), which drops EXIF, GPS and other metadata. The format is detected from the bytes. Photos are served only to signed-in students at the uploader's campus, with `Cache-Control: private`, and photos from deleted or hidden posts only to the uploader.
- **Anonymous safeguards:** the first 3 anonymous posts need `confirmedAnonymous: true` (deleting does not reset the count). Anonymous posts, comments and the notifications they cause show times rounded to the hour. Real names, course and year are never returned for anonymous profiles.
- **Follower lists:** counts are public, but the list of who follows a profile is only shown to that profile itself, so listing an anonymous profile's followers cannot link two of a person's profiles.
- **Limits:** 20 posts and 60 comments per profile per hour, 12 pending uploads, 8 MB per image, 5000 characters per post, 2000 per comment.
- **Read-only accounts:** can read, delete and unfollow, but not post, comment, react, follow or upload.

Tested with 178 tests, including 19 in `content.integration.test.ts` that run `PgContentStore` against real PostgreSQL 16 as the actual `app_api` role (2026-10-12). Migrations `0001` to `0004` apply cleanly from an empty database. The integration files share one database, so `vitest.config.ts` runs test files serially.

Not in M2 yet:
- **Push notifications:** only in-app notifications exist. The `push_tokens` table is unused until a push provider is chosen.
- **Photo storage:** local disk only, pending the hosting decision. Orphaned unattached uploads are not cleaned up yet.
- **Search:** no name search endpoint yet (anonymous profiles must stay out of it).
- **Composer UI:** profile colour and the always-visible posting identity are client work in the mobile app.

## M3 status (moderation)

Built: student reporting, automatic hiding at three different reporters, an urgent-first moderator queue with response-time targets, content and penalty actions that never reveal who owns a profile, a one-time appeal for banned students, automatic flagging of possible self-harm text, and lifting of expired suspensions.

**Student API** (same service as M2)

| Endpoint | What it does |
|---|---|
| `POST /reports` | Report a post, comment or profile with a reason. Always answers `202 received`, whatever happened, so the response reveals nothing about how many others reported. |
| `POST /appeals/request`, `POST /appeals/submit` | A banned student proves mailbox access with a one-time code, then submits one appeal. Never reveals whether an address is banned. |

**Admin service** (separate process: `npm run admin`, port 3100, localhost only, own database role and own tokens)

| Endpoint | What it does |
|---|---|
| `GET /admin/queue` | Open reports grouped by target, urgent first then oldest, with reasons, content preview and a due time. |
| `GET /admin/targets/:kind/:id` | Full content, photos, every report with its reason and detail, and the action history. |
| `POST /admin/targets/:kind/:id/resolve` | `uphold` hides the content and closes reports as actioned; `dismiss` closes them and restores content hidden only by report volume. |
| `POST /admin/profiles/:id/penalties` | `warning`, `suspension` (1 hour to 30 days) or `ban`, applied to whoever owns that profile. A reason of 10+ characters is mandatory. |
| `GET /admin/appeals`, `POST /admin/appeals/:id/decision` | Review and decide appeals. An upheld appeal restores the account, profile and content the ban hid. |
| `GET /admin/photos/:id` | View a reported photo. |

Issue and revoke moderator tokens (printed once, stored hashed), run by the operator:

```bash
MODERATOR_SETUP_DATABASE_URL=... npm run moderator -- create "Wanjiru M."
MODERATOR_SETUP_DATABASE_URL=... npm run moderator -- revoke "Wanjiru M."
```

Design rules worth knowing:
- **Reporters are invisible to moderators.** Reports are filed through a `SECURITY DEFINER` function that resolves profile to account inside the database. The `moderator` role is granted only specific columns of `moderation.reports`, so `reporter_account_id` is unreadable to it. The student API's `app_api` role cannot insert reports directly either.
- **"3 different students" means three people.** Reports are counted per account, so one person reporting from both their known and anonymous profile counts once.
- **Moderators act on profiles, not people.** Penalties go through `identity.apply_penalty_for_known_profile()` and `identity.apply_penalty_for_profile()`, which return only a penalty id. Moderators never receive an account id.
- **Bans are reversible.** A ban hides content with `hidden_reason = 'account_banned'` instead of deleting it, so an upheld appeal can restore it. Content a student deleted themselves stays deleted.
- **Urgent means 1 hour, everything else 24.** `threat`, `self_harm` and `intimate_image` reports are urgent. These are the spec's proposed targets, surfaced as `dueAt` and `overdue`; nothing pages anyone.
- **Crisis posts:** posts and comments matching a short self-harm phrase list are flagged to the urgent queue straight away, and the author's response includes support information. The resource list comes only from `SUPPORT_RESOURCES_JSON`; no helpline number is hard-coded.
- **Suspensions end by themselves** the next time `npm run lifecycle` runs, which is still a manual command.

Known limits:
- **Phrase matching is crude.** It misses indirect wording, slang, misspellings and other languages, and it flags quotes and lyrics. It supplements human reports; it does not replace them. Review the phrase list with USIU counselling staff before launch.
- **Helpline details are unconfirmed.** `SUPPORT_RESOURCES_JSON` is empty until real numbers are confirmed, so flagged authors currently see a message without contact details.
- **Anonymous profiles do not exist yet** (M4). Penalties and reports from anonymous profiles are wired through a blind index and tested with fixtures, but return `501` in the running API until M4 supplies the key handling.
- **Bans and anonymous content.** Banning from a known profile hides the known profile's content, but the anonymous profile's id is encrypted, so its content is not hidden until M4 can resolve it. The same gap applies to restoring it on an upheld appeal.
- **Moderator tokens are bearer secrets** with no expiry or second factor. Fine for a small founding team behind a VPN; revisit before adding staff.
- **Night and exam coverage** is a people question. Nothing here alerts anyone when a report is overdue.
- **Profile reports** go to the queue but never auto-hide a profile.

Tested with 245 tests, including 27 in `moderation.integration.test.ts` that run against real PostgreSQL 16 as the actual `app_api`, `moderator`, `auth_service` and `account_lifecycle` roles (2026-10-12). Migrations `0001` to `0005` apply cleanly from an empty database. The tests were checked by weakening the SQL on purpose: raising the hide threshold or granting moderators `reporter_account_id` makes them fail.

## M4 status (anonymous profiles)

Built: creating the one anonymous profile, an encrypted account-to-profile link, acting as the anonymous profile, an audited unmasking path with a database-enforced two-person rule, and the cleanup of anonymous content after bans, closure and appeals that M2 and M3 had to defer.

**Student API**

| Endpoint | What it does |
|---|---|
| `GET /me/profiles` | The caller's own known and anonymous profiles, whether the anonymous one can be created yet, and the plain-language notice. Always `no-store`. |
| `POST /profiles/anonymous` | Creates the one anonymous profile. Needs `{"acknowledged": true}`, which clients must send explicitly. Returns the generated handle and avatar and nothing that ties them to the account. |
| `X-Acting-As: anonymous` on any content route | Acts as the anonymous profile. `404 no_anonymous_profile` if it has not been created; `501` if the link keys are not configured. |

**How the link works**
- The anonymous profile id is encrypted with AES-256-GCM, with the account id bound in as authenticated data. A blob copied onto another account's row fails to decrypt instead of attributing the wrong profile, and a different IV is used every time.
- A separate HMAC "blind index" of the profile id is stored beside it so the database can find the account behind a profile (for penalties, reports and unmasking) without the profile id ever sitting next to the account in the clear.
- Both keys live outside the database. `LINK_ENCRYPTION_KEYS` supports rotation (`1:...,2:...`; the highest version encrypts, every listed version decrypts).
- The handle and avatar come from a cryptographic random source and use nothing from the person. The profile's `created_at` is rounded to the day.
- Eligibility: the account must be `active`, have no warnings, and be `ANON_MIN_ACCOUNT_AGE_DAYS` (default 3) old.

**Who holds which key**

| Process | Encryption keys | Blind-index key |
|---|---|---|
| Student API, lifecycle sweep | yes | yes |
| Admin service (moderators) | **no** | yes |
| Trust & safety unmask command | no | yes |

**Unmasking (trust & safety only)**

```bash
TS_DATABASE_URL=postgres://<your own login>@.../campus_social LINK_BLIND_INDEX_KEY=... \
npm run unmask -- --profile <anonymous-profile-id> --reason confirmed_threat \
  --detail "Report R-8841: explicit threat against a named student, reviewed by two staff" \
  --case R-8841 --approved-by "Bob K."
```

Enforced by the database, not by the command:
- Every lookup is written to `identity.lookup_audit`, including ones that find nothing. The audit trigger blocks updates and deletes.
- Anything other than `court_order` needs a second, different approver (`TS001` otherwise).
- The real login (`session_user`) is stored beside the name you give, so it cannot be spoofed.
- `trust_safety` cannot read `accounts`, the link table, or call the bare lookup function; it can only call the wrapper above.

**Closed gaps from earlier milestones**
- Closure, purge and export now handle the anonymous profile when the keys are configured, instead of refusing.
- `npm run lifecycle` now also hides a banned account's anonymous content (when the ban was applied from the known profile) and restores it after an upheld appeal.
- Reports and penalties made from an anonymous profile now resolve through the real blind index.

Known limits:
- **Losing `LINK_ENCRYPTION_KEYS` is unrecoverable.** Without them no anonymous link can be decrypted: closure, export, ban cleanup and unmasking stop working for those profiles. Back the keys up separately from the database, and test a restore.
- **The blind-index key has no rotation tool.** It can be re-derived by decrypting every link with the encryption key, but that job is not written.
- **Cleanup waits for a sweep.** After a ban from the known profile, or an upheld appeal, the anonymous profile's content changes the next time `npm run lifecycle` runs, which is still a manual command. Run it after those decisions.
- **Writing style and timing can still identify people.** Rounded times and generated handles do not stop a classmate recognising someone's voice, and the app does not claim they do.
- **Screenshots are not blockable** and the interface does not promise they are.
- **The identity link is only as private as the people allowed to run `unmask`.** Keep that group small, use named logins, and review `identity.lookup_audit` regularly. Nothing alerts anyone when a lookup happens.
- **Unmask policy is still your decision** (open question #5). The database enforces a two-person rule for everything except court orders; it cannot decide which reasons your policy allows.

Tested with 317 tests, including 26 in `anonymous.integration.test.ts` that run against real PostgreSQL 16 using real encryption and the actual `trust_safety`, `moderator`, `app_api`, `auth_service` and `account_lifecycle` logins (2026-10-12). Migrations `0001` to `0006` apply cleanly from an empty database. The tests were checked by weakening the system on purpose: removing the account binding from the encryption, removing the two-person rule, re-granting the bare lookup function, skipping the audit row, and letting moderators read the link table each make a test fail.

## Correcting your profile and exporting your data

**Profile correction (G4).** `GET /me/profile` and `PATCH /me/profile` let a student correct their name, course and year.

- The profile edited is always the signed-in student's **known** profile. The id comes from the session, and the database update itself refuses anything that is not a known profile, so the anonymous profile cannot be reached.
- **Changing the name regenerates the handle.** Handles are built from the name (`jane_doe_4821`); keeping the old one would leave the old name visible.
- Email and date of birth are **not** editable here: unknown fields are rejected, not ignored. They anchor sign-in and the 18+ check, so a correction goes through a person (see the privacy policy).
- Up to 5 real changes per 30 days per profile, counted atomically in the database. Saving what is already there is not a change and does not use the allowance.
- Works for read-only accounts. Banned, suspended and closed accounts cannot sign in, so they request corrections by email.

**Complete export (G8).** `GET /account/export` now returns schema version 2: account, both profiles, posts (including ones moderation hid, marked), comments, reactions, who you follow, **counts** of your followers, notifications, photos with download addresses, sign-in sessions, and your moderation records (reports you filed, reports about your content with reason and outcome only, penalties with the reason, actions on your content, your appeals).

- It opens with a **notice** that the file links the known and anonymous profiles, so it should be kept private.
- It ends with a plain-language `notIncluded` list: who reported you and what they wrote, moderators' names, other people's content and follower lists, credentials, server logs, and internal security records.
- Moderation records come through one database function written so it cannot return a reporter, their free text, or a moderator's name. A test checks this by searching the whole export for the reporter's email, account id, allegation text and the moderator's name.
- Photos are listed with a download path, not embedded, because embedding would make the file very large.

Status: **implemented and verified**: 20 unit tests plus 19 PostgreSQL tests in `profile-export.integration.test.ts`, each guard also checked by deliberately weakening it.

## Operations: incidents and keys

Runbooks are in `ops/` (`BREACH_PROCEDURE.md`, `KEY_CUSTODY_AND_RESTORE.md`). The tools they use:

| Command | Does |
|---|---|
| `npm run security -- revoke-sessions --all` or `--account-email <e>` | Signs people out immediately. No data touched. |
| `npm run verify-keys` | Proves a set of keys opens every anonymous link. Read-only; needs the database owner connection. |
| `npm run rotate-keys [-- --apply]` | Re-encrypts links under the newest key, and optionally re-derives blind indexes under a new key. Dry run by default; locks the table and writes nothing if any link fails to verify. |

Behaviour worth knowing:
- **An unreadable anonymous link is a reported, clean state, not a crash.** The maintenance job skips that account and continues for everyone else; the student gets a `503` (`anonymous_unavailable`) when acting anonymously and a degraded `/me/profiles`; closing or exporting that account returns `501` rather than a partial result. A later run with the right keys finishes the job.
- **Losing the encryption key does not stop penalising or unmasking by profile id.** Both need only the blind-index key. It stops everything that must *open* a link: acting as the profile, closing, exporting and ban cleanup.

Status: **tools implemented and verified**: 14 unit tests plus 23 PostgreSQL tests in `key-custody.integration.test.ts`, each safeguard also checked by deliberately weakening it (a rotation that skips unreadable links, a dry run that writes, a stale version column, a session revoke that hits everyone, and an unreadable link that aborts the sweep were each caught).

## Retention and cleanup

`npm run lifecycle` is the manual maintenance job. Besides re-verification, closure and suspensions it now:

| Step | Rule |
|---|---|
| Deleted posts and comments | Hard-deleted `PURGE_AFTER_DAYS` (30) after the author deleted them, with their comments, reactions and photos. **Kept while a report on them is unresolved**, so deleting a reported post cannot destroy evidence. Content hidden by moderators but not deleted by its author is never purged. |
| Photo files | Every time rows holding a file key are deleted, the key is queued in `storage_deletions` in the same transaction. The job deletes the file, then removes the queue row. A failed deletion stays queued and is retried on the next run (`filesFailed`, `filesPending`). |
| One-time codes | Deleted `CODE_RETENTION_HOURS` (24) after creation. Includes the email of anyone who started sign-up and never finished. |
| Sessions | Deleted `SESSION_RETENTION_DAYS` (7) after they expire or are revoked. Live sessions are never touched. |
| Unattached uploads | Row and file deleted `STALE_UPLOAD_HOURS` (24) after upload. |
| Dismissed reports | Deleted `RETENTION_DISMISSED_REPORT_DAYS` (90) after dismissal. |
| Upheld reports, moderator actions, ended suspensions and bans | Deleted `RETENTION_RESOLVED_RECORD_DAYS` (365) after resolution. **A ban in force is never deleted**, nor the action behind it. |
| Warnings | Stop counting, and are deleted, after `WARNING_EXPIRY_MONTHS` (12). The account's warning count goes down, so an expired warning also unlocks the anonymous profile again. |
| Appeals | After `RETENTION_APPEAL_DAYS` (365) the message, decision note and decider are **removed but the row is kept**, because that row is what enforces "one appeal per account". |
| Unmask audit log | Rows older than `AUDIT_LOG_RETENTION_YEARS` (3) are deleted through one narrow database function, and each purge is itself logged. |
| Legal holds | Anything under a hold is kept until released, and open reports are never deleted. Holds are placed by an operator with `npm run legal-hold`, not by moderators. |

Things to know:
- **The job must use the same `PHOTO_DIR` as the API.** Pointed elsewhere it deletes nothing and reports files as pending.
- **Nothing runs it for you.** Retention is only as good as how often someone runs it. Decide an owner and a schedule.
- **A file written whose database row then failed** is removed immediately by the upload code, but a crash between the two writes would leave an orphan that nothing reconciles.
- **Moderation record retention (G5) is implemented and verified** against PostgreSQL (36 tests in `moderation-retention.integration.test.ts`, each rule also checked by deliberately weakening the database function). The periods are suggested starting values for counsel to confirm.
- **There is no appeal deadline.** A banned student can still appeal at any time, so an appeal made after the underlying records were deleted is decided on the appeal text alone. Setting a deadline is a policy decision.

## Privacy gaps to close before launch

Found when the legal drafts were checked against the code (2026-10-12). Details and rationale are in `legal/DPIA.md` section 0.1.

> **Status update:** **G1, G2 and G3 are fixed and verified** (migration `0007`, `npm run lifecycle`): 20 unit tests plus 16 PostgreSQL and real-filesystem tests, each also checked by deliberately weakening the code. They take effect only when `npm run lifecycle` is run. G4 to G8 are unchanged.

- ~~**G1** Photo files are never deleted.~~ **Fixed.** `PhotoStore.delete`, plus an outbox queue (`storage_deletions`) written in the same transaction as the row deletion.
- ~~**G2** Individually deleted posts and comments are never hard-deleted.~~ **Fixed.** Purged after 30 days, unless a report on them is open.
- ~~**G3** Expired codes, sessions and unattached uploads are never cleaned.~~ **Fixed.** Codes after 24 hours, sessions after 7 days, uploads after 24 hours.
- ~~**G4** No profile edit endpoint.~~ **Fixed and verified** for name, course and year. Email and date of birth still need a documented request process.
- ~~**G5** No retention job for moderation records, appeals or the unmask audit log.~~ **Fixed and verified**, with suggested starting values that counsel should confirm (migration `0008`).
- **G6 Breach procedure.** *Drafted in `ops/BREACH_PROCEDURE.md`. Open until the people are named and a rehearsal is recorded. There is still no detection or alerting.*
- **G7 Key backup and restore drill.** *Runbook and tools built in `ops/`. Open until custodians are chosen, the keys are backed up, and the restore drill is done and recorded.*
- ~~**G8** The data export is partial.~~ **Fixed and verified** (export schema v2).
- Also noted: there is no appeal deadline; the banned-email fingerprint is an unsalted SHA-256; anonymous posts store an exact timestamp (only the API view is rounded).

## Not done yet

- Hosting choice (open decision #1)
- Expo mobile app
- Encryption and blind-index code for the identity link
- Real USIU email domain and staff/student distinction (university row is seeded inactive)
