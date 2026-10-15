# Hosting in Nairobi

**Direction chosen 2026-10-15:** host Moku in a data centre in Nairobi, so the database and photos stay in Kenya. **No provider is chosen yet.** This file is how to choose one and what changes because you run more of it yourself. It names no vendor because nobody has been checked.

## What this changes

| Topic | Hosting in Kenya |
|---|---|
| Transfer out of Kenya for the database and photos | None to document. Hosting abroad would count as a transfer under Part VI of the Data Protection Act and need a basis, a transfer record and possibly a notification to the Data Commissioner. |
| **Transfers that still exist** | The **email provider** sees every student's address and every sign-in code. Most large mail services are outside Kenya, so that is still a transfer and needs the same safeguards and a processor contract. Choose it deliberately, and prefer one that can say where it processes. App stores and the build service do not see student data at run time. |
| Operations | Probably **you** run PostgreSQL, patching, TLS, backups and restores. A managed database is a plus if the provider really offers one. |
| Counsel to confirm | The processor contract terms, whether the provider or you must register, and whether backups may leave Kenya. |

## What the app needs

- Run Node 22 containers (`apps/api/Dockerfile`), or a host where you can run Docker and Compose (`deploy/docker-compose.yml`).
- **PostgreSQL 15 or newer**, with the `pgcrypto` and `citext` extensions allowed (migration `0001` creates both). Some managed services restrict extensions: ask.
- Outbound SMTP on 465 or 587 for sign-in codes.
- A public address with TLS terminated in front of the API; the API itself speaks plain HTTP on 127.0.0.1 (`deploy/README.md`). Set `TRUST_PROXY_HOPS`.
- Photo storage: a local volume works for one API instance (back it up with the database), or any S3-compatible bucket (`PHOTO_STORAGE=s3`).
- Network rules: the database reachable only from the API, admin and job containers, never from the internet. The moderator console reachable only privately (SSH tunnel or VPN).

## Questions to ask each provider

Write the answers down; the contract and the DPIA need them.

1. **Where exactly** will the servers, the database, **and every backup or snapshot** be held? Are any copies replicated outside Kenya?
2. Will you sign a **data processing agreement** under the Kenya Data Protection Act 2019? Can they show their own Data Commissioner registration?
3. Who at the provider can access the disks or memory, how is that access logged, and when must they tell you about a **breach** (we need to meet the 72-hour duty)?
4. Is **disk encryption at rest** on? Is there private networking between machines?
5. Are **backups** automatic, how long are they kept, and can you delete them on request? (A backup keeps deleted student data, so retention is a privacy decision. See `deploy/README.md`.)
6. What do they patch for you and what stays yours? What is the support route at night and in exam weeks?
7. Is **PostgreSQL 15+ with `citext` and `pgcrypto`** available, managed or on a machine you control?
8. What is the **exit**: how do you export everything and have the provider delete it, and in what time?
9. Price, billing in KES or USD, and what happens when you outgrow the machine.
10. Can they supply **uptime and incident history**, and what is the SLA?

## Reference layout (one machine, then grow)

This is what `deploy/` already supports: one host running the API, optionally the admin service, the maintenance and backup timers, and either a local PostgreSQL container or the provider's database.

- Put the **link keys** (`LINK_ENCRYPTION_KEYS`) in the platform's secret store or a root-only file, **not on the same disk as the backups**.
- Run backups to a **different machine or bucket** from the one that holds the live database and the keys (`deploy/schedule/run-backup.sh`).
- Start with `node deploy/check-production.mjs --api .env.api --admin .env.admin`, then `deploy/migrate.sh`, `deploy/set-role-passwords.sh`.
- Install the timers in `deploy/schedule/` and point `ALERT_WEBHOOK_URL` or `ALERT_COMMAND` at somewhere a person will see it.
- Add an external **uptime check** on `/health`.
- Do the **restore drill** in `ops/` before launch, and rehearse the breach procedure.

## Extra duties when you run the database yourself

- Firewall: only SSH (key only), the HTTPS port, nothing else public. The database port stays closed.
- Automatic security updates for the OS and Docker, and a calendar reminder to update the Node image.
- Full-disk encryption, or provider-side encryption you have confirmed.
- A named person for patching and for the pager. A small test can be run by two people, but someone must be named.
- Time to practise a restore. A backup that has never been restored is not yet a backup.

## What I could not verify

- Which Kenyan providers offer managed PostgreSQL, extension support, or a signed DPA. That needs the questions above answered by real vendors.
- Whether the Data Commissioner requires a notification for the remaining transfers (the email provider). I read the 2026 guidance only through a secondary source; counsel must confirm.
