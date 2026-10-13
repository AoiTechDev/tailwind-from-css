# tailwind-from-css

## 0.1.0

### Minor Changes

- 8bfcef2: Shorter classes for values with `var()`, and type hints only where they describe the value. The output stays exact; only the spelling of some classes changes.
  
  - A shorthand kept whole gets its utility instead of an arbitrary property: `padding: var(--p)` → `p-(--p)` (was `[padding:var(--p)]`), `margin: var(--y) 0` → `m-[var(--y)_0]`, `border-radius: var(--r)` → `rounded-(--r)`, `border-color: var(--c)` → `border-(--c)`, `padding-block: var(--y)` → `py-(--y)`.
  - Utilities that no listed class shows are used too: `background-size` → `bg-size-[auto_1rem]`, `background-position` → `bg-position-[center_left]`, `filter` → `filter-[brightness(0)]`, `backdrop-filter` → `backdrop-filter-(--x)`.
  - A negated variable uses the negative utility: `margin-left: calc(var(--x) * -1)` → `-ml-(--x)`.
  - A variable with a fallback keeps the variable form: `box-shadow: var(--s, none)` → `shadow-(--s,none)`.
  - A variable line height is a variable modifier: `text-base/(--lh)` (was `text-base/[var(--lh)]`).
  - An arbitrary or variable size takes the line height as a modifier: `font-size: 18.2px; line-height: 28px` → `text-[18.2px]/7` (was `text-[18.2px] leading-7`).
  - A type hint is written only for a value with `var()`, whose type Tailwind can't see. `font-weight: bolder` is now `[font-weight:bolder]` instead of the misleading `font-[color:bolder]`, and `font-size: inherit` is `[font-size:inherit]` instead of `text-[length:inherit]`.
- ef74f8c: Add the `nearest` mode and the relaxations behind it. `mode: 'nearest'` turns on all eight; `relax: ['color-nearest']` turns on one, and `relax: ['!hover-media']` turns one off. The default mode is still `exact`, and its output doesn't change.
  
  - `hover-media`: `:hover` becomes `hover:` instead of `[&:hover]:` (`hover:` only applies on devices that can hover).
  - `logical-properties`: left/right and top/bottom pairs collapse to `mx-auto`, `px-4`, `py-2`, `inset-x-0` (this assumes left-to-right, horizontal text). A single side stays `ml-2`, and a side that another rule of the element also sets stays physical.
  - `color-nearest`: a color within `tolerance.colorDeltaE` (ΔE OK, default 0.02) of a theme color becomes that color, keeping its alpha (`bg-red-500/50`).
  - `length-nearest`: a px length within `tolerance.lengthPx` (2) **and** `tolerance.lengthRatio` (0.1) of a theme value or a spacing step of 0.5 snaps to it (`padding: 13.3px` → `p-3.5`).
  - `breakpoint-nearest`: a width condition within `tolerance.breakpointPx` (16) of a breakpoint snaps to it (`max-width: 767px` → `max-md:`, `min-width: 770px` → `md:`, container queries too).
  - `font-weight-nearest`: the nearest theme weight (`590` → `font-semibold`).
  - `text-line-height`: `text-sm` for a font size alone, accepting its line-height, when no rule of the element sets `line-height`.
  - `pill-radius`: a radius of 1000px or more becomes `rounded-full`.
  
  Relaxations only apply where no exact class exists. Every relaxed class is still verified against the value it actually sets. Each relaxed class gets `relaxation` (name, detail, delta) and a `TFC203` diagnostic for each relaxation applied, and `exact` is `false`.

## 0.0.4

### Patch Changes

- 88c7e9a: Check the cascade between contexts that can apply together. Tailwind orders classes by variant, not by your stylesheet, so a later `@media (min-width: 1000px)` rule used to lose to an earlier `md:` one, and a `:focus` rule written after `:hover` lost to `[&:hover]:`. Where the source and Tailwind disagree, a class for the intersection is added (`min-[1000px]:md:p-6`, `[&:hover]:focus:bg-…`) with `TFC401`. A declaration that a later or stronger rule always overrides, such as an `@starting-style` or `@container` rule placed before the base rule, is dropped with `TFC106`. When a conflict can't be fixed (more than four conflicting contexts for one property, or no class for the intersection), the declaration Tailwind would wrongly let win is left unconverted with `TFC402`. The published JavaScript is now minified, so the package is about 145 kB unpacked instead of 244 kB.
- f963aaa: Fix shorthands that contain `var()`. Such a shorthand stays whole (`[padding:var(--p)_0]`), but it still sets every longhand it covers, and the converter didn't treat it that way. `padding: 0` followed by `padding: calc(var(--x) * 0.5) 0` gave `[padding:…] pt-0 pr-0 pb-0`, so the element got `padding-top: 0`. Now an earlier declaration a later shorthand covers is dropped with `TFC106`, and verification and the cascade check see the overlap. Tailwind sorts `[border:…]`, `[background:…]`, `[font:…]`, `[text-decoration:…]`, `[transition:…]`, `[list-style:…]` and `[grid-area:…]` after every longhand utility, so a longhand written after one of them (`border: var(--a); border-top-color: red`) can't win in Tailwind. That longhand is now left unconverted with `TFC402` instead of getting a class that never applies. A rule whose last compound starts with `:is()` or `:where()` naming elements now keeps it in the subject: `:where(.btn):hover` is the subject `:where(.btn)` with `&:hover`, not `*` passed through as CSS.

## 0.0.3

### Patch Changes

- b75df99: Convert whole stylesheets: `convertCss` on a converter and the one-shot `convertCss(css, options)` (it shares the four cached converters with `convertStyles`). Rules are grouped by the element they style (`.btn`, `.btn:hover` and `@media … { .btn }` give one class list for `.btn`), with `@layer` flattened, `@media`/`@supports`/`@container`/`@starting-style` as variants, `&` nesting resolved and selector lists split. Every source carries its line and column. At-rules such as `@keyframes` or `@font-face` and rules for `:root`, `html` or `*` come back as `passthroughCss`. Syntax errors are recovered from the way browsers do, and never thrown. Cascade order between overlapping contexts isn't checked yet.
- 967f344: Release workflow: move to `changesets/action` v2, which reads published packages from the Changesets CLI v3 output file, so releases get their git tag and GitHub Release again. No change to the package.

## 0.0.2

### Patch Changes

- d9f1abd: Internal: commit a test fixture that the ignore rules had left out, so the test suite passes on a fresh checkout. No change to the package.

## 0.0.1

### Patch Changes

- b64fe53: Spell the author's name with its Polish character (Paweł Bornikowski) in the license and package metadata.
- 17e791c: Add the converter. `createConverter(options)` loads your Tailwind setup and builds the index once; `converter.convertStyles(input)` then converts the styles of one element (one or more contexts: states, pseudo-elements, media, container and supports queries) synchronously into a class list in Tailwind's order. Every class is verified by compiling it with your Tailwind, and the result maps each class to the declarations it came from and lists what couldn't be converted, with diagnostic codes. `converter.toCss(classes)` prints the CSS Tailwind generates for classes, and `convertStyles(input, options)` is a one-shot helper that reuses converters for equal options. Options are validated (`TFC904`). Also prefers `tracking-tight` over the equal `-tracking-wide`, and makes compiling after many variants, and repeated conversions, much faster. `convertCss` for whole stylesheets comes in a later release.
- 7ce6a9c: Add the CSS normal forms that conversion will be checked against: shorthand expansion, lengths in px, `calc()` folding, times and angles, colors in every syntax, shadows, font families and weights, strings, media/container/supports conditions and selectors, plus reading declarations from strings, records and arrays. Adds the runtime dependencies `postcss`, `postcss-value-parser`, `postcss-selector-parser` and `culori`. Not part of the public API yet: the converter that uses it comes in a later release.
- 11c537f: Add exact matching: the declarations of one block become the classes whose generated CSS is exactly the same. It finds whole utilities (`truncate`, `size-4`), covers the rest with physical utilities (`margin: 0 auto` → `mt-0 mr-auto mb-0 ml-auto`, never the logical `mx-auto`), compiles bare values the class list doesn't enumerate (`p-3.25`, `w-1/3`, `z-37`, `opacity-37`), uses modifiers (`text-sm/6`, `bg-black/50`), and falls back to variables (`text-(length:--size)`), arbitrary values (`text-[#ef4444]`) and arbitrary properties, all checked by compiling them with your Tailwind. Important declarations get `!`, redundant vendor-prefixed copies are dropped (`TFC105`), and values that can't be written as a class are reported (`TFC204`). Also fixes two normalization edge cases on malformed input (`/ *` in a custom property, an unclosed function in a shadow). Not part of the public API yet: the converter that uses it comes in a later release.
- d718d54: First preview release. Ships the public TypeScript types and `TfcError` (with `code`, `cause` and `docsUrl`), plus a `tailwind-from-css` CLI that only supports `--version` and `--help` so far. The converter itself arrives in later releases.
- e1d5546: Load Tailwind's design system from your own `tailwindcss` (4.2.0 or later), including `@import` of files and packages, `@plugin` (ESM and CommonJS), `@config`, `@custom-variant`, `@utility` and `prefix()`. A missing or unsupported `tailwindcss` throws `TFC901`/`TFC902`, and entry CSS that fails to load throws `TFC903` with the cause. Not part of the public API yet: the converter that uses it comes in a later release.
- 2716ea5: Add the engine's view of Tailwind: the effective declarations of a set of classes in one context (theme variables, Tailwind's internal `--tw-*` variables and their `@property` defaults resolved, then normalized), and the index that maps normalized CSS back to utilities and variants for the installed Tailwind version and theme, `prefix()` included. Not part of the public API yet: the converter that uses it comes in a later release.
- 24502c9: Add variant chains and verification. A block's context (state selectors, pseudo-elements, media, container, supports and starting-style conditions) becomes the variants of your Tailwind: named ones (`md:`, `focus:`, `hover:` only when the input has its `(hover: hover)` media query, custom variants), functional ones with arbitrary values (`min-[700px]:`, `nth-[3n+1]:`, `data-[state=open]:`), or arbitrary variants (`[&:hover]:`, `[@media(max-width:767px)]:`, reported as `TFC301`/`TFC302`); every chain is compiled and checked, and a context that can't be a class is reported (`TFC303`). Verification compiles the whole class list and compares it with the input per context, including Tailwind's internal variables that one context's classes set for another (so `translate-x-1` with `[&:hover]:translate-y-1` is caught and repaired). Wrong classes fall back to arbitrary properties (`TFC501`) or become unconverted (`TFC502`). Adds the `TFC106` diagnostic code for a declaration overridden by a later one of the same block. Not part of the public API yet: the converter that uses it comes in a later release.
