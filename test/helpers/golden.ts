import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pruneStyles } from '../../src/prune.ts'
import type { ConverterOptions, StyleInput } from '../../src/types.ts'
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
}

/** Converter options of a golden suite, from its optional `_config.json`. */
export function suiteOptions(suite: string): ConverterOptions {
  const path = resolve(GOLDEN, suite, '_config.json')
  const config: SuiteConfig = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
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
  readdirSync(resolve(GOLDEN, suite))
    .filter((file) => file.endsWith(extension))
    .map((file) => file.slice(0, -extension.length))
    .sort()

export const CAPTURE = '.capture.json'

interface CaptureElement {
  readonly name: string
  readonly tag: string
  /** Ids into `styles`: the element, its parent, its baseline, and each state's computed style. */
  readonly styles: string
  readonly parent: string
  readonly baseline: string
  readonly states: Readonly<Record<string, string>>
}

interface Capture {
  /** The most frequent value of each property; `styles` hold the differences, `null` = not listed. */
  readonly common: Readonly<Record<string, string>>
  readonly styles: Readonly<Record<string, Readonly<Record<string, string | null>>>>
  readonly elements: readonly CaptureElement[]
}

/** One captured element, pruned the way SPEC §9 recommends, ready for `convertStyles`. */
export interface CapturedElement {
  readonly name: string
  readonly tag: string
  readonly input: StyleInput[]
}

/**
 * The elements of a computed-style capture (`<case>.capture.json`): the base state pruned against
 * the parent and the baseline, each state against the element's own base state.
 */
export function capturedElements(suite: string, name: string): CapturedElement[] {
  const capture: Capture = JSON.parse(
    readFileSync(resolve(GOLDEN, suite, `${name}${CAPTURE}`), 'utf8'),
  )
  const style = (id: string): Record<string, string> => {
    const merged = { ...capture.common, ...capture.styles[id] }
    return Object.fromEntries(
      Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== null),
    )
  }
  return capture.elements.map((element) => {
    const base = style(element.styles)
    const states = Object.entries(element.states).map(([selector, id]) => ({
      selector,
      declarations: pruneStyles(style(id), { baseline: base }),
    }))
    const declarations = pruneStyles(base, {
      parent: style(element.parent),
      baseline: style(element.baseline),
    })
    return { name: element.name, tag: element.tag, input: [{ declarations }, ...states] }
  })
}
