# Key custody, backup and restore runbook

> **DRAFT v0.1.** Written 2026-10-12 against the system as built. The hosting direction is a Nairobi data centre but no provider is chosen, so the storage steps say what the **requirement** is, not which product to use. Blanks are for you to fill in; do not invent them.
>
> **G7 in `legal/DPIA.md` is not closed by this document. It is closed by running the restore drill in section 6 and recording the result.** A backup that has never been restored is a hope, not a backup.

**Owner:** [name]  **Second custodian:** [name]  **Last drill:** [date, result]

---

## 1. Why this exists

The encrypted link between a student's account and their anonymous profile is protected by keys that **live outside the database on purpose**. That protects students, and it creates one sharp consequence:

> **If `LINK_ENCRYPTION_KEYS` is lost and there is no backup, every anonymous link is permanently unrecoverable. No one, including the people who built the system, can get them back.**

The opposite risk is equally serious: if the keys are exposed together with a database copy, anonymity is gone. So the keys must be both **safe from theft** and **safe from loss**, and those pull in opposite directions. This runbook is how you hold both.

## 2. What exists, and what each one does

| Secret | What it protects | Where it must be available | Lose it | It is exposed |
|---|---|---|---|---|
| **`LINK_ENCRYPTION_KEYS`** (one or more `version:key`) | The encrypted account-to-anonymous-profile links | Student API, maintenance job. **Not** the admin service. | **Permanent.** Links cannot be opened: no acting as the anonymous profile, and no closing, exporting or cleaning up those profiles. (Penalising and unmasking by profile id still work, because they need only the blind-index key.) See section 9. | Together with a database copy, anonymity is broken. See section 8. |
| **`LINK_BLIND_INDEX_KEY`** | Lets the database find the account behind a profile (penalties, reports, unmasking) | Student API, maintenance job, **admin service**, trust & safety command | **Recoverable** if the encryption keys survive: re-derive every index (section 7). Until then, penalties and unmasking for anonymous profiles fail. | Someone with the database could test guesses of profile ids against the stored indexes. Rotate (section 7). |
| `CODE_HMAC_KEY` | One-time email codes | Student API | Harmless: codes in flight stop working; people request a new one. | Together with a database copy, outstanding one-time codes could be worked out. They live only minutes, but rotate it and revoke sessions. |
| Database role passwords (`app_api`, `auth_service`, `account_lifecycle`, `moderator`, officers' own logins) | Database access | Each process, and each officer | Reset them. | Treat as a breach (`ops/BREACH_PROCEDURE.md`). |
| Moderator tokens | The admin service | Each moderator | Re-issue (`npm run moderator -- create`). Only hashes are stored. | Revoke (`npm run moderator -- revoke`). |

## 3. Rules for custody

These are requirements. How you meet them depends on the host you choose (see `deploy/HOSTING.md`). **[Record, once the provider is chosen, where each one actually lives.]**

1. **Never in the repository, the database, the backups of the database, a chat, or an email.** Not even once "temporarily". This is the one rule with no exceptions.
2. **Never in the same backup set, the same storage account, or the same credentials as the database backups.** If one theft yields both, the encryption achieves nothing.
3. **At least two people** can recover the keys, so that one person's illness, departure or loss does not end the company's ability to open its own data. At least two **independent** copies, in different places.
4. **One copy offline** (printed or on removable media, sealed, in a physically secure place). A cloud outage, an account lockout, or a billing dispute must not be able to take it away.
5. **Every copy is itself protected** (encrypted, access limited to the custodians, access recorded where the platform allows it).
6. **A written record of custody**: who holds a copy, where, since when. Update it whenever a person leaves or a copy moves. (Template in Appendix B.)
7. **When a custodian leaves, rotate** (section 7) and remove their access the same day.
8. **Keys are generated on a trusted machine** and never typed into a web form, a ticket or a terminal on a shared machine.
9. **On a single host, the keys and the backups live on different machines or accounts.** The scheduled backup (`deploy/schedule/run-backup.sh`) writes to `BACKUP_DIR`: point that at a separate machine or bucket, never a folder on the host that holds `.env.api`.

## 4. Generating keys

```bash
openssl rand -base64 32      # one key, 32 bytes, base64
```

- Encryption keys are written as `version:key`, with the version a whole number from 1 to 255: `1:Hk3...`. The highest version encrypts; every listed version can decrypt.
- The blind-index key is a bare base64 key with no version.
- A key that is not exactly 32 bytes is refused at startup.

## 5. Backing up

The **database** is backed up with `deploy/backup.sh` (section 6 shows how). **The keys are not in it, by design.** What follows is about the keys. Do this **before launch, and again after every key change**.

1. Generate or locate the key set.
2. Write each key to its **two independent protected locations** and to the **offline copy** (section 3).
3. **Verify each copy by reading it back** and comparing, not by trusting that the write succeeded.
4. **Prove the backed-up keys open the real data**, using a copy of the database or the live one:

   ```bash
   cd apps/api
   KEY_CHECK_DATABASE_URL=<database owner connection> \
   LINK_ENCRYPTION_KEYS=<the keys as read back from the BACKUP, not from the running config> \
   LINK_BLIND_INDEX_KEY=<read back from the backup> \
   npm run verify-keys
   ```

   Expect `OK: every link opens with these keys.` and **`problems: 0`**. A non-zero exit means the backup is not good enough. The command is read-only and never prints a profile id or a key.
5. Record the date, the result and who did it (Appendix B).

## 6. The restore drill

This is what actually closes G7. It simulates the worst day: **the running environment is gone and you have only your backups.**

**Environment:** a clean machine or container with no access to the production secrets, and a **restored copy** of a recent database backup. Never run a drill against the live database with live credentials you would not hand to a stranger.

| Step | Do | Record |
|---|---|---|
| 1 | Take the database backup you would really use. Confirm its date. | Backup identifier, date |
| 2 | Without using the running configuration, **retrieve the keys from the backup locations**, as a custodian would. Use the offline copy for at least one drill a year. | Which copy, who, how long it took |
| 3 | Restore the database to the clean environment. | Time taken |
| 4 | Run `npm run verify-keys` with the retrieved keys against the restored database. | Output |
| 5 | Start the student API against the restored database with the retrieved keys. Sign in as a test account that has an anonymous profile, and act as it. | Works? |
| 6 | Close the test account that has an anonymous profile, then run the maintenance job (`npm run lifecycle`) against the **restored copy**. It is a throwaway copy, so letting it change data is safe. Confirm it reports `skipped: 0` and that the anonymous profile's content is gone. (`--dry` only prints settings and proves nothing here.) | Output |
| 7 | Note anything that was slow, unclear, or required knowledge only one person has. | Findings |

### Running the automated steps

`deploy/backup.sh` takes the backup, and `ops/restore-drill.sh` does steps 3 and 4 and writes the record. Both are verified end to end in `apps/api/test/backup-restore.integration.test.ts`.

```bash
# on the backup host, with the database owner connection (never the link keys)
OWNER_DATABASE_URL=<owner connection> deploy/backup.sh --out /backups --encrypt-to <gpg recipient>

# or let the schedule do it (deploy/schedule/): the same script, plus pruning by BACKUP_KEEP_DAYS,
# a failure alert, and a staleness alert if it silently stops. Settings live in /etc/moku/jobs.env.

# on the clean drill machine, with the keys as retrieved from the KEY BACKUP (step 2)
LINK_ENCRYPTION_KEYS=<from backup> LINK_BLIND_INDEX_KEY=<from backup> \
  ops/restore-drill.sh --backup /backups/campus-social-<time>.dump.gpg \
                       --manifest /backups/campus-social-<time>.manifest.txt
```

- The backup is encrypted **to a public key**, so the backup host can write backups but cannot read them. The private key is a third secret, held by the custodians like the link keys, and **kept apart from both the backups and the link keys**.
- The drill restores into a throwaway container, compares row counts with the manifest, runs `verify-keys`, and writes a record to `ops/drills/`. The container and the decrypted data are removed afterwards.
- **It cannot do steps 2, 5, 6 or 7 for you.** The record lists them as open boxes. G7 stays open until a person has filled them in.

**Pass criteria:**
- `verify-keys` reports **0 problems** and the expected number of links.
- Acting as an anonymous profile works with the restored keys.
- A second custodian, **not the person who set it up**, completed steps 2 and 4 from this document alone.
- The whole drill took **under [4 hours]**.

**Frequency:** before launch; after any key change; whenever a custodian changes; and at least every 6 months. The offline copy at least yearly.

## 7. Planned rotation

Rotate on a schedule **[for example every 12 months]**, when a custodian leaves, and after any suspected exposure.

### 7a. Encryption key

1. Generate the new key as the next version (section 4). Back it up and verify (section 5) **before** using it.
2. Deploy `LINK_ENCRYPTION_KEYS="1:<old>,2:<new>"` to the student API and the maintenance job. New links now use v2; existing links still open under v1. Nothing is lost if you stop here.
3. **Take a database backup.**
4. Dry run, and read the numbers:

   ```bash
   KEY_CHECK_DATABASE_URL=... LINK_ENCRYPTION_KEYS="1:<old>,2:<new>" LINK_BLIND_INDEX_KEY=<current> \
   npm run rotate-keys
   ```
5. Apply:

   ```bash
   ... npm run rotate-keys -- --apply
   ```

   It locks the table, requires **every** link to open and match first, re-checks each new value before writing, and writes in one transaction. If anything is wrong it writes **nothing**.
6. Verify with the **new key alone**: `LINK_ENCRYPTION_KEYS="2:<new>" npm run verify-keys`. Expect 0 problems and every link under v2.
7. **Do not delete the old key yet.** See "Retiring the old key" below.

### 7b. Blind-index key

Needed after exposure of the blind-index key, or on a custodian change. **This has a maintenance window**, because a process holding the old key stops finding accounts the moment the change commits.

1. Generate and back up the new key. Verify the backup.
2. Take a database backup.
3. **Stop the student API, the admin service and any maintenance job.**
4. Re-index (the encryption keys are unchanged):

   ```bash
   KEY_CHECK_DATABASE_URL=... LINK_ENCRYPTION_KEYS=<current> LINK_BLIND_INDEX_KEY=<OLD blind key> \
   NEW_LINK_BLIND_INDEX_KEY=<new> \
   npm run rotate-keys -- --apply --new-blind-key-env NEW_LINK_BLIND_INDEX_KEY
   ```
5. Put the **new** blind-index key into **every** process that has one: the student API, the maintenance job, the **admin service**, and each trust & safety officer's environment.
6. Start the processes. Run `verify-keys` with the new blind key. Expect 0 problems.
7. Confirm one thing end to end: file a test report from an anonymous profile.

### Retiring the old key

**The old encryption key must be kept, safely, until every database backup taken before the rotation has aged out.** Those backups still hold links encrypted under the old version. If you destroy the key, restoring one of those backups gives you links you can never open.

With the scheduled backup, "aged out" is a number you chose: `BACKUP_KEEP_DAYS`. The earliest date you may destroy the old key is the rotation date plus `BACKUP_KEEP_DAYS`, and only if pruning has actually been running (check the `backup` job's `last_success` and that the oldest file in `BACKUP_DIR` is within the limit). Do not shorten `BACKUP_KEEP_DAYS` to "finish" a rotation sooner than the backups allow.

- Keep the old key in custody but **remove it from running configuration** once rotation is verified, so a stolen application environment does not contain it.
- Destroy it only when the oldest backup that could be restored is newer than the rotation. Write the date down.

## 8. If a key may have been exposed

1. **Treat it as a breach** and open an incident (`ops/BREACH_PROCEDURE.md`). If a database copy may also have left the building, it is S1.
2. Contain first: `npm run security -- revoke-sessions --all`, and switch anonymous profiles off if the encryption key may be known.
3. Rotate (section 7). **Rotating after exposure does not undo it.** A copy of the database taken before rotation, plus the old key, still opens every link in that copy. Rotation protects the *future* and everything stored after it. Assume anyone holding both **already knows**, and notify accordingly.
4. Review the audit log for lookups you do not recognise (`ops/BREACH_PROCEDURE.md`, Appendix F).

## 9. If the encryption key is lost and no backup exists

State this plainly to yourself before it happens: **there is no recovery.** What this means in practice:

| Capability | Without the key |
|---|---|
| Sign in, post, comment as the **known** profile | Works |
| Act as an anonymous profile | **Fails** for every existing anonymous profile |
| Content already posted anonymously | Stays visible, and can still be reported and hidden by id |
| Penalise or unmask an anonymous profile, **by its profile id** | **Still works.** Both compute the blind index from the profile id and need only `LINK_BLIND_INDEX_KEY`, which is a different key |
| Close an account that has an anonymous profile | **Skipped** by the maintenance job; it will not half-handle it |
| Export that account's data | **Refused** (501) rather than returning a partial file |
| New students creating anonymous profiles | Works under a new key |

**What is worse:** you can still *stop* a profile (hide it, ban its owner), but you can no longer *find* it from the account side, so a student who asks you to delete their anonymous posts, or who closes their account, **cannot be fully served**.

**What to do:** stop the maintenance job from retrying forever, tell counsel, and decide with them what you owe the affected students, **because their anonymous content can no longer be deleted on request**. That is a data-subject-rights problem, not just an operational one, and it is the strongest argument for doing the restore drill.

## 10. What the tools do and do not do

| Tool | Does | Does **not** |
|---|---|---|
| `npm run verify-keys` | Opens every link with the keys you give it; checks each blind index and that the profile still exists; counts by key version; exits non-zero on any problem. Read-only. | Print a profile id or a key. Fix anything. Prove the keys are *backed up*, only that the copy you tested works. |
| `npm run rotate-keys` | Re-encrypts under the newest version; optionally re-derives blind indexes under a new key. Dry run by default. All-or-nothing. | Delete old keys. Update your configuration. Tell you which processes still hold the old key. |
| `npm run security -- revoke-sessions` | Ends sessions, all or one account. | Change any data. |

Both key tools need the **database owner** connection, because the application logins deliberately cannot read the blind index. Keep that connection out of application environments.

## 11. Open decisions

- Where each secret actually lives, once the provider is chosen (a managed secret store or key management service is preferable to files).
- Who the two custodians are, and where the offline copy is kept.
- Rotation schedule.
- Whether to move to a key management service so that keys are never present in application memory. That is the strongest fix for the "student API host holds everything" risk (R2 in `legal/DPIA.md`), and it is a hosting decision.

---

## Appendix A: Restore drill log

| Date | Backup used (id, date) | Keys retrieved from | Custodian | Total time | `verify-keys` result | Acting as anonymous worked? | Passed? | Findings and actions |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

## Appendix B: Custody record

| Secret | Version | Location (describe, do not paste the key) | Held by | Since | Last verified (date, by) |
|---|---|---|---|---|---|
| `LINK_ENCRYPTION_KEYS` | v1 | | | | |
| `LINK_ENCRYPTION_KEYS` | v1 (offline copy) | | | | |
| `LINK_BLIND_INDEX_KEY` | | | | | |
| `LINK_BLIND_INDEX_KEY` (offline copy) | | | | | |
| `CODE_HMAC_KEY` | | | | | |

## Appendix C: Retired keys

| Key version | Retired from config | Oldest backup that still contains it | May be destroyed after |
|---|---|---|---|
| | | | |
