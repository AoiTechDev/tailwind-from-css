import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pruneStyles } from '../../src/prune.ts'
import type { ConverterOptions, Declaration, PruneOptions, StyleInput } from '../../src/types.ts'
import { FIXTURES, REPO_ROOT, type TailwindFixture } from './design-system.ts'

export const GOLDEN: string = resolve(REPO_ROOT, 'test', 'golden')
export const INPUT = '.input.json'
export const STYLESHEET = '.css'

interface SuiteConfig {
  /** Converter options; `tailwind.base` is relative to the suite directory. */
  readonly options?: ConverterOptions
  /** Loads `test/fixtures/tailwind/<fixture>/tailwind.css`, then `css`. */
  readonly fixture?: TailwindFixture
  /** Entry CSS, or CSS added after the fixture's. */
  readonly css?: string
  /** Directory `css` resolves from, relative to the suite directory. */
  readonly base?: string
  /** Suite whose `<case>.capture.json` files this suite converts (same captures, other options). */
  readonly captures?: string
}

const suiteConfig = (suite: string): SuiteConfig => {
  const path = resolve(GOLDEN, suite, '_config.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
}

/** Converter options of a golden suite, from its optional `_config.json`. */
export function suiteOptions(suite: string): ConverterOptions {
  const config = suiteConfig(suite)
  const options = config.options ?? {}
  if (config.fixture === undefined) {
    if (config.css === undefined) return options
    return {
      ...options,
      tailwind: { css: config.css, base: resolve(GOLDEN, suite, config.base ?? '.') },
    }
  }
  return {
    ...options,
    tailwind: {
      css: `@import "./tailwind.css";\n${config.css ?? ''}`,
      base: resolve(FIXTURES, 'tailwind', config.fixture),
    },
  }
}

/** Suite directories, sorted. */
export const goldenSuites = (): string[] =>
  readdirSync(GOLDEN, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

/** Case names of a suite with the given input extension, sorted. */
export const goldenCases = (suite: string, extension: string): string[] =>
  readdirSync(resolve(GOLDEN, extension === CAPTURE ? captureSuite(suite) : suite))
    .filter((file) => file.endsWith(extension))
    .map((file) => file.slice(0, -extension.length))
    .sort()

export const CAPTURE = '.capture.json'

const captureSuite = (suite: string): string => suiteConfig(suite).captures ?? suite

type Style = Record<string, string>

interface CaptureWidth {
  readonly width: number
  /** Ids into `styles`: the element, its parent, its baseline, each state and pseudo-element. */
  readonly styles: string
  /** Missing for the root element. */
  readonly parent?: string
  readonly baseline: string
  readonly states?: Readonly<Record<string, string>>
  readonly pseudos?: Readonly<
    Record<string, { readonly styles: string; readonly baseline: string }>
  >
}

interface CaptureElement {
  readonly name: string
  readonly tag: string
  /** Passed to `pruneStyles` as `keep`: sizes known to be authored, kept even when they vary. */
  readonly keep?: readonly string[]
  readonly widths: readonly CaptureWidth[]
}

interface Capture {
  /** The most frequent value of each property. */
  readonly common: Readonly<Style>
  /** Differences from `common`, or from the style named by `@base`; `null` = not listed. */
  readonly styles: Readonly<Record<string, Readonly<Record<string, string | null>>>>
  readonly elements: readonly CaptureElement[]
}

/** One captured element, pruned the way SPEC §9 recommends, ready for `convertStyles`. */
export interface CapturedElement {
  readonly name: string
  readonly tag: string
  readonly input: StyleInput[]
}

// Chromium gives a document inside an iframe `app-region: no-drag` (the page has `none`), so an
// iframe baseline can't serve as its reference; no captured page sets it.
const FRAME_ONLY = ['app-region']

// Computed styles resolve these to used px: the box's size, and a grid container's track sizes.
const SIZES: Readonly<Record<string, readonly string[]>> = {
  width: ['width', 'inline-size'],
  height: ['height', 'block-size'],
  'grid-template-columns': ['grid-template-columns'],
  'grid-template-rows': ['grid-template-rows'],
}

/** What to drop at every width: frame-only values, and used sizes that differ between widths
 * (layout results, not authored values). */
const fluidSizes = (styles: readonly Style[], keep: readonly string[]): string[] => [
  ...FRAME_ONLY,
  ...Object.entries(SIZES)
    .filter(
      ([size]) => !keep.includes(size) && new Set(styles.map((style) => style[size])).size > 1,
    )
    .flatMap(([, properties]) => properties),
]

interface Pruned {
  /** The computed style at this width. */
  readonly raw: Style
  readonly kept: Declaration[]
}

/**
 * Mobile-first layers of one selector: the narrowest width's declarations unconditioned, then at
 * each wider width what changed since, under `@media (width >= …)`, including a reset to the
 * computed value where an earlier layer set something this width doesn't show.
 */
function responsive(
  selector: string,
  widths: readonly number[],
  pruned: readonly Pruned[],
): StyleInput[] {
  const inputs: StyleInput[] = []
  const shown = new Map<string, string>()
  pruned.forEach(({ raw, kept }, index) => {
    const names = new Set(kept.map((declaration) => declaration.property))
    const declarations =
      index === 0
        ? kept
        : kept.filter((declaration) => shown.get(declaration.property) !== declaration.value)
    if (index > 0) {
      for (const [property, value] of shown) {
        const now = raw[property]
        if (!names.has(property) && now !== undefined && now !== value)
          declarations.push({ property, value: now })
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

/**
 * The elements of a computed-style capture (`<case>.capture.json`), captured at several viewport
 * widths: at each width, the base state pruned against the parent and the baseline, each state
 * against the element's own base state, each pseudo-element against the element and its own
 * baseline; used sizes that differ between widths dropped; then the widths layered mobile-first.
 */
export function capturedElements(suite: string, name: string): CapturedElement[] {
  const capture: Capture = JSON.parse(
    readFileSync(resolve(GOLDEN, captureSuite(suite), `${name}${CAPTURE}`), 'utf8'),
  )
  const resolved = new Map<string, Style>()
  const style = (id: string): Style => {
    const cached = resolved.get(id)
    if (cached !== undefined) return cached
    const { '@base': base, ...differences } = capture.styles[id] ?? {}
    const merged: Record<string, string | null> = {
      ...(base ? style(base) : capture.common),
      ...differences,
    }
    const out = Object.fromEntries(
      Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== null),
    )
    resolved.set(id, out)
    return out
  }
  return capture.elements.map((element) => {
    const widths = [...element.widths].sort((a, b) => a.width - b.width)
    const px = widths.map((width) => width.width)
    const keep = [...(element.keep ?? [])]
    const prune = (id: string, options: PruneOptions): Pruned => ({
      raw: style(id),
      kept: pruneStyles(style(id), options),
    })
    const drop = fluidSizes(
      widths.map((width) => style(width.styles)),
      keep,
    )
    const selectors = Object.keys(widths[0]?.states ?? {})
    const input = responsive(
      '&',
      px,
      widths.map((width) =>
        prune(width.styles, {
          ...(width.parent === undefined ? {} : { parent: style(width.parent) }),
          baseline: style(width.baseline),
          keep,
          drop,
          states: selectors.map((selector) => style(stateOf(width, selector))),
        }),
      ),
    )
    // `keep` names authored base values; a state only needs what changes.
    for (const selector of selectors) {
      const states = widths.map((width) =>
        prune(stateOf(width, selector), { baseline: style(width.styles), drop, states: [] }),
      )
      input.push(...responsive(selector, px, states))
    }
    for (const selector of Object.keys(widths[0]?.pseudos ?? {})) {
      const pseudos = widths.map((width) => ({ width, pseudo: pseudoOf(width, selector) }))
      const pseudoDrop = fluidSizes(
        pseudos.map(({ pseudo }) => style(pseudo.styles)),
        keep,
      )
      const pruned = pseudos.map(({ width, pseudo }) =>
        prune(pseudo.styles, {
          parent: style(width.styles),
          baseline: style(pseudo.baseline),
          keep,
          drop: pseudoDrop,
          states: [],
        }),
      )
      input.push(...responsive(selector, px, pruned))
    }
    return { name: element.name, tag: element.tag, input }
  })
}

const stateOf = (width: CaptureWidth, selector: string): string => {
  const id = width.states?.[selector]
  if (id === undefined) throw new Error(`no ${selector} at ${width.width}px`)
  return id
}

const pseudoOf = (width: CaptureWidth, selector: string): { styles: string; baseline: string } => {
  const pseudo = width.pseudos?.[selector]
  if (pseudo === undefined) throw new Error(`no ${selector} at ${width.width}px`)
  return pseudo
}
