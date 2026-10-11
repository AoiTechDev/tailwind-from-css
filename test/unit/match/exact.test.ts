// SPEC §5.4 on a hand-written design system: the matcher's rules, independent of Tailwind's output.
import { describe, expect, it } from 'vitest'
import {
  createMatcher,
  type Matcher,
  type MatchResult,
  matchDeclarations,
  matchInput,
} from '../../../src/match/exact.ts'
import { buildUtilityIndex } from '../../../src/tailwind/index-builder.ts'
import type { Declaration } from '../../../src/types.ts'
import { ast, type FakeDesignInput, fakeDesign, rule } from '../../helpers/fake-design.ts'

const OPTIONS = { rootFontSize: 16 } as const

function matcher(input: FakeDesignInput, important: 'suffix' | 'prefix' = 'suffix'): Matcher {
  const design = fakeDesign(input)
  return createMatcher(design, buildUtilityIndex(design, OPTIONS), { important })
}

const match = (on: Matcher, declarations: Declaration[]): MatchResult =>
  matchDeclarations(on, matchInput(declarations, OPTIONS))

const names = (result: MatchResult): string[] => result.matches.map((entry) => entry.className)

/** A candidate compiled to one plain rule with `declarations`. */
const plain = (candidate: string, declarations: string[]) =>
  ast([rule(`.${candidate.replaceAll(/[^\w-]/g, (char) => `\\${char}`)}`, declarations)])

describe('matchInput', () => {
  it('keeps the winning declaration of each longhand, sorted by property', () => {
    const input = matchInput(
      [
        { property: 'padding', value: '16px' },
        { property: 'padding-top', value: '8px' },
        { property: 'color', value: 'red', important: true },
        { property: 'color', value: 'blue' },
      ],
      OPTIONS,
    )
    expect(input.map((entry) => [entry.property, entry.value, entry.source])).toEqual([
      ['color', 'srgb(255 0 0 / 1)', 2],
      ['padding-bottom', '16px', 0],
      ['padding-left', '16px', 0],
      ['padding-right', '16px', 0],
      ['padding-top', '8px', 1],
    ])
  })

  it('keeps the written value unless the declaration was expanded or uses em', () => {
    const raw = (declarations: Declaration[]): string[] =>
      matchInput(declarations, OPTIONS).map((entry) => `${entry.property}: ${entry.raw}`)
    expect(raw([{ property: 'color', value: '#EF4444' }])).toEqual(['color: #EF4444'])
    expect(raw([{ property: 'word-wrap', value: 'break-word' }])).toEqual([
      'overflow-wrap: break-word',
    ])
    expect(raw([{ property: 'border-top', value: '1px solid #EF4444' }])).toEqual([
      'border-top-color: #ef4444',
      'border-top-style: solid',
      'border-top-width: 1px',
    ])
    expect(
      raw([
        { property: 'width', value: '2em' },
        { property: 'font-size', value: '14px' },
      ]),
    ).toEqual(['font-size: 14px', 'width: 28px'])
    expect(raw([{ property: 'width', value: '2em' }])).toEqual(['width: 2em'])
  })
})

describe('createMatcher', () => {
  it('reads --spacing as a normal length', () => {
    const spacing = (value: string | undefined) =>
      matcher({ candidates: {}, theme: value === undefined ? {} : { '--spacing': value } }).spacing
    expect(spacing('0.25rem')).toEqual({ value: 4, unit: 'px' })
    expect(spacing(undefined)).toBeUndefined()
    expect(spacing('0px')).toBeUndefined()
    expect(spacing('var(--x)')).toBeUndefined()
  })
})

describe('matchDeclarations', () => {
  const spacing: FakeDesignInput = {
    theme: { '--spacing': '4px' },
    classList: ['p-4', 'pt-4', 'text-red', 'text-big', 'size-4', 'flag'],
    roots: ['p', 'pt', 'text', 'size'],
    candidates: {
      'p-4': plain('p-4', ['padding: 16px']),
      'pt-4': plain('pt-4', ['padding-top: 16px']),
      'text-red': plain('text-red', ['color: red']),
      'text-big': plain('text-big', ['font-size: 20px']),
      'size-4': plain('size-4', ['width: 16px', 'height: 16px']),
      flag: plain('flag', ['display: none!']),
      'p-3.25': plain('p-3.25', ['padding: 13px']),
      // also applies on hover, so it can't stand for a base-context declaration
      'p-5': ast([rule('.p-5', ['padding: 20px']), rule('.p-5:hover', ['color: red'])]),
      'p-[20px]': plain('p-[20px]', ['padding: 20px']),
      'text-(--x)': plain('text-(--x)', ['color: var(--x)']),
      'text-(length:--x)': plain('text-(length:--x)', ['font-size: var(--x)']),
      'size-(--x)': plain('size-(--x)', ['width: var(--x)', 'height: var(--x)']),
      '[width:var(--x)]': plain('[width:var(--x)]', ['width: var(--x)']),
      '[display:none]': plain('[display:none]', ['display: none']),
      '[color:blue]': plain('[color:blue]', ['color: red']),
    },
  }

  it('finds whole signatures and covers, then bare values', () => {
    const on = matcher(spacing)
    expect(names(match(on, [{ property: 'padding', value: '16px' }]))).toEqual(['p-4'])
    expect(names(match(on, [{ property: 'padding', value: '13px' }]))).toEqual(['p-3.25'])
    expect(match(on, [{ property: 'padding', value: '13px' }]).matches[0]?.kind).toBe('bare')
  })

  it('skips candidates that also apply in other contexts', () => {
    expect(names(match(matcher(spacing), [{ property: 'padding', value: '20px' }]))).toEqual([
      'p-[20px]',
    ])
  })

  it('never uses a utility whose declarations are important for a normal declaration', () => {
    const on = matcher(spacing)
    expect(names(match(on, [{ property: 'display', value: 'none' }]))).toEqual(['[display:none]'])
    expect(names(match(on, [{ property: 'display', value: 'none', important: true }]))).toEqual([
      'flag!',
    ])
    expect(
      names(
        match(matcher(spacing, 'prefix'), [
          { property: 'display', value: 'none', important: true },
        ]),
      ),
    ).toEqual(['!flag'])
  })

  it('tries type hints only when Tailwind reads the value as another longhand', () => {
    const on = matcher(spacing)
    expect(names(match(on, [{ property: 'font-size', value: 'var(--x)' }]))).toEqual([
      'text-(length:--x)',
    ])
    expect(names(match(on, [{ property: 'color', value: 'var(--x)' }]))).toEqual(['text-(--x)'])
    // `size-(--x)` sets width, but height too.
    expect(names(match(on, [{ property: 'width', value: 'var(--x)' }]))).toEqual([
      '[width:var(--x)]',
    ])
  })

  it('reports an arbitrary property that does not round-trip (TFC204)', () => {
    const on = matcher(spacing)
    expect(match(on, [{ property: 'color', value: 'blue' }])).toEqual({
      matches: [],
      skipped: [{ declaration: 0, code: 'TFC204' }],
    })
    expect(match(on, [{ property: 'color', value: 'green' }]).skipped).toEqual([
      { declaration: 0, code: 'TFC204' },
    ])
  })

  it('tries the listed modifiers and the alpha of a translucent color', () => {
    const on = matcher({
      modifiers: { 'text-sm': ['tight'], 'bg-black': ['50'] },
      classList: ['text-sm', 'bg-black'],
      candidates: {
        'text-sm': plain('text-sm', ['font-size: 14px', 'line-height: 1.4']),
        'text-sm/tight': plain('text-sm/tight', ['font-size: 14px', 'line-height: 1.25']),
        'bg-black': plain('bg-black', ['background-color: black']),
        'bg-black/50': plain('bg-black/50', ['background-color: rgb(0 0 0 / 0.5)']),
        '[font-size:14px]': plain('[font-size:14px]', ['font-size: 14px']),
      },
    })
    expect(
      names(
        match(on, [
          { property: 'font-size', value: '14px' },
          { property: 'line-height', value: '1.25' },
        ]),
      ),
    ).toEqual(['text-sm/tight'])
    expect(names(match(on, [{ property: 'background-color', value: 'rgb(0 0 0 / 50%)' }]))).toEqual(
      ['bg-black/50'],
    )
    // text-sm also sets line-height, which the block doesn't: no modifier can fix that.
    expect(names(match(on, [{ property: 'font-size', value: '14px' }]))).toEqual([
      '[font-size:14px]',
    ])
  })
})
