# Pilot test script

For the first real run of Moku on real phones with real USIU emails. It turns "it seemed to work" into a recorded result you can show a lawyer, student affairs and yourself.

**Who:** you plus 3 to 5 students you trust (aged 18+), on at least two different Android phones, ideally one low-end, plus one moderator.
**How long:** about 90 minutes per tester, in one sitting, with someone watching or on a call.
**Rule:** write down what actually happened, including "it worked". Do not fix things during the session; note them.

## Before you start

| Check | Done |
|---|---|
| A test environment, not the real one, with its own database and its own email domain settings | [ ] |
| `node deploy/check-production.mjs --api .env.api --admin .env.admin --closed-test` passes | [ ] |
| `docs/email-deliverability.md` steps 1 to 6 done, and a real USIU mailbox received the test email | [ ] |
| Helplines confirmed by a call (`docs/helplines.md`), or the tester briefed that numbers are unconfirmed | [ ] |
| A moderator token issued for the moderator tester, and the console reachable privately | [ ] |
| `ANON_MIN_ACCOUNT_AGE_DAYS` set to 1 or more (the production check refuses 0). Plan the anonymous tests for the second day, or use an account at least that old | [ ] |
| Each tester knows this is a pilot and the policies are drafts (script below) | [ ] |

## What to tell testers

> You are helping test an app for USIU students called Moku. It is early, so things will break and the legal documents are drafts that a lawyer has not reviewed yet. Please do not post anything you would not want kept. You can delete your account at the end and we will delete your data. We will not share what you post outside the test. Tell us anything confusing, not only things that break. You can stop at any time.

## Scenarios

Mark each **Pass**, **Fail** or **Skipped** and write one line of what happened.

### A. Signing up and in

| ID | Do this | Expect | Result | Notes |
|---|---|---|---|---|
| A1 | Sign up with your USIU email | The code arrives in the **inbox** within 60 seconds. **Record the actual time.** | | |
| A2 | Enter the code, then your date of birth | Moves on; the 18+ box starts unticked | | |
| A3 | On the agreements step | Three separate boxes, all unticked; each "Read ... (draft)" opens a screen marked DRAFT | | |
| A4 | Set up your profile with a handle of your choice | Account created; the handle is yours, in lower case | | |
| A5 | Try a handle that is taken, or "moderator" | A clear message on the handle field; the code is **not** used up | | |
| A6 | Finish: add a photo, or skip | Either works; skipping loses nothing | | |
| A7 | Sign out, then sign in with a new code | Signed in; old session gone | | |
| A8 | Enter a wrong code | A plain "not right" message | | |
| A9 | Wrong code 5 times | Locked; asks you to request a new code | | |
| A10 | Wait over 10 minutes, then use the code | "Expired" message; Continue is disabled | | |
| A11 | Try a non-USIU email (for example Gmail) | An inline error **before** anything is sent | | |
| A12 | Enter a date of birth under 18 (a **test** value) | A respectful stop screen; nothing created | | |
| A13 | Turn on airplane mode and ask for a code | A friendly "can't reach the server" message, no crash | | |
| A14 | Ask for codes repeatedly | A resend cooldown of 30 seconds; a limit message after 5 an hour | | |

### B. Posting, reading and following

| ID | Do this | Expect | Result | Notes |
|---|---|---|---|---|
| B1 | Write a text post | Appears at the top of Newest within a few seconds | | |
| B2 | Post with a photo and a description | Photo shows; the description is read out by TalkBack | | |
| B3 | Edit your own post, then delete another | Edit shows "edited"; delete removes it | | |
| B4 | Like and unlike a post; open comments and reply | Count changes at once; **you feel a short tap** on a real phone | | |
| B5 | Follow another tester | Their posts appear under Following; unfollow works | | |
| B6 | Have someone like and comment on yours | Notifications appear, and show who | | |
| B7 | Open the Following tab with nobody followed | A calm empty state with a way back | | |

### C. Anonymous profile

| ID | Do this | Expect | Result | Notes |
|---|---|---|---|---|
| C1 | On a brand new account, open Anonymous profile | Says when it unlocks, not just "no" | | |
| C2 | Create one after the unlock | You must tick that you understand; the handle is generated | | |
| C3 | Post anonymously for the first time | A confirmation appears first, with the honest wording | | |
| C4 | Look at your anonymous post from another phone | Shows "Anonymous" with a generated handle, a time rounded to the hour, **no photo** | | |
| C5 | Ask the other testers: can you tell whose it is? | They cannot, from the app. Note any guess and why | | |
| C6 | Switch "Post as" with a photo attached | It asks before removing the photo | | |
| C7 | Look for any wording that says "untraceable" or "safe from screenshots" | None anywhere | | |

### D. Safety and moderation

| ID | Do this | Expect | Result | Notes |
|---|---|---|---|---|
| D1 | Report a post, choosing a reason | A short thank-you that reveals nothing about others | | |
| D2 | The moderator opens the console | The report appears, urgent ones first, with a due time. Reporter not shown | | |
| D3 | Three different testers report one post | It disappears from the feed for others | | |
| D4 | Post a **test** sentence such as "I want to die" (tester warned first; the moderator knows) | The author sees the support message and the helplines with Call buttons; the moderator sees an urgent item | | |
| D5 | The moderator removes a profile photo, with a reason | The photo disappears for others; the student keeps their account | | |
| D6 | The moderator bans a **test** account, then upholds the appeal | The student is signed out; the appeal flow works; content returns on upheld | | |
| D7 | Try to edit a post that has an open report | Refused with a neutral message | | |

### E. Account and data

| ID | Do this | Expect | Result | Notes |
|---|---|---|---|---|
| E1 | Edit your name and course | Saved; the handle behaves as the screen says | | |
| E2 | Add, replace and remove a profile photo | Others see it on your posts, comments and profile; initials return after removal | | |
| E3 | Download your data | A file you can open; it says what is withheld | | |
| E4 | Close a **test** account | Needs a code and a tick; afterwards you cannot sign in | | |
| E5 | Re-verification (test database only: ask the developer to move that account's due date back) | Banner and the confirm flow; account becomes read-only if ignored | | |

### F. Phone, accessibility and conditions

| ID | Do this | Expect | Result | Notes |
|---|---|---|---|---|
| F1 | Set the system font to the largest size and go through sign-in, feed, post | Nothing clipped or unreachable | | |
| F2 | Turn on TalkBack and do sign-in, feed, one post, composing | Everything is announced in a sensible order; the posting-as choice is announced | | |
| F3 | Dark mode and light mode | Readable in both; no pure white flashes | | |
| F4 | A slow connection (mobile data, indoors) | Loading shows, then content or a clear error; no endless spinner | | |
| F5 | Scroll a feed of 50 or more posts on the lowest-end phone | Smooth enough to use; note any stutter | | |
| F6 | The tab bar labels and the back button | Visible, not clipped, easy to reach with one thumb | | |
| F7 | Rotate the phone | Nothing breaks (the app is portrait-first) | | |

## Bug report template

```
ID:            (scenario id, or "new")
Phone:         (make, model, Android version, font size, dark or light)
What I did:    (numbered steps)
What I expected:
What happened: (a screenshot helps; hide any real names or addresses first)
How bad:       blocks me / annoying / small
Time and date: (so the server log can be matched)
```

## Recording the results

| Tester | Phone | Date | Passed | Failed | Skipped | Biggest problem |
|---|---|---|---|---|---|---|
| | | | | | | |

## Ready for a wider test when

- Every A and D scenario passes on at least two phones.
- A1 averages under 60 seconds and **every** tester's code arrived in the inbox, not junk.
- No scenario in C shows wording or behaviour that overpromises anonymity.
- F1 and F2 pass, or each failure has a fix scheduled.
- Nothing in the results contradicts the privacy policy or the DPIA draft. Anything that does goes to the lawyer.
