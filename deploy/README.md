# Deployment

Container files for running the API, the admin service and the maintenance job. They are host neutral: any platform that runs a container and gives it a PostgreSQL 15+ database will do. Nothing here is a hosting decision. It has been run end to end on a local machine (migrations applied twice, API and admin healthy, maintenance job and key check run, privilege split confirmed inside the containers), but **never on a real host, behind TLS, or against a real email provider**.

## What is here

| File | Purpose |
|---|---|
| `../apps/api/Dockerfile` | One image for everything: the API (default), the admin service and the scripts. Node 22, non-root, production dependencies only, health check on `/health`. |
| `docker-compose.yml` | The API, plus optional services behind profiles so nothing starts unless asked: `local-db`, `admin`, `tools`. |
| `migrate.sh` | Applies `db/migrations/*.sql` in order, once each, recording them in `public.schema_migrations`. |
| `set-role-passwords.sh` | Gives the four service roles their passwords, taken from the environment, never printed. |
| `env.*.example` | One template per privilege level (see below). |

## Three env files, on purpose

| File | Given to | Holds |
|---|---|---|
| `.env.api` | `api`, `lifecycle` | Student-facing database logins, code key, **both link keys**, SMTP. |
| `.env.admin` | `admin` | The moderator login and the **blind-index key only**. It never receives the encryption key, and nothing else needs its settings. |
| `.env.owner` | `db`, `migrate`, `set-role-passwords` | The database owner and role passwords. **Never given to the API or the admin service.** |

Copy each `env.*.example` to `.env.api`, `.env.admin` and `.env.owner` (they are git-ignored) and replace every `CHANGE_ME`. Generate keys with `openssl rand -base64 48` (code key) and `openssl rand -base64 32` (link keys). Read `../ops/KEY_CUSTODY_AND_RESTORE.md` and back up the link keys before first use.

## First run

Run from this folder. `--env-file .env.owner` is only for the database password interpolation.

```bash
docker compose --env-file .env.owner --profile local-db up -d db     # skip with a managed database
docker compose --env-file .env.owner run --rm migrate
docker compose --env-file .env.owner run --rm set-role-passwords
docker compose --env-file .env.owner up -d api
docker compose --env-file .env.owner --profile admin up -d admin     # when moderators need it
```

Then, whenever the maintenance job is due (it never runs itself):

```bash
docker compose --env-file .env.owner run --rm lifecycle
```

Check the API with `curl http://127.0.0.1:3000/health`.

## Before this is a real deployment

- **The moderator console is served by the admin service** at `/console`, on the same port as the admin API. Keep that port private. Reach it from a moderator's machine with an SSH tunnel (`ssh -L 3100:127.0.0.1:3100 host`) or a private network, then open `http://127.0.0.1:3100/console`.
- **Tell the API about the proxy.** Set `TRUST_PROXY_HOPS=1` in `.env.api` when exactly one reverse proxy or load balancer sits in front, so rate limits see each student's address and not the proxy's. Leave it at `0` if the API is reached directly. Request logs include the client address, so set a log retention period and record it in the privacy policy.
- **TLS and a public address are not included.** The API speaks plain HTTP on `127.0.0.1:3000`. Put a reverse proxy or the platform's load balancer in front, terminate TLS there, and forward only `/` to the API. **Never expose the admin port (3100).**
- **Photos default to a local volume**, which means exactly **one** API instance, and that volume must be backed up with the database. Set `PHOTO_STORAGE=s3` (below) to remove that limit.
- **Backups are scripts, not a schedule.** `backup.sh` and `restore.sh` exist and are tested, but **nothing runs them**. Put `backup.sh` on a schedule on a host that does not hold the link keys, copy the output off that host, and keep the link keys separately (`../ops/KEY_CUSTODY_AND_RESTORE.md`). Then run the restore drill.
- **A backup keeps deleted data.** A student who closes their account, or deletes a post, is still in every backup taken before that. Decide how long backups are kept (a short, fixed period such as 35 days works), delete older ones, and say so in the privacy policy. The policy's "deleted within 30 days" is only true of the live service unless backups age out too.
- **The photo bucket is not covered by `backup.sh`'s database dump.** Either archive it with `--photos` (local storage only) or rely on the storage provider's replication, and apply the same retention rule.
- **Secrets belong in the platform's secret store**, not in files on a disk. The env files are the interface, not the recommendation.
- **The production API will not start without `SMTP_URL` and `MAIL_FROM`**, because codes must never be printed to a log.
- **There is no automatic restart or schedule.** `restart` is `"no"` by design; set it per your platform if you want it.
- **Migrations only move forward.** There is no rollback; restore from backup instead.

## Object storage for photos

Set these in `.env.api`, **and the same storage settings in `.env.admin`** (the admin service reads photos for moderators). The maintenance job uses `.env.api`.

```
PHOTO_STORAGE=s3
S3_BUCKET=your-bucket
S3_REGION=your-region
S3_ENDPOINT=https://s3.your-region.example.com
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Leave `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE` out for AWS S3. Rules for the bucket, all of which matter for the privacy promises:

- **Private.** Block all public access. The API serves photos itself and checks who is asking; the bucket must never be readable directly.
- **No versioning, or a lifecycle rule that expires old versions.** A versioned bucket keeps a "deleted" photo, which breaks the 30-day deletion promise.
- **Encryption at rest** on (the default on AWS S3).
- **Least privilege.** The API needs put, get and delete on the bucket (or prefix). The admin service only needs get. Give each its own credentials.
- **Region.** It is part of the hosting and transfer decision in `../DECISION_BRIEF.md`.
- **Moving existing photos.** Switching from `local` to `s3` does not copy files. Copy the photo directory into the bucket first (keys are the file names), or start fresh in a test setup.

## Backup and restore

```bash
OWNER_DATABASE_URL=postgres://postgres:...@host:5432/campus_social \
  ./backup.sh --out /backups --encrypt-to ops@example.org [--photos /data/photos]

./restore.sh --backup /backups/campus-social-<time>.dump.gpg \
             --target-url postgres://postgres:...@scratch-host:5432/campus_social --yes-overwrite
```

- Backups are encrypted to a **public key**: the machine that takes them cannot read them. Keep the private key with the custodians, apart from the backups and from the link keys.
- `--unencrypted` exists for development only. It prints a warning and the manifest records `encrypted: NO`.
- `restore.sh` refuses to run without `--yes-overwrite`, and refuses a target equal to `OWNER_DATABASE_URL`. It creates the service roles if the target is a new server, but **role passwords are not in a dump**: run `set-role-passwords.sh` after restoring.
- If `pg_dump` is not installed, the scripts run the PostgreSQL tools from a container (`PG_TOOLS=docker` forces that). The tools must match the server's major version.
