# Licence and source record

Every font, image and icon set in the app, with where it came from and under what licence.
Update this file in the same change that adds an asset. Draft: not yet checked by a lawyer.

| Asset | Where it is used | Source | Licence | Recorded |
|---|---|---|---|---|
| Figtree (400 Regular, 500 Medium, 600 SemiBold) | All app text | `@expo-google-fonts/figtree` npm package, bundled at build time; never fetched at run time. Designed by Erik Kennedy | SIL Open Font License 1.1 | 2026-10-15 |
| Placeholder hero art | Sign-in panel | Drawn for this project as SVG shapes in `apps/mobile/src/ui/HeroPanel.tsx`; contains no photograph or person. Labelled "Placeholder image" in the app | The project's own | 2026-10-15 |
| Logomark (two overlapping circles) | Sign-in screens | Drawn for this project in `apps/mobile/src/ui/Logomark.tsx`; a placeholder until the brand is finished | The project's own | 2026-10-15 |
| Icon set (home, bell, person, heart, comment, plus, chevron, flag, lock, image, close) | Whole app | Drawn for this project as SVG paths in `apps/mobile/src/ui/Icon.tsx`; no third-party icon pack | The project's own | 2026-10-15 |
| App icon, splash screen, favicon | App store and launch | Original placeholders in `apps/mobile/assets` (sources in `assets/source`) | The project's own | 2026-10-12 |
| Libraries (`expo-image`, `expo-blur`, `expo-font`, `expo-haptics`, `react-native-svg`, others) | Whole app | npm | Each keeps its own licence (MIT in all cases checked so far); a full dependency review is still open in `legal/COOKIES_AND_TRACKERS.md` | 2026-10-15 |

Not used and not to be added without recording them here: stock photography, a person's photograph,
testimonials from people who have not given consent, trackers, analytics or crash reporting SDKs.

## Dependency review, 2026-10-15

Run by script over the lockfiles (production dependencies only). A lawyer or the owner should confirm anything marked "check".

**Licences**

| App | Installed production packages | Notes |
|---|---|---|
| Mobile | 782 | 669 MIT, 48 ISC, 20 BSD-3, 12 BSD-2, 11 Apache-2.0, 6 BlueOak, and a handful of 0BSD, Unlicense and dual licences. Three MPL-2.0 packages (`lightningcss` and its platform builds) are build tooling for the web preview and are not shipped in the app. One package is MIT AND OFL-1.1: the Figtree font package, recorded above. |
| API | 98 | 57 MIT, 28 Apache-2.0, 4 BSD-3, 4 ISC and others. Two LGPL-3.0 packages: the prebuilt libvips binaries that `sharp` uses to re-save photos. They are used unmodified on the server and linked dynamically; check the obligations if the container image is ever handed to someone else. |

**Trackers and SDKs.** No analytics, advertising, crash-reporting, attribution, location, contacts, camera, microphone or push packages are in either production dependency tree. Over-the-air updates are not configured. The app asks only for the photo picker.

**Known vulnerabilities (`npm audit --omit=dev`)**

| App | Result |
|---|---|
| API | 0 |
| Legal site builder | 0 |
| Mobile | 63 reported, from five advisories. Four are in tooling that does not ship in the app (`node-forge` via the Expo CLI, `braces` via Metro, `uuid` via an Expo config plugin, `sprintf-js` via the test runner). One is in the app: `decode-uri-component` 0.2.2, reached through `expo-router`'s URL parser, a moderate denial-of-service on a maliciously crafted link. Impact is the app hanging on a hostile deep link, not data exposure. It needs an upstream `expo-router` update; do not use `npm audit fix --force`, which breaks the Expo version pins. Re-check before each release. |
