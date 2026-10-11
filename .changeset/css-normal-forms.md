---
"tailwind-from-css": patch
---

Add the CSS normal forms that conversion will be checked against: shorthand expansion, lengths in px, `calc()` folding, times and angles, colors in every syntax, shadows, font families and weights, strings, media/container/supports conditions and selectors, plus reading declarations from strings, records and arrays. Adds the runtime dependencies `postcss`, `postcss-value-parser`, `postcss-selector-parser` and `culori`. Not part of the public API yet: the converter that uses it comes in a later release.
