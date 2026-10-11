// Tailwind 4.3 optimizes the selectors 4.2 printed verbatim (`:not(*:hover)` → `:not(:hover)`,
// `>p` → ` > p`). Normalization (SPEC §6, N50) must make every supported version print the same.
import { beforeAll, expect, it } from 'vitest'
import { normalizeSelector } from '../../src/css/selector.ts'
import type { TailwindDesignSystem } from '../../src/tailwind/adapter.ts'
import { designSystem } from '../helpers/design-system.ts'

let ds: TailwindDesignSystem

beforeAll(async () => {
  ds = await designSystem()
})

it.each([
  ['not-hover:flex', '.not-hover\\:flex:not(:hover)'],
  ['has-checked:flex', '.has-checked\\:flex:has(:checked)'],
  ['[&>p]:flex', '.\\[\\&\\>p\\]\\:flex > p'],
  ['not-first:flex', '.not-first\\:flex:not(:first-child)'],
])('%s normalizes to one selector on every version', (candidate, expected) => {
  const [ast] = ds.toAst([candidate])
  expect(ast?.rules.map((rule) => normalizeSelector(rule.selector))).toContain(expected)
})
