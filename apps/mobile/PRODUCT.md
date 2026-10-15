# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

**Students (primary).** Verified students aged 18 and over at USIU-Africa, the only campus at launch. They use the app on their phones between classes, mostly Android, and some may be anxious or vulnerable when they post. They read what peers write, post as themselves or under an anonymous profile, comment, like, follow, and report content.

**Moderators.** Staff and trained student moderators who work a report queue in a web console. Urgent reports (threats, self-harm, intimate images) have a one hour target and all others 24 hours. They see content, photos and reasons, and never who reported or who owns an anonymous profile.

**Readers of the policies.** Students who read the privacy policy, terms, community rules and cookie notice, hosted as a static site, before they agree.

This record covers the mobile app, the moderator console (served by the admin service) and the policy pages. They share one product but are different jobs.

## Product Purpose

A social space limited to verified students of one university, so that posting feels safer than on open platforms. Success is judged by **weekly posters**, not downloads: the aim is to learn whether students post regularly when the audience is limited to verified peers.

## Positioning

Two things a neighbouring product cannot truthfully copy as a pair: the audience is only verified students of the same campus, and a student can post anonymously while remaining accountable. Other students cannot link an anonymous profile to a person; the operator can, only in defined cases under a two person rule, and the product says so plainly.

## Operating Context

- Phones, mostly Android, on variable connectivity.
- The campus calendar drives use: orientation week, exams, semester breaks.
- Accounts must be re-verified every year with the university email; graduates lose that mailbox and get a grace period to download their data.
- Moderation includes nights and exam periods; who covers them is undecided.
- Kenyan Data Protection Act 2019 duties apply, and a data protection lawyer has not yet reviewed any text.

## Capabilities and Constraints

- Built: sign up and sign in by emailed one time code, 18+ confirmation and unticked consent, posts of up to 5000 characters with up to 4 photos and author written photo descriptions, editing and deleting, comments, likes, follows, feeds (Newest, Top this week, Following), in app notifications, reporting with automatic hiding at three different reporters, one appeal for a banned student, crisis support information for flagged posts, data download, account closure, re-verification and reminder emails.
- Technical: one React Native and Expo codebase (SDK 57, Expo Router), a Node and PostgreSQL API, and a web moderator console in plain HTML, CSS and script with no third party code. The server is the authority; the app keeps only the session token on the device.
- Terminology: "known profile" and "anonymous profile"; badges read "You", "Student" and "Anonymous"; times on anonymous posts read "this hour".
- No analytics, advertising or tracking code. No location, no contacts, no ID documents.
- **Undecided:** push notifications, optional two factor sign in, blocking or muting a person, hosting, the legal entity, crisis helpline details, and the unmasking policy.

## Brand Commitments

The app is named **Moku**, confirmed by the owner on 2026-10-15. "Campus Social" was the working name; the screens, emails, policy pages and docs now say Moku. Technical identifiers (package ids, URL scheme, database name) still use the old name.

The visual direction is binding and comes from the sign-in reference supplied by the owner (`signin-reference.png`): a calm plain form beside a large rounded black-and-white photo panel with a concave notch, a translucent dark caption card, a near-black full-width primary button, hairline-bordered inputs, near-monochrome with a soft lavender and pink accent, and a bundled open-licensed typeface (Figtree). It replaces the earlier Dribbble "Social Media App Design" direction recorded on 2026-10-15. Identity colours (indigo for known, plum for anonymous) are never the only signal. The logomark is an original placeholder and there is no final logo yet; the icon and splash are plain placeholders.

Binding commitments are honesty about anonymity (never "screenshot proof"), no dark patterns, and no tracking.

The existing copy is plain, direct and open about limits. That voice was observed in the incumbent text, and the owner has not yet confirmed it as the brand voice.

## Evidence on Hand

- A drafted interview guide and survey for USIU students, **not yet run**, so there are no research findings.
- Draft privacy policy, terms, rules, cookie notice and a data protection impact assessment, none lawyer reviewed.
- No testimonials, pilot metrics, or customer statements exist and none may be invented.
- Nothing has run on a real phone yet.

## Product Principles

1. Be honest about what anonymity does and does not protect, every time it is mentioned.
2. Always make clear which identity is acting, and make anonymous posting a deliberate act.
3. Safety work (reporting, support, appeals) must be at least as easy as posting.
4. Ask for and keep the least personal data that does the job, and say what is kept.
5. Accessible by default for people on small screens, in poor light, using assistive technology.

## Accessibility & Inclusion

- WCAG AA contrast in light and dark, colour never the only signal, touch targets of at least 44 points, labelled fields, and descriptions for photos written by the poster.
- Screen readers are meant to work (TalkBack and VoiceOver), but neither has been tested on a device.
- English only at present.
