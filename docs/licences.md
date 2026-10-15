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
