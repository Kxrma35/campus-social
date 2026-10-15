---
target: feed
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/karma/learning/projects/campus-social/apps/mobile/src/app/(app)/(tabs)/index.tsx"
target_fingerprint: "sha256:ad7372bc40c9808054ac64eeaced92965f72550ef8fc3278d0f999f8dbc1fa47"
target_path: /home/karma/learning/projects/campus-social/apps/mobile/src/app/(app)/(tabs)/index.tsx
timestamp: 2026-10-15T09-52-05Z
slug: src-app-app-tabs-index-tsx
---
# Critique: Feed screen

Method: dual-agent (design review sub-agent, detector and browser evidence sub-agent)

Design health score: 24/40 (Acceptable). Heuristics: 1=3, 2=3, 3=2, 4=2, 5=3, 6=3, 7=2, 8=2, 9=3, 10=1.

Design specificity: Generic. Only the identity chips, "this hour" timestamps and the viewing-as switcher are product specific. Nothing expresses verified same-campus peers or accountable anonymity.

Deterministic scan: detector 0 findings on the feed file and src/ui (reads HTML/CSS, not meaningful for React Native source); in-page overlay on the rendered preview 0 findings. Measured: all text contrast >= 7.78:1, all targets 44 px high, no horizontal overflow.

## Priority issues
- [P1] Action row is three identical outlined buttons per card; Report is as loud as Like. Fix: quiet Like/Comments, put Report behind an explained More action. Commands: quieter, layout.
- [P1] Sort tabs are plain buttons in a tablist wrapper, no tab role and no selected state for assistive tech. Fix: real tab/segmented control with selected state and position. Command: adapt.
- [P2] No campus identity; anonymous posts get no extra care; no honest line on what anonymity protects. Fix: students-only line, calmer anonymous surface, compact composer row. Commands: shape, layout.
- [P2] Photos have no loading or failed state (web preview cannot send the auth header, so photos are blank there; native would show the same gap on failure). Fix: aspect-ratio placeholder, visible description fallback, retry. Command: harden.
- [P2] Default focus outline is near invisible on dark; Like accessible name "Remove like, 2 likes" does not contain visible text "Liked (2)". Fix: 2 px accent focus ring, label-in-name. Commands: audit, polish.

## Persona red flags
Anxious first-year: cannot tell which identity a reply uses; Report one tap from Like. Sam: tabs announce as buttons, summary label swallows body, blank photo. Casey: header scrolls away, 8 pt gaps, no undo. Jordan: unexplained tabs, "this hour" vs "17 minutes ago".

## Minor
No edit/delete entry on own post; bottom bar has no icons or unread cue; no end-of-feed message; Like label width changes; timestamp on its own row.

## Questions
Why does an anonymous post get less care than a lost umbrella? Should Report be a deliberate explained act in a menu? Should the composer be the top of the feed?
