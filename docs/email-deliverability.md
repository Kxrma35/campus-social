# Getting sign-in codes to USIU mailboxes

Every sign-in, sign-up, re-verification and account-closing step depends on one email reaching a student's USIU mailbox within seconds. If it lands in junk or quarantine, the student cannot use the app. This is the single most likely thing to go wrong on the first real day, so it is worth an hour of care before it.

## What USIU's mail system looks like

Read from public DNS on 2026-10-15 (`node deploy/check-mail-dns.mjs --domain usiu.ac.ke --recipient-domain usiu.ac.ke`):

- **Mail goes to Microsoft 365 first** (`usiu-ac-ke.mail.protection.outlook.com`, preference 1), with **Google Workspace as the fallback** (preferences 5 to 15). Microsoft 365 filters unknown senders strictly and may place a first message from a new sender in junk or in a quarantine the student cannot see.
- USIU's SPF record allows both Microsoft and Google. Its DMARC policy is `p=none`.
- I could not tell from DNS which system a given student's mailbox actually lives on. Test with real accounts.

## What the app already does well

- **Plain text only, no links, no images**, and the code is never in the subject. This is what filters like best.
- Marked as automated (`Auto-Submitted: auto-generated`, `X-Auto-Response-Suppress: All`), so out-of-office replies are not triggered.
- A code lasts 10 minutes, a student may ask for 5 an hour, and the app tells them to check spam.
- The app never prints a code to a log in production, and refuses to start without working SMTP settings.

## What you have to do (in order)

1. **Own a domain to send from.** Use a subdomain you control, such as `mail.<yourdomain>`, not a free webmail address and not the university's domain. **I have not seen that you own a domain yet. This blocks everything below.**
2. **Choose an email provider with SMTP.** Criteria: it will sign a data processing agreement (it sees every address and every code), it says where it processes, it gives you DKIM signing for your own domain, it shows bounces, and it does not insert tracking links or pixels into your messages (turn any such option off). It is a transfer decision as well as a technical one; see `deploy/HOSTING.md`.
3. **Publish its DNS records** on your domain: SPF, DKIM (the provider gives you one or more selectors) and DMARC. Start DMARC at `p=none` with a `rua=` address you actually read.
4. **Check them:**
   ```bash
   node deploy/check-mail-dns.mjs --from "Moku <no-reply@mail.yourdomain>" \
        --dkim-selector <selector-from-your-provider> --recipient-domain usiu.ac.ke
   ```
   It refuses a missing or duplicated SPF, a missing DMARC, a missing or revoked DKIM key, and warns on `p=none` and a missing `rua=`.
5. **Prove delivery to a real USIU mailbox** (yours or a volunteer's), from the machine that will really send:
   ```bash
   cd apps/api
   SMTP_URL='smtps://USER:PASSWORD@smtp.provider:465' MAIL_FROM='Moku <no-reply@mail.yourdomain>' \
     npm run mail-test -- you@usiu.ac.ke
   ```
   It sends one message with no code in it, tells you what the server said, and names the usual failures (login refused, cannot connect, TLS or port mismatch, recipient refused). **"Accepted" is not "delivered":** open the mailbox and look in Inbox, Junk and any quarantine.
6. **Read the headers of what arrived.** In Outlook or Gmail, view the message source and look for `Authentication-Results`. You want `spf=pass`, `dkim=pass` and `dmarc=pass`, all aligned to your domain. Anything else is the thing to fix.
7. **If Microsoft quarantines it,** ask USIU's IT team (template below).
8. **Ramp up.** Send to 5 to 10 volunteers on different accounts first, then widen. A new sender that suddenly sends hundreds of messages looks like abuse.

## Template for USIU IT

> **Subject:** Allow sign-in emails for Moku student pilot
>
> We are running a small student pilot of Moku, an app for verified USIU-Africa students (18+). It sends each student a one-time sign-in code to their USIU address. We would like to make sure those messages reach inboxes.
>
> Sending domain: `mail.<yourdomain>` (SPF, DKIM and DMARC published). Sender: `no-reply@mail.<yourdomain>`. Messages are plain text with no links or attachments, a few per student per day at most, and have the headers `Auto-Submitted: auto-generated`.
>
> Could you add the sending domain to the allow list in Microsoft 365 (Tenant Allow/Block List, or a mail flow rule), and tell us if any messages are being held in quarantine? We can send a test to an address you nominate.
>
> Contact: [name, role, phone, email]

Send this to the university only after the student affairs conversation (decision 7), so IT is not surprised.

## If a code does not arrive

| Symptom | Likely cause | What to check |
|---|---|---|
| The app says it could not send the email | The SMTP login, host or port is wrong, or the provider is down | The API log line `[mail] delivery failed code=...`; run `npm run mail-test` |
| Accepted but nothing in the inbox | Junk or quarantine at Microsoft 365 | Junk folder, the quarantine portal, the headers, then the IT request |
| Works to Gmail, not to USIU | SPF, DKIM or DMARC not aligned | `check-mail-dns.mjs`, then the headers |
| Arrives minutes late | Provider queueing or greylisting | The provider's delivery log |
| Some students, not others | Different mailboxes (Microsoft or Google) filtering differently | Ask which system they use; test both |
| A code arrives but "expired" | Delay past 10 minutes | Provider log; the student asks for a new code |

## Things not to do

- Do not shorten the mail to "just the number". Short, bare messages from new domains look like phishing.
- Do not add a link or button "to make signing in easier". Links are the strongest spam signal and teach students to click.
- Do not raise `MAX_CODES_PER_HOUR` to hide a deliverability problem. It lets an attacker use you to flood a student's inbox.
- Do not send a test blast to everyone before the check passes.

## What I could not verify

- I have **not** sent a real message to a USIU mailbox. No sending domain, provider or credentials exist yet, so all of the above is checked by DNS reading and unit tests only.
- Which of Microsoft 365 or Google a particular student's mailbox lives on.
- Whether USIU applies extra filtering rules beyond Microsoft's defaults.
