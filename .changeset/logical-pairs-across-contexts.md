---
"tailwind-from-css": minor
---

`nearest`: physical pairs that change between contexts now collapse with the `logical-properties` relaxation (`py-4 md:py-6` instead of `pt-4 pb-4 md:pt-6 md:pb-6`). A context that sets one side alone, or a physical class covering the side, keeps the whole family physical, so the cascade check stays sound.
