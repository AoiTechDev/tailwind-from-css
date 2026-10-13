---
"tailwind-from-css": minor
---

`pruneStyles` handles more of what browsers resolve, and a new guide, `docs/guides/capture-tools.md`, shows how to capture computed styles for it: the baseline, states, pseudo-elements, breakpoints, and a minimal Playwright script.

Fixes:

- A px `line-height` that equals the parent's or the baseline's is kept when the element's font size differs. Computed line-heights are px even when the author wrote a number, so `line-height: 24px` under a parent with `line-height: 1.5` was dropped, and the element showed 21px at a 14px font size.
- `drop` no longer hides values from the read-backs: dropping `width` and `height` used to stop an origin at the center of the box from reading as `50% 50%`.

Dropped now, because they show the same as their reference:

- an origin of `50% 50%` left unresolved on a box that isn't rendered
- `0px` insets on both sides of a relatively positioned box (they're `auto`)
- `min-width`/`min-height: 0px` on a `display: none` box (they're `auto`)
- `overflow-block`/`overflow-inline` equal to `overflow-y`/`overflow-x`
- a shorthand Chromium lists next to its own longhands, like a hovered `text-decoration: underline`, when the longhands repeat it once their resolved colors read as `currentcolor`

The golden corpus of captured pages grew to 5 pages at 375, 768 and 1280px, with hover and focus states and `::before`: 73 elements, a median of 11 classes each, all exact.
