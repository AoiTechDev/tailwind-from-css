// TESTING §2.3: fixture-driven conversions. `<case>.input.json` holds the `StyleInput` (or list)
// of one element; `<case>.expected.json` is the reviewed result (stable fields only, no
// messages). `pnpm test:golden --update` rewrites expectations; review the diff like code.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createConverter } from '../../src/converter.ts'
import type { ConversionResult, Converter, ConverterOptions, StyleInput } from '../../src/types.ts'
import { FIXTURES, type TailwindFixture } from '../helpers/design-system.ts'

const GOLDEN = import.meta.dirname
const INPUT = '.input.json'

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

function optionsOf(suite: string): ConverterOptions {
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

const sourceText = (source: {
  property: string
  value: string
  important: boolean
  selector: string
  conditions: string[]
}): string =>
  [
    ...source.conditions,
    source.selector === '&' ? '' : source.selector,
    `${source.property}: ${source.value}${source.important ? ' !important' : ''}`,
  ]
    .filter((part) => part !== '')
    .join(' | ')

/** The reviewed part of a result. */
function stable(result: ConversionResult): string {
  const expected = {
    className: result.className,
    mappings: result.mappings.map((mapping) => [
      mapping.className,
      mapping.kind,
      ...mapping.sources.map(sourceText),
    ]),
    unconverted: result.unconverted.map((entry) => [entry.code, sourceText(entry)]),
    diagnostics: result.diagnostics.map((diagnostic) => diagnostic.code),
    exact: result.exact,
  }
  return `${JSON.stringify(expected, null, 2)}\n`
}

const suites = readdirSync(GOLDEN, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

for (const suite of suites) {
  const cases = readdirSync(resolve(GOLDEN, suite))
    .filter((file) => file.endsWith(INPUT))
    .map((file) => file.slice(0, -INPUT.length))
    .sort()

  describe(suite, () => {
    let converter: Converter
    beforeAll(async () => {
      converter = await createConverter(optionsOf(suite))
    }, 60_000)

    it.each(cases)('%s', async (name) => {
      const input: StyleInput | StyleInput[] = JSON.parse(
        readFileSync(resolve(GOLDEN, suite, `${name}${INPUT}`), 'utf8'),
      )
      const result = converter.convertStyles(input)
      const codes = result.diagnostics.map((diagnostic) => diagnostic.code)
      expect(codes).not.toContain('TFC501')
      expect(codes).not.toContain('TFC502')
      expect(result.mappings.filter((mapping) => mapping.relaxation !== undefined)).toEqual([])
      if (suite === 'exact') expect(result.exact).toBe(true)
      await expect(stable(result)).toMatchFileSnapshot(
        resolve(GOLDEN, suite, `${name}.expected.json`),
      )
    })
  })
}
