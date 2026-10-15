---
name: Moku
description: A campus feed set like a small publication with a face, in quiet blue, lilac and neutrals.
colors:
  background: "#FFFFFF"
  surface: "#F3F4F6"
  text: "#111827"
  text-muted: "#4B5563"
  border: "#6B7280"
  primary: "#1D4ED8"
  on-primary: "#FFFFFF"
  danger: "#B91C1C"
  success: "#166534"
  anonymous: "#6D28D9"
  on-anonymous: "#FFFFFF"
  hairline: "#6B728040"
  primary-soft: "#1D4ED81A"
  anonymous-soft: "#6D28D91A"
  dark-background: "#0B0F19"
  dark-surface: "#161C2D"
  dark-text: "#F3F4F6"
  dark-text-muted: "#A8B0C0"
  dark-border: "#8892A6"
  dark-primary: "#93C5FD"
  dark-on-primary: "#0B0F19"
  dark-danger: "#FCA5A5"
  dark-success: "#86EFAC"
  dark-anonymous: "#C4B5FD"
  dark-hairline: "#8892A640"
  dark-primary-soft: "#93C5FD26"
  dark-anonymous-soft: "#C4B5FD26"
typography:
  display:
    fontFamily: "Literata_600SemiBold, serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: "38px"
  reading:
    fontFamily: "Literata_400Regular, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: "27px"
  reading-large:
    fontFamily: "Literata_400Regular, serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: "30px"
  title:
    fontFamily: "system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: "30px"
  heading:
    fontFamily: "system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "24px"
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "22px"
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  small:
    fontFamily: "system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
rounded:
  sm: "6px"
  md: "10px"
  lg: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "44px"
  chip-anonymous:
    backgroundColor: "{colors.anonymous}"
    textColor: "{colors.on-anonymous}"
    typography: "{typography.small}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  chip-known:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.small}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  notice:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "12px"
  field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "44px"
  field-writing:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.reading-large}"
    padding: "12px 0"
    height: "180px"
---

# Design System: Moku

## Overview

**Creative North Star: "The Campus Notebook Page"**

A feed that reads like a small publication with a face. Every post opens with a person and is set as a short published note in a serif reading face, over a quiet hairline list. Controls and labels stay in the system sans so that writing is the only thing that looks written. Concept: Instagram's person-led posts mashed with Substack's reading and writing calm.

Density is moderate and card-led, after the Dribbble shot "Social Media App Design" by Sujon Hossain (structure and shape only, no content): a cool grey ground carries white rounded cards, selection is a filled pill, and the tab bar floats as a pill. A single blue carries action while lilac is reserved for anonymous identity. Identity is always visible as text (chip) and as a disc (avatar). The system is the incumbent blue, lilac and neutral palette, unchanged.

**Key Characteristics:**
- Serif (Literata) for post text, writing surfaces, the writing prompt, screen titles and display names; system sans for every control and label.
- Cards (radius 22 for posts, 16 for rows) on a grey ground, pill selection, a floating pill tab bar, hairline borders, no shadows.
- Round avatar discs: lilac with two overlapping circles for anonymous, blue-tinted with an initial for known.
- Line icons at one stroke weight (1.75).
- Light and dark schemes with a shared role vocabulary.

## Colors

A restrained blue-and-neutral palette with one lilac for anonymous identity. Values below are the light scheme; dark values are in the frontmatter under the dark- prefix.

### Primary
- **Campus Blue** (#1D4ED8; dark #93C5FD): actions, selected tab and underline, filled heart, links, focus ring, known chip fill.

### Secondary
- **Anonymous Lilac** (#6D28D9; dark #C4B5FD): the anonymous profile only: its chip fill and its avatar mark. Never decoration.

### Neutral
- **Page White** (#FFFFFF; dark #0B0F19): screen and field background.
- **Quiet Surface** (#F3F4F6; dark #161C2D): Notice background.
- **Ink** (#111827; dark #F3F4F6): primary text.
- **Muted Ink** (#4B5563; dark #A8B0C0): handles, times, counts, inactive tabs and icons.
- **Border Grey** (#6B7280; dark #8892A6): field and notice borders; hairline is the same hue at 25 percent alpha.
- **Danger Red** (#B91C1C) and **Success Green** (#166534): errors and confirmations in Notice borders, field errors and the danger button.

### Named Rules
**The One Blue Rule.** Blue means "you can act on this" or "this is selected". It is never used as decoration.
**The Lilac Means Anonymous Rule.** Lilac appears only where an anonymous profile is speaking.
**The Words Carry Identity Rule.** Identity is always also stated as a text chip (You, Student, Anonymous); colour is never the only signal.

## Typography

**Display Font:** Literata SemiBold (with serif fallback)
**Body Font:** Literata Regular for reading; platform system sans for UI
**Label/Mono Font:** system sans

**Character:** Literata gives posts the feel of a published note; the neutral system sans keeps buttons, labels and counts out of its way.

### Hierarchy
- **Display** (600, 32/38): welcome title, own and other profile names.
- **Reading Large** (400, 19/30): post body on the post detail screen and the writing field.
- **Reading** (400, 17/27): post body in the feed (clamped at 8 lines with a "Read more" label past 400 characters), the writing prompt, intro copy.
- **Title** (700, 24/30): screen titles in sans.
- **Heading** (600, 18/24): section headings.
- **Body** (400, 16/22): form text and secondary reading.
- **Label** (600, 14/20): author names, buttons, tabs, counts, field labels.
- **Small** (400, 13/18): handle and time, hints, chips (700).

Tab bar headers use Literata SemiBold; tab labels are 13px.

### Named Rules
**The Serif Is For Words People Wrote Rule.** Literata is for what a student writes or is prompted to write, plus screen titles and names; controls never use it.

## Layout

A single column. Screens pad 16px on the sides with 16px gaps; posts are full width up to 640px and centred on wider screens (tablet capture). Spacing scale 4, 8, 12, 16, 24, 32. Post anatomy top to bottom: person header (md avatar, name, handle and time, chip at the right), photos full width with no side padding, serif body, icon action row. Feed top to bottom: writing prompt row (56px), rail of followed people (lg avatars, 68px cells), three text tabs, then the posts. Every interactive target is at least 44px.

## Elevation & Depth

Flat. There are no shadows in the build. Depth is conveyed by white cards on the grey ground (ground #F3F4F6 and card #FFFFFF in light; ground #0B0F19 and card #161C2D in dark), a hairline border on each card and on the floating tab bar, a tinted pressed state on rows (primary-soft) and 0.6 to 0.85 opacity on press. The only motion is a spring scale on the heart (from 0.8, skipped when reduce motion is on).

### Named Rules
**The Card On Ground Rule.** Content sits on a white card over the grey ground, with a hairline border and no shadow; selection is a filled primary pill, never a box outline.

## Shapes

Round avatar discs and pill chips for identity; 10px corners (md) on buttons, fields and notices; 6px on action hit areas. Photos are square-cornered, full width, with aspect ratio clamped 0.8 to 1.6 (default 1.25) and a primary-soft placeholder. Multi photo posts page horizontally with 6px dots and an "n of N" count.

## Components

### Buttons
- **Shape:** 10px corners, 44px minimum height, 1px border.
- **Primary:** Campus Blue fill, white (dark: near-black) label in Label weight, 16px by 8px padding.
- **Secondary:** transparent with Border Grey outline and Ink label.
- **Danger / Link:** danger fill; link is text only in primary.
- **State:** 0.85 opacity pressed, 0.5 disabled or busy (spinner replaces label).

### Text tabs (SegmentedControl)
A pill-shaped control on a card: the selected segment is a filled primary pill with on-primary text, 700 weight; others are muted, 500 weight. Focus draws a 2px focus-coloured outline.

### Post
Person-led, a rounded white card with the photo carousel inset and rounded. The action row holds heart plus count, comment plus count, and a More dots icon pushed right; liked heart is filled in primary. More reveals a hairline-topped panel with the report explanation and a secondary Report button.

### Avatar
Discs at 28, 40, 56 and 80px. Known shows the initial in blue at 42 percent of the diameter, bold; anonymous shows the two overlapping circles at 1.8 stroke. Hidden from screen readers because text carries identity.

### Profile chip
Filled pill: Student and You in blue, Anonymous in lilac; 13px bold.

### Comment
Sm avatar, label name with chip, muted time, then heart count and a link button (Delete if mine, Report otherwise); hairline below.

### List row
Minimum 56px, optional icon at muted, title in body, detail in small muted, chevron; hairline below; primary-soft when pressed.

### Fields
Standard: 1px Border Grey outline, 10px corners, body type, 44px minimum, error border in danger. Writing variant: borderless apart from a hairline top, Reading Large serif, 180px minimum, hint right-aligned beneath.

### Notice
Quiet Surface fill, 1px border (grey, danger or success), 10px corners, 12px padding, optional Label title.

### Writing prompt (signature)
Top-of-feed row: acting avatar, "What is on your mind?" in Reading muted, image icon; a hairline below.

## Do's and Don'ts

### Do:
- **Do** open every post with a person: avatar, name, handle, time, identity chip.
- **Do** set anything a student writes in Literata and every control in the system sans.
- **Do** separate with hairlines and keep surfaces flat.
- **Do** keep 44px targets and state identity as words.
- **Do** keep icons to the one line style at 1.75 stroke.

### Don't:
- **Don't** wrap posts in outlined cards or lines of identical outlined buttons.
- **Don't** use lilac for anything but anonymous identity.
- **Don't** add shadows, gradients or decorative colour.
- **Don't** use an icon alone to carry a state without an accessible label.

## Open items (not yet shipped or verified)
- Posting-as two-disc switch in the composer (the signature identity mark is not yet used as a switch).
- Haptics on like.
- Empty-state marks.
- Light theme profile and settings screens not captured.
- Photos not verified with real images on web.

## Build notes
- The direction contract described text above the photo; the build places photos above the body text. The build wins and is recorded above.
- PRODUCT.md notes no brand colour or logo and an unconfirmed name; this palette is the incumbent, not a brand.

## Update 2026-10-15: monochrome, after the Dribbble shot

The app was moved to match "Social Media App Design" by Sujon Hossain as closely as the product allows. This section supersedes the palette, type and component notes above where they differ; `src/theme/tokens.ts` is authoritative.

- Palette: near-black ink (#0B0B12, white in dark) replaces blue for selection, action and the known-profile chip. Lilac (#6D28D9, #C4B5FD in dark) stays only for anonymous identity. Ground #F2F3F5, card #FFFFFF in light; ground #0B0B0F, card #17171C in dark.
- Type: system sans only, 700 for titles and names. Literata was removed.
- Shapes: rounded-square avatars (32% radius), separate pill tabs (selected is filled ink), dashed "+ Write a post" row, rounded cards, a circle back button, and an icon-only floating pill tab bar with a filled ink circle for the active tab and an outlined "+" that opens the composer.
