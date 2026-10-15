# Personal data breach and security incident procedure

> **DRAFT v0.1. Not legal advice.** Written 2026-10-12 against the system as built. A Kenyan data protection lawyer should review it, in particular the statutory references and timelines marked **[counsel to confirm]**. Names, contact details and the hosting-specific steps are blank on purpose: do not invent them, fill them in.
>
> **This procedure is only as good as its rehearsal.** A procedure nobody has practised fails in the first hour of a real incident. Section 11 says how to rehearse it. Do not treat G6 in `legal/DPIA.md` as closed until the first rehearsal has been done and recorded.

**Owner:** [name]  **Deputy:** [name]  **Last reviewed:** [date]  **Last rehearsed:** [date]

---

## 1. What this covers

A **personal data breach** is any event that leads to personal data being accessed, disclosed, altered, lost or destroyed without authority. A **security incident** is anything that might become one. Treat both the same until you know better.

For this service the **worst outcome is identifying the person behind an anonymous profile**. That can lead to harassment, discipline, family conflict or physical harm. Everything below is organised around protecting against that first, and around data that could be used to do it.

If you are not sure whether something counts, **treat it as an incident and write it down**. A recorded false alarm costs a few minutes. An unrecorded real one can cost a legal duty.

## 2. The clock

The Data Protection Act requires the Data Commissioner to be told of a breach **within 72 hours of becoming aware of it** **[counsel to confirm the provision, what counts as "aware", and what the notification must contain]**. Data subjects must be told where the breach is likely to put them at real risk **[counsel to confirm the test and timing]**.

**"Aware" is a person, not a system.** Write down the exact time someone first knew or reasonably suspected. The 72 hours is counted from there, not from when the investigation finished.

| When | What must have happened |
|---|---|
| T+0 | Awareness time recorded. Incident lead named. Register entry opened (Appendix A). |
| T+1h | Team assembled. Severity set (section 4). First containment decision made. |
| T+4h | Containment in place or a written reason why not. Evidence preserved (section 5). |
| T+24h | What data, whose, how many: first assessment written (section 6). Counsel contacted. |
| T+48h | Notification decision made and recorded. Drafts ready (Appendix C and D). |
| T+72h | **Data Commissioner notified, if required.** Do not wait for a complete picture: notify with what you have and say what is still being established **[counsel to confirm that notification in phases is allowed]**. |
| After | Affected people told. Review within 14 days. DPIA and this procedure updated. |

## 3. Who does what

One person can hold several roles in a small team. What matters is that **each role has a named person and a named deputy**, and that someone has the authority to take the service down without asking.

| Role | Does | Name | Deputy |
|---|---|---|---|
| **Incident lead** | Runs the incident. Owns decisions and the clock. Can order the service down. | [ ] | [ ] |
| **Technical lead** | Investigates, contains, preserves evidence, restores. | [ ] | [ ] |
| **Data protection / legal lead** | Decides notification with counsel. Speaks to the Data Commissioner. | [ ] | [ ] |
| **Communications lead** | Writes to affected students and, if needed, the university. One voice only. | [ ] | [ ] |
| **Scribe** | Keeps the incident register and a timestamped log of decisions. | [ ] | [ ] |
| **Counsel** | External. Called at T+24h at the latest. | [ ] | [ ] |

**Contacts sheet** (fill in, print, keep somewhere that does not depend on this service): each person's phone and a second channel, counsel, hosting provider's security contact, the Office of the Data Protection Commissioner's contact for breach notification **[look up and confirm]**, university student affairs contact **[if the controller decides to inform them]**.

**Need to know.** For any incident touching anonymity, restrict the discussion to the people above. Do not discuss which students may be affected in group chats or email threads.

## 4. Detecting and classifying

### What the system tells you, and what it does not

| Signal | Available | Notes |
|---|---|---|
| Every identity lookup (who, which login, why, case ref, approver) | **Yes** | `identity.lookup_audit`. Append-only; also records lookups that found nothing. |
| Purges of the audit log | **Yes** | `identity.lookup_audit_purges`. |
| Moderator actions and who took them | **Yes** | `moderation.actions`. |
| Live sessions, when created, optional device label | **Yes** | `sessions`. |
| Database login failures, unusual queries | **Only if the host provides it** | Not part of this application. Ask the provider (question 3 in `deploy/HOSTING.md`); on a self-run database, turn on PostgreSQL's connection logging. |
| Server request logs (IP, time, path, status) | **Yes, retention not set** | Authorization header redacted; bodies not logged. [set a period] |
| Scheduled job failed or stopped | **Yes, once the timers are installed** | `deploy/schedule/`: a failure or a job that has not succeeded within its limit alerts the endpoint you set. This is a **health** signal. It is not a security alert. |
| **Security alerts of any kind** | **No** | Nothing pages anyone about suspicious access. Someone must look. |
| Who downloaded an export, and when | **No** | Export requests are not logged. |
| Which moderator viewed which report | **No** | Only actions are recorded, not views. |
| Who read the key files | **Only if the host provides it** | On a single Nairobi machine, enable file access auditing for the key file, or keep the keys in the provider's secret store. |

**These gaps matter.** After a suspected breach you may be unable to say who accessed what. Record that honestly in the register instead of guessing. It is also a finding for the post-incident review.

### Reporting an incident

Anyone, including a moderator, a student or a founder, tells the incident lead by [channel] with: what they saw, when, and what they did. **Do not investigate on your own, do not delete anything, and do not tell the affected person's friends.** [Publish a reporting address and put it in the privacy policy.]

### Severity

| Level | Meaning | Examples |
|---|---|---|
| **S1: anonymity** | Anything that could link an anonymous profile to a person, or exposes the means to. | Database copy together with `LINK_ENCRYPTION_KEYS` or the blind-index key; misuse of the unmask function; a leaked export file; a trust & safety login used by someone else; the API host compromised. |
| **S2: identity and account data** | Emails, dates of birth, names, content, or ability to act as someone. | Database dump without keys; leaked session tokens; a moderator token in the wrong hands; photos exposed. |
| **S3: contained** | Limited, no sign of misuse, small number of people. | A single account taken over; a log file with IP addresses shared by mistake. |

**An S1 incident starts the clock and the full response, even if you are not yet sure.**

## 5. Containment toolbox

Act in this order: **stop the bleeding, preserve evidence, then fix**. Containment must not destroy the evidence you need to understand what happened.

### Preserve first

| Action | How | Why |
|---|---|---|
| **Stop the scheduled jobs** | On the host that runs them: `systemctl stop moku-lifecycle.timer moku-backup.timer` (or comment out the crontab lines). Do not run `npm run lifecycle` until the incident lead says so. | The sweep deletes data, and the backup job **prunes old backups**, so evidence ages out while you investigate. Leave `moku-job-check.timer` running so you are told if something else stops. |
| **Copy the newest backups aside** | Copy the most recent backups in `BACKUP_DIR` to a separate, access-limited place before any pruning resumes. | A backup may be the only record of how things were before the incident. |
| **Place legal holds** | `npm run legal-hold -- place --account-email <email> --reason "Incident <ref>" --by "<name>"`, or `--target post:<id>`, or `--audit-case <ref>` | Stops the retention job deleting reports, penalties, appeals and audit rows for the affected accounts and cases. |
| **Snapshot the database and the logs** | `deploy/backup.sh --out <separate dir> --encrypt-to <recipient>` for the database, a provider snapshot of the disk if offered (ask which, see `deploy/HOSTING.md`), and copy `JOB_STATE_DIR` and the request logs | A dated, read-only copy before anything changes. |
| **Record the state** | Run the queries in Appendix F and paste results into the register | Counts and times as they were at discovery. |

### Contain

| Goal | Action | Effect and side effects | Exists |
|---|---|---|---|
| Sign everyone out | `LIFECYCLE_DATABASE_URL=... npm run security -- revoke-sessions --all` | Every session ends at once. People sign in again with a one-time code. No data touched. | **Yes** |
| Sign one person out | `... npm run security -- revoke-sessions --account-email <email>` | Same, for one account. | **Yes** |
| Cut off a moderator | `MODERATOR_SETUP_DATABASE_URL=... npm run moderator -- revoke "<name>"` | Their token stops working immediately. Re-issue with `create`. | **Yes** |
| Switch anonymous profiles off | Remove `LINK_ENCRYPTION_KEYS` and `LINK_BLIND_INDEX_KEY` from the student API's environment and restart | Acting as an anonymous profile returns `501`. Nobody can post anonymously. Known profiles carry on. The maintenance job skips accounts it cannot resolve. | **Yes** |
| Stop unmasking | As the database owner: `ALTER ROLE <officer_login> NOLOGIN;` **and then** `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '<officer_login>';` | `NOLOGIN` alone does **not** end a session that is already connected. The second statement does. Do both for every `trust_safety` login if misuse is suspected. | **Yes** (SQL) |
| Stop sign-ups | `UPDATE universities SET active = false WHERE email_domain = '<domain>';` | New sign-ups for that domain are refused. Existing students unaffected. | **Yes** (SQL) |
| Take the service down | `docker compose stop api` and/or `docker compose --profile admin stop admin` in `deploy/`, or stop the process | Total. Use when you cannot otherwise stop ongoing access. | **Yes** |
| Rotate database passwords | Change each role's password, update secrets, restart | Cuts off anyone holding the old credentials. | **Yes** (manual) |
| Rotate the link keys | `npm run rotate-keys`, see `ops/KEY_CUSTODY_AND_RESTORE.md` | Use if a key may have been exposed. Needs a maintenance window. | **Yes** |
| Block an IP, a country, or a bot | Not in the application | The host's firewall or the reverse proxy in front of the API. [decide who can do this and how to reach them at night] | **No** |
| Alert on suspicious access | Not in the application | Nothing built. A provider's monitoring, or a log watcher you add. | **No** |

**Rule of thumb for S1:** revoke all sessions, switch anonymous profiles off, and rotate the keys **before** you finish investigating. The inconvenience is hours. The harm of identification is permanent.

## 6. Assessing what happened

Answer these in writing. If you cannot answer one, write "unknown" and what would be needed to find out.

1. **What was accessed or exposed?** Which of: emails, dates of birth, names, posts and photos, follows, reports, appeals, moderation notes, the encrypted links, the blind indexes, the keys, session tokens, moderator tokens, database credentials.
2. **Whose, and how many?** Use Appendix F. Count accounts, and separately count accounts that have an anonymous profile.
3. **Was anonymity broken?** This needs **both** the encrypted links (database) **and** `LINK_ENCRYPTION_KEYS` (secret store), or misuse of the unmask function. Record which of the two were exposed, and whether the blind index could be used to confirm a guess.

   **A database copy without the keys is not "safe".** It does not let someone open the encrypted links, but the data itself can still support inference: exact timestamps are stored for anonymous posts (only the API rounds them), and activity patterns, follows and report records can be correlated. Treat it as S2 at minimum and see risk R5 in `legal/DPIA.md`.
4. **What could this lead to for those people?** For this audience the realistic harms are harassment, discipline, loss of standing, family conflict, and physical risk. Judge severity on that, not on the number of rows.
5. **Is it still happening?** What stops it?
6. **How long was it going on?** From the earliest evidence, not from discovery.
7. **Who knew, and when?** (For the clock.)

## 7. Deciding whether to notify

Write down **the decision and the reasons**, whichever way it goes. A decision not to notify must be as well documented as one to notify.

| Question | If yes |
|---|---|
| Personal data affected, and is a person likely to be at risk of harm from it? | **Notify the Data Commissioner** within the 72 hours **[counsel to confirm the threshold]** |
| Is the risk to those people high, for example anonymity broken or identifiers plus content exposed? | **Notify the affected people** directly and without undue delay |
| Is a processor involved, or was it the source? The **hosting provider** (once chosen) and the **email provider** (sees every address and sign-in code) are both processors; check each one's contract for its duty to tell you. | Notify them, ask for their incident report, and note they may have their own duty to notify you **[counsel to confirm]** |
| Is there evidence of a crime, or a threat to someone's safety? | Counsel decides about the police. Safety comes first. |
| Does the university need to know? | **Controller's decision**, taken with counsel. Do not share personal data of affected students with the university without a lawful basis. |

## 8. Notifying

**The Data Commissioner:** use Appendix C as the content checklist. State plainly what is known and what is not. **[Confirm the official channel and format with counsel.]**

**Affected people:** use Appendix D. Principles:
- Tell them **what happened, what data, what it could mean for them, what you have done, and what they can do**. In that order, in plain words.
- **Do not minimise, do not blame them, and do not speculate.** If you do not know, say so and say when you will.
- Give a **real person and a real address** to contact.
- Send by the channel they will see (their university email and an in-app notice). If the incident compromised that channel, say how else they can verify the message is genuine.
- **Do not name other affected people**, and do not include anything in the message that would itself identify an anonymous profile.

## 9. If anonymity was compromised

This is the severe case, so it has its own steps.

1. **Assume the people are identified** unless you can prove otherwise.
2. **Revoke all sessions, switch anonymous profiles off, rotate keys** (section 5).
3. **Work out whom it affects individually**, not just a count, so that each person can be told directly. Use the incident register, not email.
4. **Tell each affected person personally, first**, before any public statement, so they hear it from you and not from a rumour. Tell them what was exposed and what they may want to do (delete posts, change habits, take steps for their safety).
5. **Offer support.** Name a person they can contact. Know the counselling numbers. The list is in `docs/helplines.md` and `SUPPORT_RESOURCES_JSON`. Check it has been confirmed by a call, and that the USIU Counseling Center entry exists, before you rely on it.
6. **Watch for harassment.** Ask moderators to look at the queue for retaliation against the affected people, and prioritise it.
7. **Do not publish names**, and do not confirm to anyone else who is affected.
8. Counsel decides about the university, the police, and any public statement.

## 10. Recovery and review

- **Restore only when contained** and the incident lead agrees. Re-key (`ops/KEY_CUSTODY_AND_RESTORE.md`), then run `npm run verify-keys` and confirm **0 problems**.
- **Release legal holds** that were placed only for the incident, once evidence is no longer needed. Do not release holds placed for a court order.
- **Resume the maintenance job** only after the incident lead says so.
- **Post-incident review within 14 days.** Blameless: what happened, what we knew when, what worked, what did not, what we change. Output: actions with owners and dates.
- **Update** the DPIA (risks and gaps), this procedure, and the incident register. Tell counsel the outcome.

## 11. Rehearsal

**Before launch, then at least once a year, and after any real incident.** About 90 minutes with everyone in section 3.

1. Pick a scenario from Appendix E. Do not tell the team which in advance.
2. Run it in real time with the clock. The scribe keeps the register as if it were real.
3. **Actually run the containment commands** against a test environment, including `revoke-sessions` and `verify-keys`. A drill that only talks about commands finds nothing.
4. Write down what you could not do, what you did not know, and how long it took.

**Pass criteria:**
- Awareness time and incident lead recorded within 10 minutes.
- Severity set and first containment decision within 1 hour.
- A written notification decision, with reasons, within 4 hours of the exercise start.
- Every person in section 3 reachable, with a working second channel.
- A draft notice to the Data Commissioner exists that would be accurate if sent.
- Every action item has an owner.

**Log each rehearsal here:**

| Date | Scenario | Who | Time to containment | Passed? | Actions raised |
|---|---|---|---|---|---|
| | | | | | |

## 12. Known gaps that limit this procedure

These are real. Each makes a breach harder to detect or to scope. They are also tracked in `legal/DPIA.md`.

1. **No security alerting.** Failed or stale scheduled jobs alert (`deploy/schedule/`), but nothing tells anyone about suspicious access. Detection of a breach depends on people looking.
2. **No access log for exports or for moderators viewing content.** You cannot say who looked at what.
3. **Request log retention is unset**, and there is no log of database access unless the host provides one.
4. **The student API host holds both encryption keys and database access.** Compromising it is the S1 case. Mitigations belong to hosting design (secret storage, hardening, ideally a key management service).
5. **The hosting provider is not chosen** (direction: a Nairobi data centre, see `deploy/HOSTING.md`), so backups, snapshots, network controls and the provider's own breach duties are unknown until you have its answers.
6. **The court-order unmask path needs only one person.** Misuse is possible and would appear in the audit log only after the fact.
7. **Key backup and restore drill is not done** (G7). Until it is, "rotate the keys" is untested under pressure.

---

## Appendix A: Incident register entry

| Field | Entry |
|---|---|
| Reference | INC-[year]-[nn] |
| Time first aware (exact, timezone) | |
| Who became aware, and how | |
| Incident lead | |
| Severity (S1/S2/S3) | |
| What happened (facts only) | |
| Data affected (classes) | |
| People affected (number, and how many have anonymous profiles) | |
| Anonymity broken? (yes / no / unknown, and why) | |
| Containment actions with times | |
| Evidence preserved (what, where) | |
| Legal holds placed (ids) | |
| Counsel contacted (time) | |
| Notify Data Commissioner? (decision, reasons, time decided) | |
| Notify affected people? (decision, reasons) | |
| Processors involved | |
| Notified Data Commissioner (time, by whom, reference) | |
| Notified affected people (time, how) | |
| Root cause | |
| Actions raised (owner, date) | |
| Closed (date, by) | |

## Appendix B: 72-hour worksheet

| Milestone | Due (aware + ...) | Done at | By | Notes |
|---|---|---|---|---|
| Awareness recorded | +0h | | | |
| Team assembled | +1h | | | |
| Containment | +4h | | | |
| First assessment | +24h | | | |
| Counsel engaged | +24h | | | |
| Notification decided | +48h | | | |
| Data Commissioner notified | **+72h** | | | |
| Affected people notified | without undue delay | | | |

## Appendix C: Notice to the Data Commissioner (content checklist)

**[Counsel to confirm the required content and the official channel.]** At minimum:

- Who we are: controller's name, address, registration status, and a contact person with a phone number and email.
- **What happened:** the nature of the breach, when it happened, when it was discovered, and whether it is ongoing.
- **What data:** the categories of personal data and of people affected, and the approximate number of each.
- **The likely consequences** for those people.
- **What we have done and will do:** containment, remediation, and measures to reduce harm.
- **What we have told the affected people**, or when and why we have not.
- **What is not yet known**, and when we will update.
- Whether a processor was involved, and who.

## Appendix D: Notice to affected people (template)

> **Subject: Important: a security incident affecting your Moku account**
>
> Hello [first name or "student"],
>
> We are writing to tell you about a security incident that affected your account on Moku.
>
> **What happened.** On [date], [plain description in one or two sentences, without jargon].
>
> **What information was involved.** [List exactly: for example "your university email address and the posts you made under your known profile". If anonymity was affected, say so directly: "information that could be used to connect your anonymous profile to your account".]
>
> **What it could mean for you.** [Honest, specific. For example "someone with this information could work out that a particular anonymous profile belongs to you."]
>
> **What we have done.** [Containment and fixes, in plain words. For example "We signed everyone out, changed the keys that protect this information, and closed the way it was accessed."]
>
> **What you can do.** [Specific, short, practical steps. For example "Sign in again with a new code. Consider deleting any anonymous posts you would not want connected to you. If you feel unsafe, contact [person]."]
>
> **We are sorry.** [One sincere sentence. No excuses.]
>
> **Who to contact.** [Name, role, email, phone]. You can also complain to the Office of the Data Protection Commissioner.
>
> We will tell you if we learn anything more.
> [Name], [role], [organisation]

## Appendix E: Tabletop scenarios

1. **A database backup is found in a public storage bucket.** Encrypted links present; keys unknown to be exposed. What is the severity? What do you need to find out first?
2. **A trust & safety officer's laptop is stolen.** Their database login and the blind-index key were on it. What can the thief do? What do you revoke?
3. **A student says an anonymous post of theirs was traced to them by another student.** There is no sign of a breach. What do you check, and what do you tell them?
4. **A moderator's token appears in a screenshot in a group chat.** What is exposed? What do you do in the first hour?
5. **The student API host is found to be running an unknown process.** Assume the worst. Walk through containment, key rotation and notification.
6. **A downloaded data export is posted publicly.** The file links two profiles. Whose problem is it, and what do you do?

## Appendix F: Queries to run at discovery

Run as the database owner. Paste the results into the register with the time.

```sql
-- How many accounts, by status, and how many have an anonymous profile
select status, count(*) from accounts group by status;
select count(*) as accounts_with_anonymous_profile from identity.anonymous_links;

-- Identity lookups in the last 30 days (who, which login, why, case, approver)
select looked_up_at, actor, actor_role, reason_code, case_ref, approved_by
  from identity.lookup_audit
 where looked_up_at > now() - interval '30 days'
 order by looked_up_at desc;

-- Has the audit log been trimmed? (each purge is recorded)
select purged_at, rows_deleted, older_than from identity.lookup_audit_purges order by purged_at desc;

-- Live sessions, and sign-ins in the last 24 hours
select count(*) as live_sessions from sessions where revoked_at is null and expires_at > now();
select count(*), min(created_at), max(created_at) from sessions where created_at > now() - interval '24 hours';

-- Moderators and whether they are active
select name, active, created_at from moderation.moderators order by created_at;

-- Which database logins can connect, and who holds trust & safety access
select rolname, rolcanlogin from pg_roles
 where rolname in ('auth_service','account_lifecycle','app_api','moderator','trust_safety');
select r.rolname as officer_login, r.rolcanlogin
  from pg_roles r
  join pg_auth_members m on m.member = r.oid
  join pg_roles g on g.oid = m.roleid
 where g.rolname = 'trust_safety';

-- Open connections right now, by login
select usename, count(*) from pg_stat_activity where usename is not null group by usename;

-- Penalties and reports recently created
select kind, count(*) from moderation.penalties where created_at > now() - interval '7 days' group by kind;
select status, count(*) from moderation.reports where created_at > now() - interval '7 days' group by status;
```
