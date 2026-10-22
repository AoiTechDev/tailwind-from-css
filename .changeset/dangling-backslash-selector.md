---
"tailwind-from-css": patch
---

A selector with a backslash that escapes nothing (`\` before a tab or a line break, outside a string) is kept as written instead of being rewritten into a different selector. Before, `.a\` followed by a newline and `+ .b` became `.a\ + .b`, where `\ ` reads as an escaped space.
