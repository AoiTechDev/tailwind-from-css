import { describe, expect, it } from 'vitest'
import { type ReportInput, report } from '../../src/report.ts'
import type { SourceRef } from '../../src/types.ts'

const source = (property: string, value: string, extra: Partial<SourceRef> = {}): SourceRef => ({
  property,
  value,
  important: false,
  selector: '&',
  conditions: [],
  ...extra,
})

const ORDER: Readonly<Record<string, bigint>> = { 'p-4': 1n, 'mt-2': 2n, 'text-[#ef4444]': 3n }
const classOrder = (classes: readonly string[]): (bigint | null)[] =>
  classes.map((name) => ORDER[name] ?? null)

const empty: ReportInput = { sources: [], classes: [], unconverted: [], notes: [] }

describe('report (SPEC §5.9)', () => {
  it('reports nothing for no input', () => {
    expect(report(empty, classOrder)).toEqual({
      className: '',
      classes: [],
      mappings: [],
      unconverted: [],
      diagnostics: [],
      exact: true,
    })
  })

  it('sorts classes by Tailwind order, unknown ones last by name, and deduplicates', () => {
    const sources = [source('margin-top', '8px'), source('padding', '16px'), source('x', 'y')]
    const result = report(
      {
        ...empty,
        sources,
        classes: [
          { className: 'zz', kind: 'arbitrary-property', sources: [2] },
          { className: 'mt-2', kind: 'bare', sources: [0] },
          { className: 'aa', kind: 'arbitrary-property', sources: [2] },
          { className: 'p-4', kind: 'bare', sources: [1] },
          { className: 'mt-2', kind: 'bare', sources: [0, 1] },
        ],
      },
      classOrder,
    )
    expect(result.classes).toEqual(['p-4', 'mt-2', 'aa', 'zz'])
    expect(result.className).toBe('p-4 mt-2 aa zz')
    expect(result.mappings[1]).toEqual({
      className: 'mt-2',
      kind: 'bare',
      sources: [sources[0], sources[1]],
    })
  })

  it('copies sources, so changing the result changes nothing else', () => {
    const sources = [source('padding', '16px', { conditions: ['@media print'] })]
    const result = report(
      { ...empty, sources, classes: [{ className: 'p-4', kind: 'bare', sources: [0] }] },
      classOrder,
    )
    result.mappings[0]?.sources[0]?.conditions.push('@media screen')
    expect(sources[0]?.conditions).toEqual(['@media print'])
  })

  it('reports arbitrary values and properties as TFC201 and TFC202', () => {
    const result = report(
      {
        ...empty,
        sources: [source('color', '#ef4444'), source('foo', 'bar')],
        classes: [
          { className: '[foo:bar]', kind: 'arbitrary-property', sources: [1] },
          { className: 'text-[#ef4444]', kind: 'arbitrary-value', sources: [0] },
          { className: 'text-(--x)', kind: 'variable', sources: [0] },
        ],
      },
      classOrder,
    )
    expect(result.diagnostics.map((d) => [d.code, d.severity, d.source?.property])).toEqual([
      ['TFC201', 'info', 'color'],
      ['TFC202', 'info', 'foo'],
    ])
    expect(result.exact).toBe(true)
  })

  it('lists unconverted declarations, as written or per longhand, and is then not exact', () => {
    const sources = [
      source('margin', '0 auto', { selector: '&:hover' }),
      source('color', 'red'),
      source('bad', ''),
    ]
    const result = report(
      {
        ...empty,
        sources,
        unconverted: [
          { source: 2, code: 'TFC102' },
          { source: 0, code: 'TFC204', longhand: { property: 'margin-left', value: 'auto' } },
          { source: 0, code: 'TFC204', longhand: { property: 'margin-left', value: 'auto' } },
          { source: 1, code: 'TFC303' },
        ],
      },
      classOrder,
    )
    expect(result.unconverted).toEqual([
      { ...source('margin-left', 'auto', { selector: '&:hover' }), code: 'TFC204' },
      { ...source('color', 'red'), code: 'TFC303' },
      { ...source('bad', ''), code: 'TFC102' },
    ])
    expect(result.diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ['TFC204', 'warning'],
      ['TFC303', 'warning'],
      ['TFC102', 'warning'],
    ])
    expect(result.exact).toBe(false)
  })

  it('reports notes once each, sorted by source then code', () => {
    const sources = [source('-webkit-user-select', 'none'), source('color', 'red')]
    const result = report(
      {
        ...empty,
        sources,
        notes: [
          { source: 1, code: 'TFC501' },
          { source: 1, code: 'TFC106' },
          { source: 0, code: 'TFC105' },
          { source: 0, code: 'TFC105' },
          { source: 0, code: 'TFC302' },
          { source: 0, code: 'TFC301' },
        ],
      },
      classOrder,
    )
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'TFC105',
      'TFC301',
      'TFC302',
      'TFC106',
      'TFC501',
    ])
    expect(result.exact).toBe(true)
  })

  it('writes deterministic messages that name the declaration and its context', () => {
    const input: ReportInput = {
      ...empty,
      sources: [
        source('color', 'red', { important: true, selector: '&:hover', conditions: ['@media x'] }),
      ],
      notes: [
        { source: 0, code: 'TFC105' },
        { source: 0, code: 'TFC106' },
        { source: 0, code: 'TFC301' },
        { source: 0, code: 'TFC302' },
        { source: 0, code: 'TFC501' },
      ],
      unconverted: [
        { source: 0, code: 'TFC102' },
        { source: 0, code: 'TFC204' },
        { source: 0, code: 'TFC303' },
        { source: 0, code: 'TFC502' },
      ],
    }
    const messages = report(input, classOrder).diagnostics.map((d) => d.message)
    expect(report(input, classOrder).diagnostics.map((d) => d.message)).toEqual(messages)
    expect(new Set(messages).size).toBe(messages.length)
    for (const message of messages) expect(message).toMatch(/@media x \{ &:hover \}/)
    expect(messages.filter((m) => m.includes('"color: red !important"'))).toHaveLength(7)
  })
})
