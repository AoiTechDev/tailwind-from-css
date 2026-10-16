---
"tailwind-from-css": minor
---

`group-*` and `peer-*` variants are found again with the next Tailwind release (the current insiders builds), which compiles them as `:is(:where(.group):hover .c)` instead of `.c:is(:where(.group):hover *)`. Both shapes are now the same selector. Stylesheets written in the new shape convert too: `:is(.a .b)` has the subject `.b` (before: the whole selector), with the same classes as `.b:is(.a *)`.
