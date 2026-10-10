---
"tailwind-from-css": patch
---

Load Tailwind's design system from your own `tailwindcss` (4.2.0 or later), including `@import` of files and packages, `@plugin` (ESM and CommonJS), `@config`, `@custom-variant`, `@utility` and `prefix()`. A missing or unsupported `tailwindcss` throws `TFC901`/`TFC902`, and entry CSS that fails to load throws `TFC903` with the cause. Not part of the public API yet: the converter that uses it comes in a later release.
