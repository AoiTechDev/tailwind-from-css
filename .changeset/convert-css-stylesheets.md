---
"tailwind-from-css": patch
---

Convert whole stylesheets: `convertCss` on a converter and the one-shot `convertCss(css, options)` (it shares the four cached converters with `convertStyles`). Rules are grouped by the element they style (`.btn`, `.btn:hover` and `@media … { .btn }` give one class list for `.btn`), with `@layer` flattened, `@media`/`@supports`/`@container`/`@starting-style` as variants, `&` nesting resolved and selector lists split. Every source carries its line and column. At-rules such as `@keyframes` or `@font-face` and rules for `:root`, `html` or `*` come back as `passthroughCss`. Syntax errors are recovered from the way browsers do, and never thrown. Cascade order between overlapping contexts isn't checked yet.
