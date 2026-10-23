---
"tailwind-from-css": patch
---

Fixes found converting real captures (github.com, linear.app, stripe.com) through a capture tool:

- `pruneStyles` drops the sizes of a box that isn't rendered (`display: none` or `contents`, under a hidden parent, or with sizes that aren't px): no more `size-auto min-h-0 min-w-0` on hidden menus. A `0px` minimum on an absolutely positioned box matches an `auto` one. (#18)
- `pruneStyles` drops the end inset of a relatively positioned box when it's the start one negated (`bottom: -10px` next to `top: 10px`). (#19)
- A class without a modifier wins over an equal one with a modifier: `rgba(0, 0, 0, 0)` is `bg-transparent` next to other declarations too, not `bg-black/0`. (#20)
- Capture guide: the state settle wait no longer hangs on pages with infinite animations, and a section on converting in a serverless function. (#21)
