# Cookies and Trackers

> **DRAFT v0.2. Not legal advice.** Have a Kenyan data protection lawyer review before publishing. This describes the **server** as built on 2026-10-12. The mobile app now exists as a first build (Expo SDK 57); the section on the app below says what has been checked and what has not.

## In short

- The service **does not set cookies**.
- It uses **no advertising, analytics or tracking tools**, and loads no third-party scripts.
- Nothing about you is shared with advertisers, because there are none.

## What identifiers the service does use

| Identifier | What it is for | Where it lives | Consent needed? |
|---|---|---|---|
| Sign-in token | Keeps you signed in. Sent by the app as an `Authorization` header, **not** a cookie. Stored on our side only as a hash. | The device's secure storage (Android Keystore-backed, iOS Keychain); the browser preview of the app keeps it in memory only; a hash on the server | No: strictly necessary to provide the service you asked for |
| Optional device label | Lets you recognise your own sessions | Server | No |
| One-time email codes | Verify you control your university email | Your email; a keyed hash on the server | No |
| Server request log: IP address, time, address requested, result | Security and fault-finding | Server logs, [retention period to set] | No, but must be disclosed (it is, in the Privacy Policy) |

The sign-in token and one-time codes are not used to follow you around or to build a profile of you.

## Third-party code

Server code uses open-source libraries for the web framework, database access, input validation and image processing. None of them send data to third parties.

| Component | Purpose | Licence | Sends data off the server? |
|---|---|---|---|
| Fastify | Web framework | MIT | No |
| node-postgres (`pg`) | Database access | MIT | Only to our own database |
| zod | Input validation | MIT | No |
| sharp | Re-saving photos and removing metadata | Apache-2.0 | No |

[Hosting provider, email provider and any push provider: list here with their data location once chosen.]

## The mobile app: what is checked

Checked on 2026-10-12 against the app's configuration and dependency list. This is not a substitute for testing on a device or for an audit of transitive dependencies.

- [x] **No advertising, analytics, crash-reporting or social-login SDK** is among the app's direct dependencies. Transitive dependencies have not been audited.
- [x] **The sign-in token is held in the platform's secure storage** (`expo-secure-store`). Nothing else is kept on the device between launches: no profile data, no posts, no credentials.
- [x] **The Android app asks for no camera, microphone or storage permission.** Photos are chosen with the system photo picker, which gives the app only the photos you select. Android cloud backup of app data is switched off.
- [x] **No push notifications exist.** The Privacy Policy section on push tokens must stay switched off until they do.
- [ ] **Every dependency, font and image has a recorded licence and source.** The artwork is recorded below; the dependency licence review has not been done.
- [ ] **A web page that sets cookies or loads third-party code would need a cookie banner and a cookie list here.** The policy pages built from these documents set no cookies and load nothing from other sites. Re-check this if any other page is added.

## Licence and source record (fonts, images, data)

| Asset | Source | Licence | Date recorded |
|---|---|---|---|
| App icon, splash screen, favicon (`apps/mobile/assets`) | Original placeholder drawn for this project from plain shapes (`apps/mobile/assets/source/*.svg`); no third-party artwork | The project's own; to be replaced with real branding before launch | 2026-10-12 |
| Fonts | None bundled: the app and the policy pages use the system fonts | n/a | 2026-10-12 |

## Changes

We will update this notice before adding anything that sets a cookie or collects data through a third party.
