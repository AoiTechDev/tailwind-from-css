---
"tailwind-from-css": patch
---

Add the converter. `createConverter(options)` loads your Tailwind setup and builds the index once; `converter.convertStyles(input)` then converts the styles of one element (one or more contexts: states, pseudo-elements, media, container and supports queries) synchronously into a class list in Tailwind's order. Every class is verified by compiling it with your Tailwind, and the result maps each class to the declarations it came from and lists what couldn't be converted, with diagnostic codes. `converter.toCss(classes)` prints the CSS Tailwind generates for classes, and `convertStyles(input, options)` is a one-shot helper that reuses converters for equal options. Options are validated (`TFC904`). Also prefers `tracking-tight` over the equal `-tracking-wide`, and makes compiling after many variants, and repeated conversions, much faster. `convertCss` for whole stylesheets comes in a later release.
