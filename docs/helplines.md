# Helplines shown after a flagged post

When a post or comment matches the self-harm phrase list, the author sees a short message and the services below. The text lives in one place, `SUPPORT_RESOURCES_JSON` in `deploy/env.api.example`, so changing a number never needs a code change.

**Status:** checked against each organisation's own published page on 2026-10-15. That is not the same as confirmed. A number that is wrong or out of service at the moment someone needs it does harm, so **call each one yourself before launch and record the date and who did it in the table below.**

## What the app shows

| Order | Service | Number | What the app says | Source checked 2026-10-15 | Called and confirmed |
|---|---|---|---|---|---|
| 1 | Befrienders Kenya | +254 722 178 177 | Emotional support by call, SMS or WhatsApp, every day 9:00 to 17:00 | Befrienders Worldwide listing for Befrienders Kenya. Their own site showed "coming soon", so the hours need a call. | not yet |
| 2 | NACADA | 1192 | Free counselling on drugs and alcohol, 24 hours | nacada.go.ke | not yet |
| 3 | Healthcare Assistance Kenya (GBV hotline) | 1195 | Gender-based violence hotline, free | gender.go.ke (Ministry of Gender page for HAK 1195) | not yet |
| 4 | Kenya Red Cross | 1199 | Free emergency line | redcross.or.ke contact page | not yet |

Left out on purpose: **Childline Kenya (116)** is a children's service and the app is for students aged 18 and over; **the generic national emergency numbers** are not in the list because I did not verify them from a source, and the app already says "contact your local emergency services" when it has no list.

## Things to know

- **There is a night-time gap.** Befrienders is listed as 9:00 to 17:00 and the Red Cross line is an emergency line, not counselling, so a student in distress at night has only NACADA (substances), the GBV line and the Red Cross emergency line. That is a gap in what exists, not something the app can fix. The student's own counselling service at USIU, if it has an after-hours route, belongs here.
- **Numbers shown as a call button need to be plain numbers.** A contact like "visit the Freida Brown Student Centre" is shown as text with no button, which is what you want for a place.
- **Wording must stay honest.** Do not describe a service as 24 hours, free or confidential unless its own page says so.

## Still to add: the USIU Counseling Center

USIU-Africa's Counseling Center ("Freedom to Talk") is described as free and confidential and housed in the Freida Brown Student Centre, but its public pages list **no phone, email or hours**. Ask student affairs or the Counseling Center directly (this is also open decision 7, telling student affairs before the beta) for:

- a number or email students may use, and whether it is staffed after hours;
- whether they are willing to be listed and to receive referrals;
- what they would like students to be told.

When you have it, add an entry such as:

```json
{"name": "USIU-Africa Counseling Center: free and confidential", "contact": "<number they give you>"}
```

to the end of `SUPPORT_RESOURCES_JSON`. Put it first if they are staffed more hours than Befrienders.

## Changing the list

1. Edit the `SUPPORT_RESOURCES_JSON` value in the API environment file (one line of JSON).
2. Run `node deploy/check-production.mjs --api .env.api`, which refuses an entry without a name and contact.
3. Restart the API. Nothing is cached on devices.

## Review cadence

Re-check every number before each term and whenever a student or moderator reports a dead line. Record the date in the last column.
