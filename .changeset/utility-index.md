---
"tailwind-from-css": patch
---

Add the engine's view of Tailwind: the effective declarations of a set of classes in one context (theme variables, Tailwind's internal `--tw-*` variables and their `@property` defaults resolved, then normalized), and the index that maps normalized CSS back to utilities and variants for the installed Tailwind version and theme, `prefix()` included. Not part of the public API yet: the converter that uses it comes in a later release.
