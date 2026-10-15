# Operations

Runbooks for the people who run the service. All are **drafts**: they describe tools that exist and tested, but a procedure only counts once it has been rehearsed and the result recorded.

| Document | For | Closes |
|---|---|---|
| `BREACH_PROCEDURE.md` | Anyone who suspects a data breach or security incident; the incident lead | G6 (once rehearsed) |
| `KEY_CUSTODY_AND_RESTORE.md` | Whoever holds the encryption keys | G7 (once the restore drill is done) |

## Commands (run from `apps/api`)

| Command | Needs | Does |
|---|---|---|
| `npm run security -- revoke-sessions --all` | `LIFECYCLE_DATABASE_URL` | Signs everyone out. |
| `npm run security -- revoke-sessions --account-email <e>` | `LIFECYCLE_DATABASE_URL` | Signs one account out. |
| `npm run verify-keys` | `KEY_CHECK_DATABASE_URL` (owner), link keys | Proves the keys open every link. Read-only. |
| `npm run rotate-keys [-- --apply]` | `KEY_CHECK_DATABASE_URL` (owner), link keys | Re-keys the links. Dry run unless `--apply`. |
| `npm run moderator -- revoke "<name>"` | `MODERATOR_SETUP_DATABASE_URL` | Cuts off a moderator. |
| `deploy/backup.sh --out DIR --encrypt-to RECIPIENT` | `OWNER_DATABASE_URL` | Encrypted database backup (and optionally `--photos DIR`) plus a manifest. Refuses to run without a decision on encryption. Keys are never in it. |
| `deploy/restore.sh --backup FILE --target-url URL --yes-overwrite` | target database, the gpg private key | Restores a backup into a database you are willing to overwrite. |
| `ops/restore-drill.sh --backup FILE [--manifest FILE]` | link keys from the key backup, Docker | Restores into a throwaway container, checks counts, runs `verify-keys`, writes a record to `ops/drills/`. |
| `npm run legal-hold -- place ...` | `LEGAL_HOLD_DATABASE_URL` | Preserves records during an investigation. |
| `npm run lifecycle` | `LIFECYCLE_DATABASE_URL` | Maintenance. **Deletes data; do not run during an investigation.** |

## What is still a human job

- Naming the people in the breach procedure, and a deputy for each.
- Choosing where the keys live, and who the two custodians are.
- **Running a rehearsal and a restore drill, and writing the result down.** Until both are done, G6 and G7 are not closed.
