# tailwind-from-css

## 0.9.0

### Minor Changes

- 900e4fa: With the default `tailwind.base` (the working directory), `@import "tailwindcss"` that the working directory can't resolve now loads the `tailwindcss` this package imports, so `createConverter()` works in bundled serverless functions without options. An explicit `tailwind.base` never falls back.
- b744bb4: New thrown code `TFC905`: `convertStyles` and `convertCss` given input of the wrong shape (for example the declarations themselves instead of `{ declarations }`) throw `TfcError` with `TFC905` and a message naming the entry and field, instead of a raw `TypeError`.
- 5660a82: `nearest`: physical pairs that change between contexts now collapse with the `logical-properties` relaxation (`py-4 md:py-6` instead of `pt-4 pb-4 md:pt-6 md:pb-6`). A context that sets one side alone, or a physical class covering the side, keeps the whole family physical, so the cascade check stays sound.
- 4af2a63: Expand `overscroll-behavior` into its `-x` and `-y` longhands (N01), so equal longhands, as computed styles list them, convert to one class (`overscroll-none`) instead of two.

### Patch Changes

- 0a5196a: Capture guide: the baseline of an element under a `display: contents` parent nests copies of the ancestors up to the first one with a box; properties an endless animation drives are dropped; what the browser itself changes in a forced state (Chromium's focus ring) is dropped by forcing the same state on the blank element; insets of an absolutely or fixed positioned box that change between widths are dropped at every width.
- 34b85e1: Add a top-level `types` field, so TypeScript projects using `"moduleResolution": "node"` find the type declarations.

## 0.8.0

### Minor Changes

- 898b09b: Convert `data:` URLs with spaces: a space in a data URL's body (after the first comma) is written as `%20` in the class, which is the same data, instead of leaving the declaration unconverted (`TFC204`). Inline SVG backgrounds and masks now convert. Spaces in the media type, trailing spaces and spaces in other URLs are still `TFC204`.

## 0.7.1

### Patch Changes

- 36a8e7f: Capture guide: used sizes are read per element with `auto` (set `width`/`height`/margins to `auto` on that element, compare, restore) instead of dropping any size that changes between widths. Authored responsive sizes like `size-6 md:size-7` now survive, and the Playwright script matches.

## 0.7.0

### Minor Changes

- 0f16d68: `pruneStyles` takes the element's other captured `states`. Given them, it drops longhands that show nothing (a line's color where the line isn't drawn, insets of a static box, background size, position and repeat with no background image, transition details where no transition runs) unless a state shows them with the same value (#31–#34). The capture guide passes them, and its baseline copies `width`, `height`, `hidden`, `dir` and SVG presentation attributes onto the blank element (#35).

## 0.6.3

### Patch Changes

- b6de197: Fixes found converting real captures (github.com, linear.app, stripe.com) through a capture tool:
  
  - `pruneStyles` drops the sizes of a box that isn't rendered (`display: none` or `contents`, under a hidden parent, or with sizes that aren't px): no more `size-auto min-h-0 min-w-0` on hidden menus. A `0px` minimum on an absolutely positioned box matches an `auto` one. (#18)
  - `pruneStyles` drops the end inset of a relatively positioned box when it's the start one negated (`bottom: -10px` next to `top: 10px`). (#19)
  - A class without a modifier wins over an equal one with a modifier: `rgba(0, 0, 0, 0)` is `bg-transparent` next to other declarations too, not `bg-black/0`. (#20)
  - Capture guide: the state settle wait no longer hangs on pages with infinite animations, and a section on converting in a serverless function. (#21)

## 0.6.2

### Patch Changes

- c934d9b: Don't pick an important class that also writes a vendor-prefixed property the block sets without `!important`. `user-select: none !important; -webkit-user-select: none` now converts exactly to `[user-select:none]! [-webkit-user-select:none]`; before, `select-none!` overrode the prefixed declaration, which ended up unconverted with TFC501 and TFC502.

## 0.6.1

### Patch Changes

- d6fba91: A selector with a backslash that escapes nothing (`\` before a tab or a line break, outside a string) is kept as written instead of being rewritten into a different selector. Before, `.a\` followed by a newline and `+ .b` became `.a\ + .b`, where `\ ` reads as an escaped space.

## 0.6.0

### Minor Changes

- 141927c: `group-*` and `peer-*` variants are found again with the next Tailwind release (the current insiders builds), which compiles them as `:is(:where(.group):hover .c)` instead of `.c:is(:where(.group):hover *)`. Both shapes are now the same selector. Stylesheets written in the new shape convert too: `:is(.a .b)` has the subject `.b` (before: the whole selector), with the same classes as `.b:is(.a *)`.

## 0.5.0

### Minor Changes

- 16bbe19: The `tailwind-from-css` command converts stylesheets. It reads a file or stdin and prints one `subject { classes }` line per rule, then the CSS that stays in a stylesheet; unconverted declarations and diagnostics go to stderr with their line and column. Flags: `--mode`, `--relax`, `--theme`, `--root-font-size`, `--format text|json` (JSON is the `convertCss` result), `--fail-on-unconverted`, `--print-config`, `--version` and `--help`. Exit codes: 0 ok, 1 Tailwind or the theme failed to load, 2 usage error, 3 unconverted with `--fail-on-unconverted`.

### Patch Changes

- da9d1ce: `docs/errors.md` explains every diagnostic and error code (`TFC101`–`TFC502`, `TFC901`–`TFC904`) with an example and what to do; `TfcError.docsUrl` and the CLI link to it. The README and error-reference examples now run in the test suite against the built package, the published type declarations are checked for TSDoc on every export, and the packed tarball is tested converting a stylesheet through the API and the CLI. `pruneStyles` documents that it never throws.

## 0.4.0

### Minor Changes

- fbd28d2: Nearest mode on captured pages:
  
  - Greys now snap to the `neutral-*` palette on Tailwind 4.3, which writes it with a missing hue (`oklch(55.6% 0 none)`). A missing color channel counts as 0, the way the color renders; before, `#767676` became `text-stone-500` instead of `text-neutral-500`.
  - An arbitrary font size keeps the exact line-height as its modifier instead of taking a near `leading-*` class: `font-size: 44px; line-height: 50.6px` gives `text-[44px]/[50.6px]` in nearest mode too (was `text-[44px] leading-12.5`).
  - The tolerance defaults (`colorDeltaE` 0.02, `lengthPx` 2, `lengthRatio` 0.1, `breakpointPx` 16) were measured on real captured pages and stay as they are.
- 6b72ca6: Nearest mode drops a relaxed class under a width condition when a wider layer or the base already shows the same value there: `text-2xl md:text-2xl xl:text-3xl` becomes `text-2xl xl:text-3xl`, and `md:mt-4.5 xl:mt-4.5` becomes `md:mt-4.5`. What every context shows is unchanged and still verified. The dropped declarations are reported on the class that shows their value, with their relaxations. Exact mode is unaffected.

### Patch Changes

- 7b20ca4: A full README: what the package does and why its output is verified, installation, quick start for single elements, stylesheets and reusable converters, `exact` and `nearest` modes with every relaxation, custom themes, converting captured computed styles with `pruneStyles`, the result shape, the API and options, every diagnostic and error code, how conversion works, requirements and limitations, and the versioning policy.
- 7cb2e90: Two fixes found by the property tests:
  
  - A converter gives the same result whatever it converted before. Verification cascaded classes it had compiled in different calls by sort keys that only compare within one call, so a class cached from an earlier conversion could be ordered wrongly and replaced: `content: ""` on `md:` + `:first-child` next to `content: none` came out as `md:first:[content:'']` after an earlier conversion and `md:first:content-['']` on a fresh converter.
  - Selectors keep the combinator after a hex escape's terminating space (`.\31  .b` no longer becomes `.\31 .b`, one compound), and whitespace inside quoted attribute values is kept (`[title="a  b"]`).

## 0.3.0

### Minor Changes

- d2d704e: `pruneStyles` handles more of what browsers resolve, and a new guide, `docs/guides/capture-tools.md`, shows how to capture computed styles for it: the baseline, states, pseudo-elements, breakpoints, and a minimal Playwright script.
  
  Fixes:
  
  - A px `line-height` that equals the parent's or the baseline's is kept when the element's font size differs. Computed line-heights are px even when the author wrote a number, so `line-height: 24px` under a parent with `line-height: 1.5` was dropped, and the element showed 21px at a 14px font size.
  - `drop` no longer hides values from the read-backs: dropping `width` and `height` used to stop an origin at the center of the box from reading as `50% 50%`.
  
  Dropped now, because they show the same as their reference:
  
  - an origin of `50% 50%` left unresolved on a box that isn't rendered
  - `0px` insets on both sides of a relatively positioned box (they're `auto`)
  - `min-width`/`min-height: 0px` on a `display: none` box (they're `auto`)
  - `overflow-block`/`overflow-inline` equal to `overflow-y`/`overflow-x`
  - a shorthand Chromium lists next to its own longhands, like a hovered `text-decoration: underline`, when the longhands repeat it once their resolved colors read as `currentcolor`
  
  The golden corpus of captured pages grew to 5 pages at 375, 768 and 1280px, with hover and focus states and `::before`: 73 elements, a median of 11 classes each, all exact.

## 0.2.0

### Minor Changes

- 29aab0d: Add `pruneStyles`, which reduces a computed style (`getComputedStyle`) to the declarations that need classes. Pass the parent's computed style and a baseline: a blank element of the same tag, rendered under Tailwind's Preflight inside an element that carries the parent's inherited values. A property is dropped when it equals the baseline's value; an inherited property the baseline doesn't list, when it equals the parent's; any other property, when it equals its initial value. Before comparing, values the browser resolved are read back: a color that follows the text color counts as `currentcolor`, an origin at the center of the box as `50% 50%`, and a list of equal transition or background items as one item. Logical properties that repeat their physical twin, `none` border, outline and column-rule styles, shorthands repeated by their own longhands, and custom properties are dropped too. `keep` and `drop` override any of it.
  
  ```js
  import { convertStyles, pruneStyles } from 'tailwind-from-css'
  
  const declarations = pruneStyles(styles, { parent, baseline })
  const hover = pruneStyles(hoverStyles, { baseline: styles })
  const { className } = await convertStyles([
    { declarations },
    { selector: '&:hover', declarations: hover },
  ])
  ```
  
  On a captured Pico CSS page, elements went from about 600 computed properties to a median of 9 classes, all exact.

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
