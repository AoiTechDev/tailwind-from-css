---
"tailwind-from-css": minor
---

Nearest mode on captured pages:

- Greys now snap to the `neutral-*` palette on Tailwind 4.3, which writes it with a missing hue (`oklch(55.6% 0 none)`). A missing color channel counts as 0, the way the color renders; before, `#767676` became `text-stone-500` instead of `text-neutral-500`.
- An arbitrary font size keeps the exact line-height as its modifier instead of taking a near `leading-*` class: `font-size: 44px; line-height: 50.6px` gives `text-[44px]/[50.6px]` in nearest mode too (was `text-[44px] leading-12.5`).
- The tolerance defaults (`colorDeltaE` 0.02, `lengthPx` 2, `lengthRatio` 0.1, `breakpointPx` 16) were measured on real captured pages and stay as they are.
