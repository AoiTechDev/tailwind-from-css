---
"tailwind-from-css": minor
---

Convert `data:` URLs with spaces: a space in a data URL's body (after the first comma) is written as `%20` in the class, which is the same data, instead of leaving the declaration unconverted (`TFC204`). Inline SVG backgrounds and masks now convert. Spaces in the media type, trailing spaces and spaces in other URLs are still `TFC204`.
