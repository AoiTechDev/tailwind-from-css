---
"tailwind-from-css": minor
---

With the default `tailwind.base` (the working directory), `@import "tailwindcss"` that the working directory can't resolve now loads the `tailwindcss` this package imports, so `createConverter()` works in bundled serverless functions without options. An explicit `tailwind.base` never falls back.
