---
"tailwind-from-css": minor
---

Add the `nearest` mode and the relaxations behind it. `mode: 'nearest'` turns on all eight; `relax: ['color-nearest']` turns on one, and `relax: ['!hover-media']` turns one off. The default mode is still `exact`, and its output doesn't change.

- `hover-media`: `:hover` becomes `hover:` instead of `[&:hover]:` (`hover:` only applies on devices that can hover).
- `logical-properties`: left/right and top/bottom pairs collapse to `mx-auto`, `px-4`, `py-2`, `inset-x-0` (this assumes left-to-right, horizontal text). A single side stays `ml-2`, and a side that another rule of the element also sets stays physical.
- `color-nearest`: a color within `tolerance.colorDeltaE` (ΔE OK, default 0.02) of a theme color becomes that color, keeping its alpha (`bg-red-500/50`).
- `length-nearest`: a px length within `tolerance.lengthPx` (2) **and** `tolerance.lengthRatio` (0.1) of a theme value or a spacing step of 0.5 snaps to it (`padding: 13.3px` → `p-3.5`).
- `breakpoint-nearest`: a width condition within `tolerance.breakpointPx` (16) of a breakpoint snaps to it (`max-width: 767px` → `max-md:`, `min-width: 770px` → `md:`, container queries too).
- `font-weight-nearest`: the nearest theme weight (`590` → `font-semibold`).
- `text-line-height`: `text-sm` for a font size alone, accepting its line-height, when no rule of the element sets `line-height`.
- `pill-radius`: a radius of 1000px or more becomes `rounded-full`.

Relaxations only apply where no exact class exists. Every relaxed class is still verified against the value it actually sets. Each relaxed class gets `relaxation` (name, detail, delta) and a `TFC203` diagnostic for each relaxation applied, and `exact` is `false`.
