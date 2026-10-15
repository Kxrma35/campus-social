# Privacy Policy

> **DRAFT v0.2. Not legal advice.** Have a Kenyan data protection lawyer review before publishing. Items in [BRACKETS] must be filled in with real details; do not invent them. Update the "Last updated" date on every change.

> **Do not publish this text until the following are true.** The policy describes how the service is *meant* to behave. As of 2026-10-12 these promises are not yet kept by the software (see `DPIA.md` section 0.1):
>
> 1. ~~Deleted content is removed within 30 days~~ **Fixed and verified 2026-10-12**, photo files included. It happens when the maintenance job is run, so decide how often and who runs it, and make sure it is; otherwise sections 3 and 9 are untrue again.
> 2. ~~You can correct your profile details~~ **Done 2026-10-12** for name, course and year. **Email and date of birth cannot be changed in the app**, so section 8 needs a real contact and a process, and someone must own answering those requests.
> 3. ~~Your data export covers everything described~~ **Done 2026-10-12.** Counsel should confirm the scope, and in particular whether moderators' notes about you are disclosed.
> 4. ~~Retention periods for moderation records and audit logs are decided and implemented.~~ **Implemented and verified 2026-10-12** with suggested starting values. The controller and counsel must still confirm the periods, and the maintenance job must actually be run.
> 5. **Breach procedure, hosting, processors and helpline details** (sections 6, 7 and 10) are real, not placeholders.
> 6. **The unmasking reasons in section 5** match the policy the controller has actually decided.

**Last updated:** [date]
**App name:** [app name]

## 1. Who we are

[Legal name / business name] ("we", "us") operates [app name]. We are the data controller for the personal data described here.

- Address: [registered address]
- Email for privacy requests: [privacy contact email]
- Data protection contact: [name or role]
- ODPC registration number: [number, or "not currently required to register"]

## 2. Who this app is for

[App name] is for students aged **18 or older** at approved universities (currently USIU-Africa only). We do not knowingly collect data from anyone under 18. If we learn that an account belongs to someone under 18, we close it and delete its data.

## 3. What we collect, why, and how long we keep it

| Data | Why we need it | How long we keep it |
|---|---|---|
| University email address | Verify you are a student; sign you in; send one-time codes | While your account exists; replaced by a placeholder when your closed account is purged |
| Date of birth | Confirm you are 18 or older | While your account exists; removed when your closed account is purged |
| Your name, course and year (known profile) | Show your known profile to students at your campus | While your account exists |
| Generated handle and avatar (anonymous profile) | Show your anonymous profile | While your account exists |
| Posts, comments, reactions, who you follow | Provide the service | Until you delete them, then removed within 30 days (kept longer only while a report about them is still being reviewed); the rest with your account |
| Profile photo (optional, known profile only) | Show your face next to your name to students at your campus | Until you replace or remove it, or your account is removed. The file is deleted soon after. [period: counsel to confirm] |
| Photos | Provide the service | As your posts. The photo file is deleted with them, and photos you upload but never use are deleted after a day |
| In-app notifications | Tell you about replies, reactions and new followers | While your account exists |
| The link between your account and your anonymous profile | Enforce bans and answer valid legal orders | While your account exists; stored encrypted |
| Warnings, suspensions and bans against your account | Keep the community safe; let you appeal | Warnings stop counting, and are deleted, after 12 months. Suspensions and ended bans are deleted a year after they end. A ban in force is kept, with a one-way fingerprint of the email so it cannot be avoided [periods: counsel to confirm] |
| Reports about your content, and reports you make | Safety and appeals. Moderators and the person reported are not told that *you* made a report. | Reports that were dismissed: 90 days. Reports that were upheld, and our actions: 1 year after the decision [counsel to confirm] |
| Appeals you send and our decision | Review your appeal | The text of your appeal and our notes are removed 1 year after the decision. A bare record that an appeal was made is kept, so an appeal cannot be repeated [counsel to confirm] |
| Records of identity lookups (who looked, why, when) | Hold ourselves to account for unmasking | 3 years, then deleted. A hold for a legal case keeps the related records [counsel to confirm] |
| Sign-in records: one-time codes (kept as a keyed hash), sessions (token kept as a hash), optional device label | Keep your account secure | Codes are valid for 10 minutes and sessions for 30 days. Expired codes are deleted after a day and expired sessions after a week; the rest is removed with your account |
| A one-way fingerprint of the email of an account that was banned | Stop a banned account from signing up again | While the ban is in force |
| Server logs: IP address, time, the address requested, result | Keep the service secure and working | [period: fill in] |

We do **not** collect student ID photos, national ID numbers, your phone contacts, your precise location, or advertising identifiers. Photos you upload are re-saved by the server, which removes location and camera information stored inside the image file.

## 4. Our lawful bases

- **Contract:** to provide the service you signed up for.
- **Consent:** for optional features, such as push notifications if we add them. You can withdraw consent at any time.
- **Legitimate interests and legal obligation:** for security, preventing abuse, keeping students safe, and complying with the law.

[Lawyer to confirm the basis for each item.]

## 5. Anonymous profiles: what other students and we can see

**Other students** cannot see who owns an anonymous profile. Your anonymous posts show a generated handle and avatar, and times shown rounded down to the hour. Nobody can list who follows an anonymous profile except that profile itself.

**We can.** We keep an encrypted link between your account and your anonymous profile so we can act on serious rule-breaking. Here is exactly how that works:

- The link is encrypted with a key that is kept separately from the database.
- **Moderators** can warn, suspend or ban an anonymous profile, and see the reported content, without being able to see who owns it or who reported it.
- Only a very small group of named trust and safety staff can look up who owns an anonymous profile. Every lookup, including one that finds nothing, is recorded with the person's own login, the reason and a case reference, and the record cannot be edited or deleted.
- Unless it is a court order, a lookup also needs a second, different person to approve it. This is enforced by the system, not just by policy.
- We use the lookup only for: confirmed threats, targeted harassment, sharing intimate images without consent, exposing someone's private details, and valid court orders. [Confirm this list once the unmasking policy is decided. In particular, state whether university disciplinary cases are included.]

**Being honest about the limits:**

- The people who run the service hold the technical means to connect the two profiles. That is why access is limited, recorded and, outside court orders, needs two people.
- Anonymity here means other students cannot see who you are inside the app. It does not stop someone recognising your writing style, and it does not stop screenshots, which the app cannot block.
- If you report something from your anonymous profile, we tie the report to you as a person internally, so that one person cannot report the same thing twice from two profiles. This is never shown to moderators or to the person you reported.

## 6. Who we share data with

We do not sell your data and do not share it for advertising. We share it only with:

| Recipient | Purpose | Location |
|---|---|---|
| Our moderators (staff and trained student moderators) | Review reported content and reasons. They cannot see who reported, or who owns an anonymous profile. | [Kenya] |
| [Hosting provider] | Hosting and storage | [country / region] |
| [Email service] | Sending one-time codes | [country] |
| [Push notification service, if added] | Notifications | [country] |
| Authorities | Only where a valid legal order requires | Kenya |

[Complete after hosting and vendors are chosen. Remove anything not used. Do not add analytics or advertising tools without updating this policy and asking for consent. State here whether anything is shared with the university.]

## 7. Transfers outside Kenya

Some of our providers may process data outside Kenya. Where that happens we rely on [safeguards: contract terms, adequacy, or your consent as applicable] as required by the Data Protection Act, 2019. [Fill in after hosting is decided.]

## 8. Your rights

Under the Data Protection Act, 2019 you can:

| Right | How |
|---|---|
| Be told how your data is used | This policy |
| Access your data and get a copy | Download your data from the app. It includes your account details, both profiles, your posts (including any hidden by moderators), comments, reactions, who you follow, how many follow you, notifications, photos, sign-in sessions, and your moderation records: reports you made, reports about your content (the reason and the outcome), warnings with their reasons, and your appeals. It lists what is withheld and why. Reporters are kept confidential, so you will not see who reported you or what they wrote. |
| Correct inaccurate data | Change your name, course and year in the app. For your email address or date of birth, email [privacy contact email]; we may need to confirm it is you. If you cannot sign in, use the same address. |
| Delete your data | Delete individual posts and comments in the app, or close your account (you confirm with a one-time code sent to your university email) |
| Object to processing, or withdraw consent | Email [privacy contact email]. There is no optional processing you can switch off yet. |
| Take your data elsewhere | The downloaded file is in a standard format (JSON) |

We respond within [30 days, confirm with lawyer]. You may also complain to the Office of the Data Protection Commissioner (ODPC), Kenya.

## 9. Account closure, re-verification and what remains

- **Backups.** We keep encrypted backups of the service so we can recover from a failure. A backup can still hold content you deleted, or an account you closed, until it is replaced. Backups are kept for [backup retention period] and then deleted, and the data in them is not used for anything else.
- **Reminders.** Before the deadline, and again before a read-only account would close, we email your university address to remind you. These emails are plain text, contain no tracking and no links, and are the only emails we send apart from one-time codes. We keep a short record of which reminder was sent so we do not send it twice, and delete it after about 13 months.
- **Re-verification.** Once a year you confirm your university email with a one-time code. If you do not, your account becomes **read-only** (you can still sign in, download your data and re-verify). After a further [30 days] it closes.
- **Graduating.** If you lose your university email, you cannot re-verify, so you have the same grace period to download your data. Then your account closes.
- **Closing on request.** You can close your account yourself. Your profiles and content disappear from view immediately.
- **Permanent removal.** [30 days] after closure, your content, both profiles, the encrypted link, your sign-in records, and your email and date of birth are permanently removed, and so are your photo files.
- **What remains afterwards.** A minimal record that the account existed and when it closed. Reports, penalties and appeals that mention your account are kept for the periods in section 3 so that we can answer questions about past decisions. If your account was banned, a one-way fingerprint of the email stays so the ban cannot be avoided.

## 10. Security

What we do:

- One-time codes and sign-in tokens are stored only as hashes.
- The link to your anonymous profile is encrypted, and the key is kept apart from the database.
- Different parts of the service use different database logins with only the access they need. Moderators cannot read accounts, reporters or the link.
- Identity lookups are recorded in a log that cannot be edited.
- Photos, including a profile photo, are re-saved by the server and shown only to signed-in students at your campus. An anonymous profile cannot have a photo.
- [Encryption in transit and at rest: depends on hosting; confirm.]

No system is perfectly secure. If a breach affects your data, we will notify the Data Commissioner within 72 hours of becoming aware and tell affected users. [Describe the procedure once it exists.]

## 11. Automated checks

Posts and comments are automatically checked for words and phrases that may suggest someone is thinking about harming themselves. A match does not hide your post or count against you. It places the post in front of a moderator quickly and shows you information about where to get support. The check is imperfect: it can miss things and can flag harmless text. Moderators decide what, if anything, happens.

## 12. Cookies and similar technologies

The service does not set cookies and uses no advertising or tracking tools. See the Cookies and Trackers notice.

## 13. Changes

We will tell you in the app before material changes take effect.

## 14. Contact

[privacy contact email] · [postal address]
