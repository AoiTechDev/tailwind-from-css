---
'tailwind-from-css': patch
---

Capture guide: used sizes are read per element with `auto` (set `width`/`height`/margins to `auto` on that element, compare, restore) instead of dropping any size that changes between widths. Authored responsive sizes like `size-6 md:size-7` now survive, and the Playwright script matches.
