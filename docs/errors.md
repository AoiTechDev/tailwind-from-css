# Diagnostics and errors

Every problem `tailwind-from-css` reports has a stable code. CSS problems never throw: they become **diagnostics** (`TFC1xx`–`TFC5xx`) in the result, and declarations that can't be converted are listed in `unconverted` with the code that explains why. Only setup problems throw, as a `TfcError` with a `TFC9xx` code and a `docsUrl` that links to this page.

Codes are part of the public API: they keep their meaning across releases. Messages are for people and may be reworded in any release, so scripts should match on codes.

Where to find them:

- `result.diagnostics`: `{ code, severity, message, source }` for one element (`convertStyles`) or one rule (`convertCss`, in `rules[i].result`).
- `result.unconverted`: the declarations left out, each with `code` and its source (property, value, selector, conditions, and `line`/`column` for stylesheets).
- `convertCss(…).diagnostics`: problems with the stylesheet as a whole.
- The command line prints one line per report on stderr, `file:line:column: <severity> <code>: <message>`, or `file:line:column: unconverted <code>: <declaration>`.

Severities: **info** is expected output worth knowing about, **warning** means something was left out or needs your attention, **error** means the input couldn't be used at all.

The examples below run the command line on a `card.css` next to a project with `tailwindcss` installed. The API reports the same codes.

| Code | Severity | Meaning |
|---|---|---|
| [TFC101](#tfc101) | error | The stylesheet couldn't be parsed |
| [TFC102](#tfc102) | warning | Invalid declaration skipped |
| [TFC103](#tfc103) | info | At-rule moved to `passthroughCss` |
| [TFC104](#tfc104) | info | Rule subject can't take classes, moved to `passthroughCss` |
| [TFC105](#tfc105) | info | Redundant vendor-prefixed declaration dropped |
| [TFC106](#tfc106) | info | Declaration always overridden, dropped |
| [TFC201](#tfc201) | info | Arbitrary value used |
| [TFC202](#tfc202) | info | Arbitrary property used |
| [TFC203](#tfc203) | info | Relaxation applied |
| [TFC204](#tfc204) | warning | Value can't be written as a class |
| [TFC301](#tfc301) | info | Arbitrary variant used for a selector |
| [TFC302](#tfc302) | info | Arbitrary variant used for an at-rule |
| [TFC303](#tfc303) | warning | Context can't be written as a variant |
| [TFC401](#tfc401) | info | Cascade-order conflict fixed with a stacked class |
| [TFC402](#tfc402) | warning | Cascade-order conflict couldn't be fixed |
| [TFC501](#tfc501) | warning | Verification mismatch, fell back to an arbitrary property |
| [TFC502](#tfc502) | warning | Verification failed for the arbitrary property too |
| [TFC901](#tfc901) | thrown | `tailwindcss` can't be imported |
| [TFC902](#tfc902) | thrown | Unsupported `tailwindcss` version |
| [TFC903](#tfc903) | thrown | The Tailwind entry CSS failed to load |
| [TFC904](#tfc904) | thrown | Invalid options |

## Parsing and input

### TFC101

**Error.** The stylesheet couldn't be parsed, even with the browser-style error recovery that handles most broken CSS. Nothing is converted: `rules` is empty and this is the only diagnostic. In practice this means nesting deeper than 256 levels.

<!-- test -->
```js
import { convertCss } from 'tailwind-from-css'

const { diagnostics } = await convertCss('.card {'.repeat(300))
diagnostics[0].code // 'TFC101'
```

**What to do:** check that the input really is a stylesheet (not HTML or a minified bundle cut in half), and flatten the nesting.

### TFC102

**Warning.** A declaration with an empty or unparsable value was skipped, or text that isn't valid CSS was skipped while recovering from a syntax error. A skipped declaration is listed in `unconverted`.

```css
.card { color: ; padding: 16px; }
```

```console
$ npx tailwind-from-css card.css
.card { p-4 }
card.css:1:9: unconverted TFC102: color:
```

**What to do:** fix the declaration. Browsers ignore it too, so leaving it out changes nothing on the page.

### TFC103

**Info.** An at-rule with no utility form (`@keyframes`, `@font-face`, `@property`, `@page`, `@counter-style`, `@layer` statements …) was copied to `passthroughCss` unchanged.

```css
@keyframes spin { to { rotate: 360deg; } }
```

```console
$ npx tailwind-from-css card.css
@keyframes spin {
  to {
    rotate: 360deg;
  }
}
card.css: info TFC103: The at-rule "@keyframes spin" was moved to passthroughCss. (1:1)
```

**What to do:** keep `passthroughCss` in a stylesheet, for example next to your Tailwind entry file. Classes like `animate-[spin_1s_linear_infinite]` can still refer to it.

### TFC104

**Info.** The rule's subject isn't an element you can put classes on (`:root`, `html`, `*`, `::selection` on its own …), so the rule was copied to `passthroughCss`.

```css
:root { --brand: #4f46e5; }
```

```console
$ npx tailwind-from-css card.css
:root {
  --brand: #4f46e5;
}
card.css: info TFC104: The rule ":root" has no element to put classes on and was moved to passthroughCss. (1:1)
```

**What to do:** keep `passthroughCss` in a stylesheet. Custom properties on `:root` can also become `@theme` variables in your Tailwind entry file.

### TFC105

**Info.** A vendor-prefixed declaration repeats an unprefixed one in the same block, so it was dropped. Tailwind's build adds the prefixes browsers still need.

```css
.card { -webkit-border-radius: 6px; border-radius: 6px; }
```

```console
$ npx tailwind-from-css card.css
.card { rounded-md }
card.css:1:9: info TFC105: "-webkit-border-radius: 6px" in & repeats an unprefixed declaration and was dropped.
```

**What to do:** nothing.

### TFC106

**Info.** A declaration can never show, so it was dropped: a later declaration of the same block overrides it, another context always overrides it wherever it applies, or a shorthand covers it.

```css
.card { color: red; color: #000; }
```

```console
$ npx tailwind-from-css card.css
.card { text-black }
card.css:1:9: info TFC106: "color: red" in & is overridden wherever it applies and was dropped.
```

**What to do:** nothing: the dropped declaration never shows. If it was a fallback for browsers that don't understand the value that overrides it, keep that pair in a stylesheet.

## Classes

### TFC201

**Info.** No theme or bare-value class sets exactly this value, so the class uses an arbitrary value (`w-[13.3px]`). It's still exact.

```css
.card { width: 13.3px; }
```

```console
$ npx tailwind-from-css card.css
.card { w-[13.3px] }
card.css:1:9: info TFC201: w-[13.3px] uses an arbitrary value.
```

**What to do:** nothing, or add the value to your theme (`@theme { --spacing-card: 13.3px; }`) to get a named class. `nearest` mode snaps values close to the theme instead ([TFC203](#tfc203)).

### TFC202

**Info.** No utility sets this property the way the input does, so the class is an arbitrary property (`[property:value]`). It's still exact.

```css
.card { text-wrap-mode: nowrap; }
```

```console
$ npx tailwind-from-css card.css
.card { [text-wrap-mode:nowrap] }
card.css:1:9: info TFC202: [text-wrap-mode:nowrap] uses an arbitrary property.
```

**What to do:** nothing, or define a utility with `@utility` in your Tailwind entry file; the converter picks it up.

### TFC203

**Info.** A relaxation produced this class: the value is close to, but not the same as, the input. The class's mapping carries `relaxation: { name, detail, delta }`, and `result.exact` is `false`. Only happens in `nearest` mode or with relaxations turned on through `relax`.

```css
.card { color: #737373; }
```

```console
$ npx tailwind-from-css --mode nearest card.css
.card { text-neutral-500 }
card.css:1:9: info TFC203: text-neutral-500 relaxes color-nearest: color: #737373 → oklch(0.556 0 none / 1) (delta 0.0005).
```

**What to do:** check that the difference is acceptable. Tighten `tolerance`, or turn the relaxation off with `relax: ['!color-nearest']` (`--relax '!color-nearest'`).

### TFC204

**Warning.** The value can't be written inside a class. Here, a class can't contain a space, and inside `url()` Tailwind keeps `_` as an underscore, so there's no way to spell the file name. The declaration is listed in `unconverted`.

```css
.hero { background-image: url("hero image.png"); }
```

```console
$ npx tailwind-from-css card.css
.hero {}
card.css:1:9: unconverted TFC204: background-image: url("hero image.png")
```

**What to do:** keep the declaration in a stylesheet, or change the value (rename the file, or put it in a custom property: `--hero: url("hero image.png")` and `bg-(image:--hero)`).

## Contexts

### TFC301

**Info.** No named variant reproduces the selector exactly, so the class uses an arbitrary variant (`[&:hover]:`). For `:hover` this is deliberate: Tailwind's `hover:` also adds `@media (hover: hover)`.

```css
.btn:hover { color: #000; }
```

```console
$ npx tailwind-from-css card.css
.btn { [&:hover]:text-black }
card.css:1:14: info TFC301: The selector of &:hover needs an arbitrary variant.
```

**What to do:** nothing. To get `hover:`, turn on the `hover-media` relaxation (included in `nearest` mode).

### TFC302

**Info.** No named variant reproduces the at-rule's conditions exactly, so the class uses an arbitrary variant (`[@media(hover:none)]:`).

```css
@media (hover: none) { .card { display: none; } }
```

```console
$ npx tailwind-from-css card.css
.card { [@media(hover:none)]:hidden }
card.css:1:32: info TFC302: The conditions of @media (hover: none) { & } need an arbitrary variant.
```

**What to do:** nothing, or define the variant with `@custom-variant` in your Tailwind entry file; the converter picks it up. Widths close to a breakpoint snap to it with the `breakpoint-nearest` relaxation.

### TFC303

**Warning.** The context (selector and conditions) can't be written as any variant chain that Tailwind compiles back into exactly that context. The declarations in it are listed in `unconverted`. Stylesheets rarely cause it, since nearly any selector or at-rule fits an arbitrary variant; it mostly comes from `selector` or `conditions` strings passed to `convertStyles`, like this unbalanced one.

<!-- test -->
```js
import { convertStyles } from 'tailwind-from-css'

const result = await convertStyles({
  conditions: ['@media (min-width: 768px) {'],
  declarations: 'color: #fff',
})
result.unconverted[0].code // 'TFC303'
```

**What to do:** check the context. Selectors are relative to the element and must contain `&` (`'&:hover'`, `'.dark &'`); each condition is one at-rule prelude (`'@media (min-width: 768px)'`).

## Cascade

### TFC401

**Info.** Tailwind orders classes by variant, not by your stylesheet. Here `md:p-4` would win over `min-[1000px]:p-6` above 1000px, the opposite of the source order, so a stacked class (`min-[1000px]:md:p-6`) was added for the overlap.

```css
@media (min-width: 768px) { .card { padding: 16px; } }
@media (min-width: 1000px) { .card { padding: 24px; } }
```

```console
$ npx tailwind-from-css card.css
.card { min-[1000px]:p-6 md:p-4 min-[1000px]:md:p-6 }
card.css:2:38: info TFC401: "padding: 24px" in @media (min-width: 1000px) { & } needs a stacked class to win where other contexts apply too.
```

**What to do:** nothing. The output is exact; the extra class is the price of the order. Using your theme's breakpoints in the CSS avoids it.

### TFC402

**Warning.** In Tailwind's class order a different declaration would win than in your stylesheet, and no stacked class can restore the order. The declaration that would lose is listed in `unconverted`. Here the shorthand stays whole because of `var()`, and Tailwind sorts `[border:…]` after any `border-t-*` class, so the later `border-top-color` would lose.

```css
.card { border: var(--card-border); border-top-color: #000; }
```

```console
$ npx tailwind-from-css card.css
.card { [border:var(--card-border)] }
card.css:1:9: info TFC202: [border:var(--card-border)] uses an arbitrary property.
card.css:1:37: unconverted TFC402: border-top-color: #000
```

**What to do:** keep the declaration in a stylesheet, or restructure the CSS so the two don't compete (write the longhands instead of the shorthand, or move the override to its own selector).

## Verification

### TFC501

**Warning.** A class the converter chose didn't compile to the input's CSS under your Tailwind, so it was replaced by an arbitrary property, which did. The output is still exact. This points to a bug, or to a Tailwind release that changed how a utility works.

```console
card.css:1:9: warning TFC501: The class for "color: #000" in & failed verification and was replaced. Please report this.
```

**What to do:** please [open an issue](https://github.com/AoiTechDev/tailwind-from-css/issues) with the input, your `tailwindcss` version and your theme, so it becomes a test case.

### TFC502

**Warning.** Verification failed even for the arbitrary property, so no class reproduces the declaration and it is listed in `unconverted`. Like [TFC501](#tfc501), this shouldn't happen.

```console
card.css:1:9: unconverted TFC502: color: #000
```

**What to do:** keep the declaration in a stylesheet, and please [open an issue](https://github.com/AoiTechDev/tailwind-from-css/issues) with the input and your `tailwindcss` version.

## Setup errors (thrown)

These are thrown by `createConverter` and the one-shot `convertStyles` and `convertCss` as a `TfcError` with `code`, `message`, `cause` (when there is one) and `docsUrl`. The command line prints them and exits with `1`, or `2` for `TFC904`.

### TFC901

**Thrown.** `tailwindcss` can't be imported from where `tailwind-from-css` is installed. It's a peer dependency, so your project installs it.

```console
$ npx tailwind-from-css card.css
tailwind-from-css: TFC901: tailwindcss could not be imported. Install it next to tailwind-from-css: …
```

**What to do:** `npm install tailwindcss` in the same project. If the message instead reads `Can't load @import "tailwindcss"`, that's [TFC903](#tfc903): the entry CSS is resolved from `tailwind.base`.

### TFC902

**Thrown.** The installed `tailwindcss` is outside the supported range (`^4.2.0`), or it lacks an internal API the converter needs.

```console
$ npx tailwind-from-css card.css
tailwind-from-css: TFC902: tailwindcss 3.4.17 is installed, but tailwind-from-css needs ^4.2.0.
```

**What to do:** upgrade to Tailwind CSS v4.2 or later. If the message says an API is missing on a supported version, please [open an issue](https://github.com/AoiTechDev/tailwind-from-css/issues) with that version.

### TFC903

**Thrown.** Tailwind couldn't load the entry CSS: an `@import`, `@plugin` or `@config` can't be resolved from `tailwind.base` (the working directory by default), or a plugin threw. The original error is in `cause`.

<!-- test -->
```js
import { createConverter } from 'tailwind-from-css'

const error = await createConverter({
  tailwind: { css: '@import "tailwindcss";\n@import "./missing.css";' },
}).catch((error) => error)
error.code // 'TFC903'
```

**What to do:** read the message for the path that failed. Pass the directory your entry file lives in as `tailwind.base` (the command line does this for `--theme`), and check that the imported packages are installed there.

### TFC904

**Thrown.** An option is unknown or has an invalid value. The message names the option. On the command line this is a usage error (exit code `2`).

<!-- test -->
```js
import { createConverter } from 'tailwind-from-css'

const error = await createConverter({ mode: 'fast' }).catch((error) => error)
error.code // 'TFC904'
```

**What to do:** fix the option. See [Options](../README.md#options) for the valid keys and values.
