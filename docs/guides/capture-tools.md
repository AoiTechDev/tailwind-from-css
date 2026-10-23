# Capturing computed styles

This guide is for tools that read styles from a rendered page (`getComputedStyle`, the Chrome DevTools Protocol) and want Tailwind classes for each element. `convertStyles` takes any declarations, but a computed style lists every property the browser knows, about 480 longhands per element, most of them defaults. Converted raw, every element would get hundreds of classes. Most of them would be redundant, and some would be wrong, because Preflight changes the defaults.

The recipe has four parts:

1. For each element, capture its computed style, its parent's, and a **baseline**: the same tag rendered with no classes under Tailwind's base CSS.
2. Prune with `pruneStyles`, which keeps only what the element shows differently from its baseline.
3. Capture **states** (`:hover`, `:focus-visible`) and **pseudo-elements** (`::before`, `::after`) the same way, and prune them too.
4. Capture at several **viewport widths** and turn the differences into `@media` conditions, mobile first.

The result is a list of `StyleInput`s for one element, ready for `convertStyles`. Each part is explained below, and [a minimal script](#a-minimal-playwright-script) does all four with Playwright.

## What to capture

For each element, at each width:

| What | How | Passed as |
|---|---|---|
| The element's computed style | `getComputedStyle(element)` | `styles` |
| Its parent's computed style | `getComputedStyle(element.parentElement)` | `parent` (none for `<html>`) |
| Its baseline | [below](#the-baseline) | `baseline` |
| Each state | the element's computed style while the state is forced | a `StyleInput` with `selector: '&:hover'` |
| Each pseudo-element that has content | `getComputedStyle(element, '::before')`, and its own baseline | a `StyleInput` with `selector: '&::before'` |

Leave custom properties (`--*`) out. Computed values already have `var()` substituted, and `pruneStyles` drops them unless you name them in `keep`.

## The baseline

The baseline answers one question: what would this element look like with no classes, in a Tailwind project? Anything equal to it needs no class.

1. Build Tailwind's base CSS with no utilities: the theme variables and Preflight. Use your project's entry CSS, with automatic source detection turned off, so your theme and plugins apply and no classes are generated:

   ```css
   /* base.input.css */
   @import "tailwindcss" source(none);
   ```

   ```bash
   npx @tailwindcss/cli -i base.input.css -o base.css
   ```

2. Load `base.css` into a hidden `<iframe>` on the captured page (the same browser, so the same fonts and UA styles).
3. In the frame, create a wrapper that **copies the parent's whole computed style** as inline styles, and put a blank element with the element's tag inside it. Copy `lang` too, and the attributes the browser's own styles read: `type`, `href` (any value), `open`, `disabled`, `multiple`, `size`, and the ones the browser maps to styles that your markup keeps: `width` and `height` (an `<img width="36" height="36">` computes `aspect-ratio: auto 36 / 36`), `hidden`, `dir`. For an SVG element, create it in the SVG namespace and copy its presentation attributes (`fill`, `stroke-width` …), so `fill="none"` doesn't come back as `fill-none`.
4. Read the blank element's computed style. That's the baseline.

Why copy the whole parent style, not just the inherited values? Because some of what an element shows comes from its parent's layout. A flex or grid item has `min-width: auto` and a blockified `display` (an `<a>` in a flex row computes to `display: block`). The wrapper has to be a flex or grid container too, or every flex item gets `block min-w-auto`. Copying everything also carries the inherited properties browsers have and the CSS data doesn't list, like Chromium's `-webkit-font-smoothing`.

Two details matter when copying:

- A value equal to the parent's `color`, other than `color` itself, is copied as `currentcolor`. `caret-color`, `-webkit-text-fill-color` and friends follow the text color, and the blank element's own color (a `<mark>` is black) must still be able to change them.
- The root element (`<html>`) has no parent. Its baseline is the frame's own `<html>` with the page's `lang`, and it's pruned without a `parent`.

Chromium gives a document inside an iframe `app-region: no-drag`, while the page itself has `none`. Pass `drop: ['app-region']` unless your site sets it.

You can cache baselines per tag, attributes and parent style.

## Pruning

```ts
import { pruneStyles } from 'tailwind-from-css'

const declarations = pruneStyles(styles, { parent, baseline, states: [hoverStyles] })
```

A longhand is dropped when it equals the baseline's value (or the parent's, for an inherited property the baseline doesn't list, or its initial value). Equality uses the converter's normal forms. Before comparing, `pruneStyles` reads back values the browser resolved against the element:

- A color equal to the element's own `color` counts as `currentcolor`.
- A transform or perspective origin at the center of the box counts as `50% 50%`.
- A transition or animation list of equal items counts as one item.
- Insets of `0px` on both sides of a relatively positioned box count as `auto`.
- On a box that isn't rendered (`display: none` or `contents`, or any box under a hidden ancestor, whose sizes come back as computed, `auto` or `100%`, not px), an `auto` size or a `0px` minimum counts as nothing. A `0px` minimum on an absolutely positioned box counts as `auto`: it's never a flex or grid item.
- On a relatively positioned box, an end inset equal to the start one negated (`bottom: -10px` with `top: 10px`) counts as `auto`: only the start side shows.
- A logical longhand (`padding-inline-start`) that repeats its physical twin (`padding-left`) is dropped.

Given the element's other captured `states` (the computed styles you prune against this one, below), it also drops longhands that show nothing: a line's color where the line isn't drawn (`outline-style: none`), insets of a static box, what places background images where there is none (`background-size`, `-position`, `-repeat` …), and transition details where every duration and delay is 0. Each stays when a state shows it with the same value, since that state's classes don't repeat it. Pass `states: []` when there are none; without `states` these are compared like anything else. An undrawn border side's color equal to a drawn side's stays too, so `border-gray-200` covers all four sides.

One value it never drops on equality alone: a px `line-height` when the font size differs from the reference's. Computed line-heights are always px, so `line-height: 1.5` and `line-height: 24px` look the same, but only the length stays 24px at another font size.

`keep` and `drop` force properties in or out (a shorthand stands for its longhands; `keep` wins). Read-backs still see dropped values, so dropping `width` doesn't move the center of the box.

## States

Force the state, wait for transitions, read the computed style, then prune it against the element's own computed style, so that only what changes is kept:

```ts
const hovered = pruneStyles(hoverStyles, { baseline: styles, states: [] })
// → { selector: '&:hover', declarations: hovered }
```

With the Chrome DevTools Protocol, `CSS.forcePseudoState` forces pseudo-classes on one node (`DOM.enable` and `CSS.enable` first, then `DOM.querySelector` for its `nodeId`). It's more reliable than moving the mouse, and it can force focus states. After forcing, wait two animation frames and for the element's own transitions to finish, or you read the start of a transition. Wait only for animations with an end, and not for long: an infinite one (a spinner) never finishes.

Name the state by the selector that holds whenever the captured style does:

| Forced | Selector | Use for |
|---|---|---|
| `hover` | `&:hover` | anything |
| `focus`, `focus-visible` | `&:focus-visible` | buttons and links (a mouse click focuses them without `:focus-visible`) |
| `focus`, `focus-visible` | `&:focus` | text fields, where focus always shows as `:focus-visible` |

A forced `:hover` applies to the node only, not its ancestors as a real hover would. Styles keyed to a hovered ancestor (`.card:hover .title`) need that ancestor forced instead.

## Pseudo-elements

Capture `::before` and `::after` only when their `content` isn't `none` or `normal`. Prune them with the element's computed style as `parent`, and a baseline from the blank element's pseudo-element:

- The blank element copies the element's whole computed style, so the pseudo-element sits in the same formatting context.
- Give the blank pseudo-element `content: ""` with a rule in the frame, so that it's generated and gets a box. Then leave `content` out of the baseline, so the captured `content` is always kept.

The result is a `StyleInput` with `selector: '&::before'`.

## Breakpoints

Capture the page at several viewport widths, and let each width's differences become a condition:

- **Pick widths at your theme's breakpoints** (Tailwind's defaults: 640, 768, 1024, 1280, 1536). A difference first seen at 768px becomes `@media (width >= 768px)`, which is `md:`. Between two captured widths, the output shows the narrower width's style, so a site that changes at 900px is only exact at the widths you captured. Capture every breakpoint the site uses.
- **Use a desktop viewport at every width.** Device emulation for phones also emulates touch, so `(hover: hover)` and `(pointer: fine)` stop matching, and hover styles inside those media queries disappear from the narrow capture.
- **Hide scrollbars**, as phones do, so the layout width equals the media query width. Headless Chromium hides them by default.

Then, for each selector (`&`, each state, each pseudo-element), layer the widths mobile first:

1. The narrowest width's pruned declarations go in without a condition.
2. At each wider width, add a `StyleInput` with `conditions: ['@media (width >= <width>px)']` and the declarations whose value differs from what the earlier layers set. Where an earlier layer set a property that this width no longer keeps, add it back with this width's computed value.

### Used sizes

`width`, `height` and a grid container's `grid-template-columns`/`grid-template-rows` come back as **used** px values, the result of layout: `w-[343px]` at 375px, `w-[700px]` at 768px. Compare them across widths:

- A size that **changes** between widths is a layout result. Drop it (`drop: ['width', 'inline-size']`) at every width.
- A size that's the **same** at every width is kept when it differs from the baseline. That keeps authored sizes (a 32px icon), and also content sizes that never change (a one-line label's height). Drop those by name when you know them.
- A size **authored in em or rem** changes with the font size. If the root font size changes between widths, as in Pico CSS, name it in `keep`.

Other used values stay px at each width, and are exact only at the captured widths: `margin: auto` (`md:mx-6 xl:mx-65`), the insets of an absolutely positioned box that weren't set, and lengths written with `vw` or `clamp()`.

## A minimal Playwright script

`capture.ts` captures one element at several widths with its states and pseudo-elements (`captureElement`), then prunes and layers the captures (`toStyleInputs`). It uses Playwright's `page.evaluate` for the in-page parts and a CDP session for `CSS.forcePseudoState`.

```ts
import type { CDPSession, Page } from 'playwright'
import { type Declaration, pruneStyles, type StyleInput } from 'tailwind-from-css'

type Style = Record<string, string>

export interface WidthCapture {
  width: number
  styles: Style
  /** Missing for the root element. */
  parent?: Style
  baseline: Style
  /** `'&:hover'` → the computed style while the state is forced. */
  states: Record<string, Style>
  /** `'&::before'` → the pseudo-element's computed style and its baseline. */
  pseudos: Record<string, { styles: Style; baseline: Style }>
}

/** Runs in the page: the element's computed style, its parent's, its baseline, its pseudo-elements. */
async function capturePage({ selector, baseCss }: { selector: string; baseCss: string }) {
  const read = (style: CSSStyleDeclaration): Style => {
    const out: Style = {}
    for (let index = 0; index < style.length; index++) {
      const property = style.item(index)
      if (!property.startsWith('--')) out[property] = style.getPropertyValue(property)
    }
    return out
  }
  // A copy of `from` on `target`. A value that follows the text color is copied as currentcolor,
  // so the blank element's own color can still change what it inherits.
  const carry = (target: HTMLElement, from: CSSStyleDeclaration) => {
    for (let index = 0; index < from.length; index++) {
      const property = from.item(index)
      if (property.startsWith('--')) continue
      const value = from.getPropertyValue(property)
      target.style.setProperty(property, property !== 'color' && value === from.color ? 'currentcolor' : value)
    }
  }

  // One hidden frame with Preflight, reused for every element of the page.
  const holder = window as unknown as { tfcFrame?: HTMLIFrameElement }
  if (holder.tfcFrame === undefined) {
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:absolute;left:-10000px;top:0;width:2000px;height:600px;border:0'
    const generate = '[data-tfc]::before, [data-tfc]::after { content: "" }'
    frame.srcdoc = `<!doctype html><style>${baseCss}</style><style>${generate}</style>`
    const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }))
    document.body.append(frame)
    await loaded
    holder.tfcFrame = frame
  }
  const frameWindow = holder.tfcFrame.contentWindow as Window
  const frameDocument = frameWindow.document

  const element = document.querySelector(selector) as HTMLElement
  const lang = element.closest('[lang]')?.getAttribute('lang')
  const baselineOf = (pseudo?: string): Style => {
    if (element === document.documentElement) {
      if (lang) frameDocument.documentElement.setAttribute('lang', lang)
      const style = read(frameWindow.getComputedStyle(frameDocument.documentElement))
      frameDocument.documentElement.removeAttribute('lang')
      return style
    }
    const wrapper = frameDocument.createElement('div')
    if (lang) wrapper.setAttribute('lang', lang)
    carry(wrapper, getComputedStyle(element.parentElement as HTMLElement))
    const blank = frameDocument.createElement(element.localName)
    for (const name of ['type', 'href', 'open', 'disabled', 'multiple', 'size', 'width', 'height', 'hidden', 'dir']) {
      const value = element.getAttribute(name)
      if (value !== null) blank.setAttribute(name, name === 'href' ? '#' : value)
    }
    wrapper.append(blank)
    frameDocument.body.append(wrapper)
    let style: Style
    if (pseudo === undefined) {
      style = read(frameWindow.getComputedStyle(blank))
    } else {
      carry(blank, getComputedStyle(element))
      blank.setAttribute('data-tfc', '')
      style = read(frameWindow.getComputedStyle(blank, pseudo))
      delete style.content
    }
    wrapper.remove()
    return style
  }

  const pseudos: WidthCapture['pseudos'] = {}
  for (const pseudo of ['::before', '::after']) {
    const style = getComputedStyle(element, pseudo)
    if (style.content !== 'none' && style.content !== 'normal') {
      pseudos[`&${pseudo}`] = { styles: read(style), baseline: baselineOf(pseudo) }
    }
  }
  const parent = element === document.documentElement ? undefined : element.parentElement
  return {
    styles: read(getComputedStyle(element)),
    ...(parent ? { parent: read(getComputedStyle(parent)) } : {}),
    baseline: baselineOf(),
    pseudos,
  }
}

/** Runs in the page: waits for the element's transitions (at most 1.5 s), then reads its style. */
async function readSettled(selector: string): Promise<Style> {
  const element = document.querySelector(selector) as Element
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  // An infinite animation never finishes, and one elsewhere on the page doesn't matter.
  const running = element.getAnimations().filter((animation) => {
    const end = animation.effect?.getComputedTiming().endTime
    return typeof end === 'number' && Number.isFinite(end)
  })
  const finished = Promise.all(running.map((animation) => animation.finished.catch(() => {})))
  await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, 1500))])
  const style = getComputedStyle(element)
  const out: Style = {}
  for (let index = 0; index < style.length; index++) {
    const property = style.item(index)
    if (!property.startsWith('--')) out[property] = style.getPropertyValue(property)
  }
  return out
}

async function readState(page: Page, cdp: CDPSession, selector: string, force: string[]) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
  await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: force })
  const style = await page.evaluate(readSettled, selector)
  await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })
  await page.evaluate(readSettled, selector)
  return style
}

/** Loads `url` at each width (a desktop viewport) and captures one element. */
export async function captureElement(
  page: Page,
  cdp: CDPSession,
  options: {
    url: string
    selector: string
    baseCss: string
    widths: number[]
    /** `{ '&:hover': ['hover'], '&:focus-visible': ['focus', 'focus-visible'] }` */
    states?: Record<string, string[]>
  },
): Promise<WidthCapture[]> {
  const captures: WidthCapture[] = []
  for (const width of options.widths) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(options.url)
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const captured = await page.evaluate(capturePage, {
      selector: options.selector,
      baseCss: options.baseCss,
    })
    const states: Record<string, Style> = {}
    for (const [state, force] of Object.entries(options.states ?? {})) {
      states[state] = await readState(page, cdp, options.selector, force)
    }
    captures.push({ width, ...captured, states })
  }
  return captures
}

// Computed styles resolve sizes and grid tracks to used px; a value that changes between widths
// is a layout result. A document inside an iframe gets `app-region: no-drag` in Chromium.
const SIZES: Record<string, string[]> = {
  width: ['width', 'inline-size'],
  height: ['height', 'block-size'],
  'grid-template-columns': ['grid-template-columns'],
  'grid-template-rows': ['grid-template-rows'],
}

function dropped(styles: Style[], keep: string[]): string[] {
  const varying = Object.entries(SIZES).filter(
    ([size]) => !keep.includes(size) && new Set(styles.map((style) => style[size])).size > 1,
  )
  return ['app-region', ...varying.flatMap(([, properties]) => properties)]
}

/**
 * Mobile-first: the narrowest width's declarations without a condition, then at each wider
 * width what changed, under `@media (width >= …)`. Where an earlier width set a property this
 * width doesn't keep, the computed value comes back.
 */
function layers(
  selector: string,
  widths: number[],
  pruned: { raw: Style; kept: Declaration[] }[],
): StyleInput[] {
  const inputs: StyleInput[] = []
  const shown = new Map<string, string>()
  pruned.forEach(({ raw, kept }, index) => {
    const names = new Set(kept.map((declaration) => declaration.property))
    const declarations =
      index === 0 ? kept : kept.filter((declaration) => shown.get(declaration.property) !== declaration.value)
    if (index > 0) {
      for (const [property, value] of shown) {
        const now = raw[property]
        if (!names.has(property) && now !== undefined && now !== value) declarations.push({ property, value: now })
      }
    }
    for (const declaration of declarations) shown.set(declaration.property, declaration.value)
    if (declarations.length === 0) return
    inputs.push(
      index === 0
        ? { selector, declarations }
        : { selector, conditions: [`@media (width >= ${widths[index]}px)`], declarations },
    )
  })
  return inputs
}

/** Prunes the captures of one element and layers its widths, ready for `convertStyles`. */
export function toStyleInputs(captures: WidthCapture[], keep: string[] = []): StyleInput[] {
  const sorted = [...captures].sort((a, b) => a.width - b.width)
  const widths = sorted.map((capture) => capture.width)
  const drop = dropped(
    sorted.map((capture) => capture.styles),
    keep,
  )
  const inputs = layers(
    '&',
    widths,
    sorted.map((capture) => ({
      raw: capture.styles,
      kept: pruneStyles(capture.styles, {
        ...(capture.parent ? { parent: capture.parent } : {}),
        baseline: capture.baseline,
        keep,
        drop,
        states: Object.values(capture.states),
      }),
    })),
  )
  // A state needs only what changes, so it's pruned against the element's own computed style.
  for (const state of Object.keys(sorted[0]?.states ?? {})) {
    const pruned = sorted.map((capture) => {
      const style = capture.states[state] as Style
      return { raw: style, kept: pruneStyles(style, { baseline: capture.styles, drop, states: [] }) }
    })
    inputs.push(...layers(state, widths, pruned))
  }
  // A pseudo-element missing at some width isn't generated there: `content: none`.
  const pseudos = new Set(sorted.flatMap((capture) => Object.keys(capture.pseudos)))
  for (const pseudo of pseudos) {
    const captured = sorted.map((capture) => ({
      capture,
      pseudo: capture.pseudos[pseudo] ?? { styles: { content: 'none' }, baseline: {} },
    }))
    const pseudoDrop = dropped(
      captured.map(({ pseudo }) => pseudo.styles),
      keep,
    )
    const pruned = captured.map(({ capture, pseudo }) => {
      const { styles, baseline } = pseudo
      return {
        raw: styles,
        kept: pruneStyles(styles, {
          parent: capture.styles,
          baseline,
          keep,
          drop: pseudoDrop,
          states: [],
        }),
      }
    })
    inputs.push(...layers(pseudo, widths, pruned))
  }
  return inputs
}
```

Using it:

```ts
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createConverter } from 'tailwind-from-css'
import { captureElement, toStyleInputs } from './capture.ts'

const browser = await chromium.launch()
// A desktop page: no touch, so (hover: hover) matches at every width.
const page = await browser.newPage({ colorScheme: 'light' })
const cdp = await page.context().newCDPSession(page)

const captures = await captureElement(page, cdp, {
  url: 'http://localhost:3000/pricing',
  selector: '#buy',
  baseCss: readFileSync('base.css', 'utf8'),
  widths: [375, 768, 1280],
  states: { '&:hover': ['hover'], '&:focus-visible': ['focus', 'focus-visible'] },
})
await browser.close()

const converter = await createConverter()
const result = converter.convertStyles(toStyleInputs(captures))
console.log(result.className)
// cursor-pointer rounded-sm border … md:rounded-[4.5px] … [&:hover]:bg-[rgb(2,101,154)]
```

The script loads the page once per width, so every element on that page is captured again at every width. For many elements, capture them all after each load instead.

### Converting in a serverless function

Captures are often converted on a server. `createConverter` reads Tailwind's stylesheets from `tailwind.base`, which is the working directory by default. In a bundled function (a Convex Node action, a Lambda) the working directory isn't the project, so it throws `TFC903` even though `tailwindcss` itself loads. Install `tailwindcss` with the function (Convex: `externalPackages`), and resolve the stylesheets from the package:

```ts
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { createConverter } from 'tailwind-from-css'

const base = dirname(createRequire(import.meta.url).resolve('tailwindcss/package.json'))
// Once per instance: loading the design system takes a second or two.
const converter = await createConverter({ tailwind: { base } })
```

`pruneStyles` imports the same entry, which loads Node modules, so it runs where the converter does, not in a browser extension.

## What the result means

- **Exact at the captured widths and states.** `result.exact` and verification hold for the declarations you passed in. The pruning and layering above decide which declarations those are. Elsewhere (a width between two captures, a state you didn't force), the classes show what the nearest captured context showed.
- **Arbitrary values are normal.** Captured values are whatever the page computed: `text-[rgb(1,114,173)]`, `pt-[13.5px]`. A site built with Tailwind gives theme classes back (`bg-indigo-600`, `text-sm/5`), because its colors and sizes are the theme's. Run with `mode: 'nearest'` to snap the rest to the theme within a tolerance.
- **What can't come back:** authored values that compute away (`grid-cols-3` becomes track sizes, `mx-auto` becomes px margins, `rounded-full` becomes `3.35544e+07px` in Chromium), and shorthands whose longhands were pruned separately.
