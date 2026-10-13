# Campus Social: mobile app

React Native + Expo (SDK 57), TypeScript, Expo Router. Talks to `apps/api`.

## Run it

```bash
npm install
npm start          # Metro; press "a" for an Android emulator, or scan with Expo Go
```

The API address comes from `app.json` → `extra.apiBaseUrl` (default `http://10.0.2.2:3000`,
the Android emulator's alias for your computer). On a physical phone use your computer's
LAN address, for example `http://192.168.1.20:3000`, and run the API listening on all
interfaces.

Policy pages are **not** bundled. Set `EXPO_PUBLIC_LEGAL_BASE_URL` to where the reviewed
documents are hosted (`/privacy`, `/terms`, `/rules`, `/cookies`). While it is unset the
app says the documents are not available yet rather than showing drafts as final.

## Checks

```bash
npm run typecheck
npm test                 # 156 tests: core, components, auth flow, main screens
npm run bundle:check     # headless Hermes bundle for Android
npm run doctor
```

## Browser preview (no emulator needed)

Shows layout and flows in Chrome. It is **not** an Android test: photo picking, file sharing
and screen readers behave differently, and the session token is kept in memory only, so a
reload signs you out.

1. Start Postgres and apply `db/migrations/*.sql` (see the repo README), and give the roles
   passwords.
2. In this throwaway database only, activate the university so sign-up works:
   `update universities set active = true;` (the migration leaves it off until the real
   student domain is confirmed).
3. Start the API with `DEV_CORS_ORIGIN=http://localhost:8081` and
   `ANON_MIN_ACCOUNT_AGE_DAYS=0` (to try the anonymous profile straight away). CORS is off
   unless that variable is set, and the API refuses to start with it in production.
4. Start the app:
   `EXPO_PUBLIC_API_BASE_URL=http://localhost:3000 npx expo start --web --port 8081`
5. Open http://localhost:8081 (F12, then the device toolbar for phone width).

There is no email provider yet. One-time codes print in the API log as
`[mail:dev] signup code for ...`.

When finished, stop Metro, the API and the container (`docker stop campus-pg`).

## Building a pilot app (EAS)

`eas.json` has two profiles: `preview` (an installable APK for testers) and `production`
(an app bundle). Both run `scripts/check-release-config.mjs` first, which refuses to build when:

- `EXPO_PUBLIC_API_BASE_URL` or `EXPO_PUBLIC_LEGAL_BASE_URL` is missing, is not `https://`, or is a
  private network address (release Android builds block plain `http`);
- (production only) the package id is still the placeholder.

```bash
npm install -g eas-cli && eas login
eas build:configure                      # once, links the project to your Expo account
# Set the two URLs as EAS environment variables for the profile, then:
eas build --platform android --profile preview
```

Before the first real build you need, and I have not been able to do for you:

- An Expo account, and a real **package id** (currently `ke.campussocial.app.dev`, a placeholder
  that is permanent once an app is installed from a store). Change it in `app.json`, in both
  `android.package` and `ios.bundleIdentifier`.
- A hosted API over https, and the policy pages hosted (see `../../legal/README.md`).
- Real branding. `assets/` holds a plain placeholder icon and splash drawn for this project;
  `npm run assets` re-renders them from `assets/source/*.svg`.

What the Android build asks for: internet access and vibration. It requests no camera,
microphone or storage permission, and cloud backup of app data is off. The build is
portrait-only and phone-only (`supportsTablet: false`) because nothing else was designed or tested.

## What has and has not been verified

Verified in this repo: typecheck, the Jest suite, the Android bundle, `expo-doctor`.

**Not verified:** anything on a real device or emulator (the browser preview above runs, but is not an Android test). Layout, keyboard behaviour,
screen reader output (TalkBack/VoiceOver), photo picking, and sharing the export file
have not been exercised on hardware. Do that before any pilot.

## Known gaps

- Photo descriptions can be written when posting, but there is no screen yet to edit one afterwards (the API supports it: `PATCH /photos/:id`). Photos without a description are announced as having none.
- No push notifications; notifications are in-app only.
- The icon and splash are placeholders, and the package id is a placeholder (see "Building a pilot app").
- Legal documents are drafts (see `../../legal`); a static site can be built from them but is not hosted anywhere.
- `npm audit` reports vulnerabilities in Expo build tooling. Do not use `npm audit fix --force`;
  it downgrades Expo. Review them when upgrading the SDK.

## Privacy behaviour worth knowing

- Only the session token is stored on the device (SecureStore). No analytics or ad SDKs.
- The composer always starts as the known profile; posting anonymously needs an explicit switch
  and a confirmation when the server asks for it.
- Anonymous post times are shown rounded ("this hour") because the server rounds them.
- Photos are fetched with the session token and are not cached outside the app.

## Licences and assets

No third-party artwork, fonts or icons are included. Dependencies keep their own licences
(see `package.json`); check before adding any asset and record its source here.
