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

- **TLS and a public address are not included.** The API speaks plain HTTP on `127.0.0.1:3000`. Put a reverse proxy or the platform's load balancer in front, terminate TLS there, and forward only `/` to the API. **Never expose the admin port (3100).**
- **Photos are on a local volume**, so run exactly **one** API instance and back that volume up with the database. Object storage is not implemented.
- **Backups are not included.** Take database backups on a schedule, back up the link keys separately from the database, and run the restore drill in `../ops/KEY_CUSTODY_AND_RESTORE.md`.
- **Secrets belong in the platform's secret store**, not in files on a disk. The env files are the interface, not the recommendation.
- **The production API will not start without `SMTP_URL` and `MAIL_FROM`**, because codes must never be printed to a log.
- **There is no automatic restart or schedule.** `restart` is `"no"` by design; set it per your platform if you want it.
- **Migrations only move forward.** There is no rollback; restore from backup instead.
