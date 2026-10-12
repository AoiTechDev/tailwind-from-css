// TESTING §2.3: fixture-driven conversions. `<case>.input.json` holds the `StyleInput` (or list)
// of one element, `<case>.css` a stylesheet; `<case>.expected.json` is the reviewed result
// (stable fields only, no messages). `pnpm test:golden --update` rewrites expectations; review
// the diff like code.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createConverter } from '../../src/converter.ts'
import type {
  ConversionResult,
  Converter,
  ConverterOptions,
  CssConversionResult,
  SourceRef,
  StyleInput,
} from '../../src/types.ts'
import {
  GOLDEN,
  goldenCases,
  goldenSuites,
  INPUT,
  STYLESHEET,
  suiteOptions,
} from '../helpers/golden.ts'

const sourceText = (source: SourceRef): string =>
  [
    source.line === undefined ? '' : `${source.line}:${source.column}`,
    ...source.conditions,
    source.selector === '&' ? '' : source.selector,
    `${source.property}: ${source.value}${source.important ? ' !important' : ''}`,
  ]
    .filter((part) => part !== '')
    .join(' | ')

/** The reviewed part of a result. */
const stableResult = (result: ConversionResult) => ({
  className: result.className,
  mappings: result.mappings.map((mapping) => [
    mapping.className,
    mapping.kind,
    ...mapping.sources.map(sourceText),
    ...(mapping.relaxation === undefined
      ? []
      : [{ relaxation: mapping.relaxation.name, delta: mapping.relaxation.delta }]),
  ]),
  unconverted: result.unconverted.map((entry) => [entry.code, sourceText(entry)]),
  diagnostics: result.diagnostics.map((diagnostic) => diagnostic.code),
  exact: result.exact,
})

/** The reviewed part of a stylesheet result: `{ rules: [...] }` plus what stays CSS. */
const stableSheet = (result: CssConversionResult) => ({
  rules: result.rules.map((rule) => ({
    subject: rule.subject,
    selectors: rule.selectors,
    ...stableResult(rule.result),
  })),
  passthroughCss: result.passthroughCss,
  diagnostics: result.diagnostics.map((diagnostic) => diagnostic.code),
})

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

// ADR-0004: only a suite whose options enable relaxations may have any.
const relaxes = (options: ConverterOptions): boolean =>
  options.mode === 'nearest' || (options.relax ?? []).some((name) => !name.startsWith('!'))

function expectVerified(suite: string, result: ConversionResult): void {
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code)
  expect(codes).not.toContain('TFC501')
  expect(codes).not.toContain('TFC502')
  if (!relaxes(suiteOptions(suite))) {
    expect(result.mappings.filter((mapping) => mapping.relaxation !== undefined)).toEqual([])
    expect(codes).not.toContain('TFC203')
  }
  if (suite === 'exact') expect(result.exact).toBe(true)
}

for (const suite of goldenSuites()) {
  const cases = goldenCases(suite, INPUT)
  const stylesheets = goldenCases(suite, STYLESHEET)

  describe(suite, () => {
    let converter: Converter
    beforeAll(async () => {
      converter = await createConverter(suiteOptions(suite))
    }, 60_000)

    it.each(cases)('%s', async (name) => {
      const input: StyleInput | StyleInput[] = JSON.parse(
        readFileSync(resolve(GOLDEN, suite, `${name}${INPUT}`), 'utf8'),
      )
      const result = converter.convertStyles(input)
      expectVerified(suite, result)
      await expect(json(stableResult(result))).toMatchFileSnapshot(
        resolve(GOLDEN, suite, `${name}.expected.json`),
      )
    })

    it.each(stylesheets)('%s.css', async (name) => {
      const css = readFileSync(resolve(GOLDEN, suite, `${name}${STYLESHEET}`), 'utf8')
      const result = converter.convertCss(css)
      for (const rule of result.rules) expectVerified(suite, rule.result)
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('TFC101')
      await expect(json(stableSheet(result))).toMatchFileSnapshot(
        resolve(GOLDEN, suite, `${name}.expected.json`),
      )
    })
  })
}
