# tailwind-from-css

**Convert CSS and captured computed styles into Tailwind CSS v4 classes, verified against your own Tailwind setup.**

[![npm version](https://img.shields.io/npm/v/tailwind-from-css.svg)](https://www.npmjs.com/package/tailwind-from-css)
[![CI](https://github.com/AoiTechDev/tailwind-from-css/actions/workflows/ci.yml/badge.svg)](https://github.com/AoiTechDev/tailwind-from-css/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/tailwind-from-css.svg)](LICENSE)
[![node](https://img.shields.io/node/v/tailwind-from-css.svg)](package.json)
[![tailwindcss](https://img.shields.io/badge/tailwindcss-%5E4.2.0-38bdf8.svg)](https://tailwindcss.com)

```css
.btn {
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  font-size: 14px;
  line-height: 20px;
  color: white;
}
.btn:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
@media (min-width: 768px) { .btn { padding: 10px 20px; } }
```

```text
inline-flex items-center rounded-md text-sm/5 text-white focus-visible:outline-2
focus-visible:outline-offset-2 focus-visible:outline-[#4f46e5] md:pt-2.5 md:pr-5 md:pb-2.5 md:pl-5
```

Most CSS-to-Tailwind converters guess from a lookup table. `tailwind-from-css` doesn't guess. It reads the utilities, variants and theme straight from the Tailwind version installed in your project, and before it returns a class it compiles that class with your Tailwind and checks that the generated CSS matches your input. If no class matches, you get an arbitrary value, or the declaration comes back as unconverted with a reason. A wrong class never comes out silently.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Exact and nearest](#exact-and-nearest)
- [Using your own theme](#using-your-own-theme)
- [Converting styles captured from a live page](#converting-styles-captured-from-a-live-page)
- [Reading the result](#reading-the-result)
- [Command line](#command-line)
- [API](#api)
- [Options](#options)
- [Diagnostics](#diagnostics)
- [How it works](#how-it-works)
- [Requirements and limitations](#requirements-and-limitations)
- [Versioning](#versioning)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Verified output.** Every class is compiled back with Tailwind and compared with your input. There's no option to turn this off.
- **Uses your Tailwind.** Custom `@theme` values, `prefix()`, `@custom-variant`, `@utility` and `@plugin` all work, because the mapping comes from Tailwind's own design system, not from a hand-written table. A new 4.x release is picked up as soon as you install it.
- **Whole stylesheets or single elements.** Convert a stylesheet with `convertCss`, or one element's declarations with `convertStyles`.
- **States, pseudo-elements and at-rules.** `:hover`, `:focus-visible`, `::before`, `.dark &`, `[data-state=open]`, `@media`, `@container`, `@supports` and `@starting-style` become variants.
- **Respects the cascade.** Tailwind orders classes by variant, not by your stylesheet. Where the two disagree, the converter adds a class that restores your order, or tells you it can't.
- **Explainable.** Each class lists the declarations it came from. Everything left out says why, with a stable diagnostic code.
- **Exact by default, nearest on request.** `nearest` mode snaps values to your theme within tolerances you control, and reports each snap with its distance.
- **Built for captured styles.** `pruneStyles` reduces a `getComputedStyle` result (about 480 properties) to the handful that need classes.
- **Deterministic.** The same input, options and Tailwind version always give the same output. No AI, no heuristics.
- **Fully typed.** Written in TypeScript and ships its own type definitions.

## Installation

```bash
npm install tailwind-from-css tailwindcss
```

```bash
pnpm add tailwind-from-css tailwindcss
```

`tailwindcss` (`^4.2.0`) is a peer dependency: the converter uses the version your project has installed. The package is ESM-only and runs on Node.js 22.12 or later.

## Quick start

### One element

`convertStyles` takes the declarations of one element, in any of its states and contexts, and returns one class list.

<!-- test -->
```js
import { convertStyles } from 'tailwind-from-css'

const result = await convertStyles([
  { declarations: { display: 'flex', padding: 16, color: '#ef4444' } },
  { selector: '&:hover', declarations: 'color: #dc2626' },
  { conditions: ['@media (min-width: 768px)'], declarations: 'padding: 24px' },
])

result.className
// 'flex p-4 text-[#ef4444] md:p-6 [&:hover]:text-[#dc2626]'
```

Declarations can be a CSS string, an object (camelCase or kebab-case keys, numbers get `px` the way React adds them), or an array of `{ property, value, important }`.

`#ef4444` stays an arbitrary value because Tailwind v4's `red-500` is an `oklch()` color, and the two aren't the same color. `:hover` becomes `[&:hover]:` because Tailwind's `hover:` also adds `@media (hover: hover)`, which turns the state off on touch devices. Both are deliberate: see [Exact and nearest](#exact-and-nearest).

### A whole stylesheet

`convertCss` parses a stylesheet and groups the rules by the element they style. `.btn`, `.btn:hover` and `@media (…) { .btn }` give one class list for `.btn`.

<!-- test -->
```js
import { convertCss } from 'tailwind-from-css'

const { rules, passthroughCss, diagnostics } = await convertCss(`
  .card > .title { font-size: 18px; line-height: 28px; font-weight: 600 }
  :root { --brand: #4f46e5 }
  @keyframes spin { to { transform: rotate(360deg) } }
`)

rules[0].subject          // '.card > .title'
rules[0].result.className // 'text-lg/7 font-semibold'
passthroughCss            // ':root { … } @keyframes spin { … }'
```

CSS that has no utility form, like `@keyframes`, `@font-face`, `@property` or rules for `:root`, `html` and `*`, is returned in `passthroughCss` for you to keep in a stylesheet. Syntax errors are recovered from the way browsers do, never thrown.

### Many conversions

The one-shot helpers cache up to four converters by their options, so repeated calls are cheap. If you convert a lot with the same options, create a converter once. Loading Tailwind and building the index takes about a second; after that, conversion is synchronous and typically takes well under a millisecond per element.

```js
import { createConverter } from 'tailwind-from-css'

const converter = await createConverter({ mode: 'nearest' })

for (const element of elements) {
  const { className } = converter.convertStyles(element.styles)
}
```

### From the command line

```bash
npx tailwind-from-css styles.css
```

It prints one `subject { classes }` line per rule. See [Command line](#command-line) for the flags.

## Exact and nearest

The default mode is **`exact`**: the CSS Tailwind generates for the output is equivalent to your input. That's a strict promise, and it explains some output that may look surprising at first:

<!-- test -->
```js
import { convertStyles } from 'tailwind-from-css'

const result = await convertStyles({ declarations: 'padding: 8px 16px; background-color: #2563eb' })
result.className
// 'bg-[#2563eb] pt-2 pr-4 pb-2 pl-4'
```

`px-4` sets `padding-inline`, not `padding-left` and `padding-right`. The two only match in left-to-right text, so `exact` keeps the physical sides.

**`nearest`** mode allows substitutions that are visually close but not identical. Each one is a named **relaxation**:

<!-- test -->
```js
import { convertStyles } from 'tailwind-from-css'

const result = await convertStyles(
  { declarations: 'padding: 8px 16px; color: #737373; margin-top: 13.3px' },
  { mode: 'nearest' },
)
result.className
// 'mt-3.5 px-4 py-2 text-neutral-500'
```

| Relaxation | What it does | Why it isn't exact |
|---|---|---|
| `hover-media` | `:hover` → `hover:` instead of `[&:hover]:` | `hover:` adds `@media (hover: hover)`, so touch devices lose the state |
| `logical-properties` | left/right and top/bottom pairs → `px-4`, `mx-auto`, `inset-x-0` … | Assumes left-to-right, horizontal text |
| `color-nearest` | A color within `tolerance.colorDeltaE` (ΔE OK) of a theme color snaps to it, keeping alpha (`bg-red-500/50`) | A different color |
| `length-nearest` | A px length within `tolerance.lengthPx` **and** `tolerance.lengthRatio` of a theme value or a 0.5 spacing step snaps to it | A different length |
| `breakpoint-nearest` | A width condition within `tolerance.breakpointPx` of a breakpoint snaps to it (`max-width: 767px` → `max-md:`) | A different trigger point |
| `font-weight-nearest` | Snaps to the nearest theme weight (`590` → `font-semibold`) | A different weight |
| `text-line-height` | `text-sm` alone for a font size with no line height, accepting the token's line height | Adds a declaration |
| `pill-radius` | A radius of 1000px or more → `rounded-full` | Infinite vs. a finite radius |

`mode: 'nearest'` turns on all of them. Toggle single ones with `relax`, in either mode:

```js
// exact, plus logical properties
await convertStyles(input, { relax: ['logical-properties'] })

// nearest, but keep :hover exact
await convertStyles(input, { mode: 'nearest', relax: ['!hover-media'] })
```

Relaxations only apply where no exact class exists, and relaxed classes are verified too, against the value they actually set. When a relaxation fires, the class's mapping carries `relaxation: { name, detail, delta }`, a `TFC203` diagnostic is added, and `result.exact` is `false`.

## Using your own theme

Pass your project's entry stylesheet as `tailwind.css`. Imports, plugins and configs in it are resolved from `tailwind.base`, which defaults to the current working directory.

<!-- test -->
```js
import { createConverter } from 'tailwind-from-css'

const converter = await createConverter({
  tailwind: {
    css: `
      @import "tailwindcss";
      @theme {
        --color-brand: #4f46e5;
        --spacing-gutter: 18px;
      }
    `,
    base: process.cwd(),
  },
})

converter.convertStyles({ declarations: 'color: #4f46e5; padding: 18px; margin-top: 18px' }).className
// 'mt-gutter p-gutter text-brand'
```

To load your real entry file, read it and pass its directory as `base`:

```js
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const entry = 'src/styles/app.css'
const converter = await createConverter({
  tailwind: { css: await readFile(entry, 'utf8'), base: dirname(entry) },
})
```

`converter.toCss(classes)` returns the CSS Tailwind generates for a list of classes, which is handy for checking output by eye.

## Converting styles captured from a live page

A computed style lists every property the browser knows, most of them defaults. `pruneStyles` keeps only what an element shows differently from a **baseline**: the same tag, rendered with no classes under Tailwind's Preflight, inside a copy of the element's parent.

```js
import { convertStyles, pruneStyles } from 'tailwind-from-css'

const declarations = pruneStyles(styles, { parent, baseline, states: [hoverStyles] })
const hover = pruneStyles(hoverStyles, { baseline: styles, states: [] })

const { className } = await convertStyles([
  { declarations },
  { selector: '&:hover', declarations: hover },
])
```

Before comparing, `pruneStyles` reads back values the browser has resolved: a color that follows the text color counts as `currentcolor`, an origin at the center of the box as `50% 50%`, and so on. Given the element's other `states`, it also drops what shows nothing, such as an outline's color when there's no outline, unless one of those states shows it. Use `keep` and `drop` to override it for specific properties.

The [capture guide](docs/guides/capture-tools.md) covers the full recipe: building the baseline, capturing hover and focus states, pseudo-elements and several viewport widths, plus a minimal Playwright script that does all of it. On the captured test pages, elements go from about 480 computed properties to a median of 11 classes, all exact.

## Reading the result

`convertStyles` returns a `ConversionResult`:

```ts
{
  className: 'flex p-4 md:p-6',      // classes in Tailwind's canonical order
  classes: ['flex', 'p-4', 'md:p-6'],
  mappings: [                         // where each class came from
    {
      className: 'p-4',
      kind: 'bare',                   // 'named' | 'bare' | 'arbitrary-value' | 'arbitrary-property' | 'variable'
      sources: [{ property: 'padding', value: '16px', important: false, selector: '&', conditions: [] }],
      // relaxation: { name, detail, delta }  (nearest mode only)
    },
    // …
  ],
  unconverted: [],                    // declarations left out, each with a diagnostic code
  diagnostics: [],                    // { code, severity, message, source }
  exact: true,                        // no relaxation applied and nothing unconverted
}
```

`convertCss` returns `{ rules, passthroughCss, diagnostics }`. Each rule has the `subject` it styles, the original `selectors` merged into it, and a `ConversionResult`. Sources from a stylesheet also carry their `line` and `column`.

## Command line

The package installs a `tailwind-from-css` command that converts a stylesheet. It reads a file, or stdin when no file is given or the file is `-`.

```text
tailwind-from-css [file|-] [options]

  --mode exact|nearest          relaxation preset (default: exact)
  --relax a,b,!c                add relaxations to the preset, or remove them with "!"
  --theme <file.css>            your Tailwind entry stylesheet (default: @import "tailwindcss")
  --root-font-size <n|false>    px per rem; false keeps px and rem apart (default: 16)
  --format text|json            output format (default: text)
  --fail-on-unconverted         exit with 3 when anything is unconverted
  --print-config                print the resolved options and exit
  --version, --help
```

Given this `styles.css`:

```css
.btn {
  display: inline-flex;
  padding: 8px;
  border-radius: 6px;
  background-color: #4f46e5;
  color: #fff;
}

.btn:hover {
  background-color: #4338ca;
}

@media (min-width: 768px) {
  .btn {
    padding: 12px;
  }
}

.card > .title {
  font-size: 18px;
  line-height: 28px;
  font-weight: 650;
  background-image: url("hero image.png");
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
```

the text format prints one line per rule on stdout, followed by the CSS that has to stay in a stylesheet:

```console
$ tailwind-from-css styles.css 2>/dev/null
.btn { inline-flex rounded-md bg-[#4f46e5] p-2 text-white md:p-3 [&:hover]:bg-[#4338ca] }
.card > .title { text-lg/7 font-[650] }

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
```

Unconverted declarations and diagnostics go to stderr, one per line with the file, line and column, so stdout stays clean for piping:

```console
$ tailwind-from-css styles.css >/dev/null
styles.css:5:3: info TFC201: bg-[#4f46e5] uses an arbitrary value.
styles.css:10:3: info TFC201: [&:hover]:bg-[#4338ca] uses an arbitrary value.
styles.css:10:3: info TFC301: The selector of &:hover needs an arbitrary variant.
styles.css:22:3: info TFC201: font-[650] uses an arbitrary value.
styles.css:23:3: unconverted TFC204: background-image: url("hero image.png")
styles.css: info TFC103: The at-rule "@keyframes spin" was moved to passthroughCss. (26:1)
```

The same file in `nearest` mode:

```console
$ tailwind-from-css --mode nearest styles.css 2>/dev/null
.btn { inline-flex rounded-md bg-[#4f46e5] p-2 text-white hover:bg-[#4338ca] md:p-3 }
.card > .title { text-lg/7 font-bold }

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
```

Use your own theme with `--theme src/styles/app.css`; its imports and plugins resolve from the file's directory. `--format json` prints the [`convertCss` result](#reading-the-result) exactly as the API returns it, and `--print-config` shows the resolved options the flags give.

Exit codes:

| Code | Meaning |
|---|---|
| `0` | Converted (unconverted declarations are reported but don't fail the run) |
| `1` | Tailwind or the theme could not be loaded (`TFC901`–`TFC903`) |
| `2` | Usage error: an unknown flag, an invalid value, or a file that can't be read |
| `3` | Something is unconverted and `--fail-on-unconverted` is set |

In CI, `tailwind-from-css --fail-on-unconverted styles.css` fails the job when a declaration can't be expressed as a class.

## API

Everything is exported from the package root.

| Export | Description |
|---|---|
| `createConverter(options?)` | Loads Tailwind and builds the index. Returns `Promise<Converter>`. |
| `convertStyles(input, options?)` | One element's styles → one class list. Returns `Promise<ConversionResult>`. |
| `convertCss(css, options?)` | A stylesheet → class lists grouped by subject. Returns `Promise<CssConversionResult>`. |
| `pruneStyles(styles, options)` | A computed style → the declarations that need classes. Pure and synchronous. |
| `TfcError` | The only error the library throws, for setup and usage problems (codes `TFC901`–`TFC905`). |

A `Converter` has synchronous `convertStyles(input)`, `convertCss(css)` and `toCss(classes)` methods, plus `tailwindVersion` (the version actually loaded) and `options` (the resolved, frozen options).

All types (`StyleInput`, `ConversionResult`, `ConverterOptions`, `Diagnostic`, `RelaxationName` …) are exported for TypeScript.

## Options

```ts
interface ConverterOptions {
  /** Preset of relaxations. Default 'exact'. */
  mode?: 'exact' | 'nearest'
  /** Relaxations added on top of the preset, or removed with '!name'. */
  relax?: Array<RelaxationName | `!${RelaxationName}`>
  tailwind?: {
    /** Entry stylesheet. Default '@import "tailwindcss";' */
    css?: string
    /** Directory for resolving @import, @plugin and @config. Default process.cwd(). */
    base?: string
  }
  /** px per rem, so 16px and 1rem are equal. false makes them different. Default 16. */
  rootFontSize?: number | false
  /** Tolerances for nearest relaxations. */
  tolerance?: {
    colorDeltaE?: number   // ΔE OK. Default 0.02
    lengthPx?: number      // Default 2
    lengthRatio?: number   // Default 0.1. A snap must satisfy both length limits
    breakpointPx?: number  // Default 16
  }
  /** Important as a suffix (`flex!`, v4) or the deprecated prefix (`!flex`). Default 'suffix'. */
  important?: 'suffix' | 'prefix'
}
```

Unknown keys or invalid values throw `TfcError` with code `TFC904`.

## Diagnostics

CSS problems never throw. They become diagnostics or unconverted declarations. Diagnostic **codes** are part of the public API and never change meaning; messages may be reworded in any release, so match on codes. [docs/errors.md](docs/errors.md) explains every code with an example and what to do.

| Code | Severity | Meaning |
|---|---|---|
| `TFC101` | error | The stylesheet couldn't be parsed |
| `TFC102` | warning | Invalid declaration skipped |
| `TFC103` | info | At-rule moved to `passthroughCss` |
| `TFC104` | info | Rule subject can't take classes (`:root`, `html`, `*` …), moved to `passthroughCss` |
| `TFC105` | info | Redundant vendor-prefixed declaration dropped |
| `TFC106` | info | Declaration always overridden by another one, dropped |
| `TFC201` | info | Arbitrary value used (`w-[13px]`) |
| `TFC202` | info | Arbitrary property used (`[prop:value]`) |
| `TFC203` | info | Relaxation applied |
| `TFC204` | warning | Value can't be written as a class, left unconverted |
| `TFC301` | info | Arbitrary variant used for a selector |
| `TFC302` | info | Arbitrary variant used for an at-rule |
| `TFC303` | warning | Context can't be written as a variant, left unconverted |
| `TFC401` | info | Cascade-order conflict fixed with a stacked variant |
| `TFC402` | warning | Cascade-order conflict couldn't be fixed, left unconverted |
| `TFC501` | warning | Verification mismatch, fell back to an arbitrary property (please report it) |
| `TFC502` | warning | Verification failed for the arbitrary property too, left unconverted |

Thrown `TfcError` codes, all about setup:

| Code | Meaning |
|---|---|
| `TFC901` | `tailwindcss` isn't installed next to `tailwind-from-css` |
| `TFC902` | The installed `tailwindcss` is outside the supported range |
| `TFC903` | The entry CSS failed to load from `tailwind.base` (missing import, plugin error); the cause is attached |
| `TFC904` | Invalid options |
| `TFC905` | Input of the wrong shape (from JavaScript), e.g. `convertStyles` given declarations instead of `{ declarations }` |

<!-- test -->
```js
import { createConverter, TfcError } from 'tailwind-from-css'

try {
  await createConverter({ tailwind: { css: '@import "./missing.css";' } })
} catch (error) {
  if (!(error instanceof TfcError)) throw error
  error.code // 'TFC903'
  console.error(error.message, error.docsUrl)
}
```

## How it works

1. **Index.** On `createConverter`, the converter loads your Tailwind's design system and compiles every utility it knows. Each one is stored under the declarations it actually produces, normalized. This is how custom themes, plugins and new Tailwind releases work without any changes here.
2. **Parse.** Input is parsed with PostCSS. Selectors and at-rules become a context (`&:hover` inside `@media (width >= 48rem)`), and shorthands expand into longhands.
3. **Normalize.** Values are put into normal forms so equal values compare equal: colors in any syntax, `px` and `rem`, `0` and `0px`, number formatting, and so on. Normal forms are lossless; anything lossy is a relaxation.
4. **Match.** For each context, the converter finds the fewest classes that cover the declarations, preferring theme classes over bare values, bare values over arbitrary values, and arbitrary values over arbitrary properties.
5. **Verify.** The chosen classes are compiled with your Tailwind, and the CSS is compared with the input. A mismatch falls back to a safer class or to unconverted.
6. **Cascade check.** Where Tailwind's variant order would let a different declaration win than your stylesheet does, a class for the overlap is added, or the declaration is reported.
7. **Order.** Classes come out in Tailwind's canonical order.

## Requirements and limitations

- Node.js 22.12 or later. ESM only.
- `tailwindcss` `^4.2.0` installed in your project. Tailwind v3 output isn't supported.
- Node only for now. The core does no I/O of its own, so browser support is possible later.
- The library returns classes. It doesn't rewrite your HTML or JSX.
- It doesn't create `@theme` tokens from repeated values yet.
- `transform: matrix(…)` stays an arbitrary property; it isn't split into `translate`, `rotate` and `scale`.
- The command line converts stylesheets. Converting a single element's styles (`convertStyles`) and `pruneStyles` are API-only.

## Versioning

The package follows semantic versioning and is in `0.x` while the public beta runs. From 1.0:

- **Major:** removed or renamed API, options, result fields, diagnostic codes or CLI flags; a higher Node or Tailwind floor; a change to what `exact` means.
- **Minor:** new options, relaxations or diagnostic codes; output changes that stay exact under the same Tailwind version and theme (a better class found).
- **Patch:** bug fixes, including output that goes from incorrect to correct.

Releases are published from GitHub Actions with npm provenance. See the [changelog](CHANGELOG.md) for what changed in each version.

## Contributing

Bug reports are very welcome. The most useful ones include a minimal CSS input, the output you got and the output you expected: each becomes a test case. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, commands and how the code is organized.

## License

[MIT](LICENSE) © Paweł Bornikowski
