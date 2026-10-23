// SPEC §5.4 on a hand-written design system: the matcher's rules, independent of Tailwind's output.
import { describe, expect, it } from 'vitest'
import {
  createMatcher,
  type Matcher,
  type MatchResult,
  matchDeclarations,
  matchInput,
  overriddenDeclarations,
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

describe('matchInput: shorthands kept whole', () => {
  const summary = (declarations: Declaration[]): string[] =>
    matchInput(declarations, OPTIONS).map((entry) => `${entry.property} ${entry.source}`)

  it('lets a later whole shorthand override the longhands it covers', () => {
    const declarations: Declaration[] = [
      { property: 'padding', value: '0' },
      { property: 'padding', value: 'calc(var(--x) * 0.5) 0' },
      { property: 'padding-left', value: 'var(--y)' },
    ]
    expect(summary(declarations)).toEqual(['padding 1', 'padding-left 2'])
    expect(overriddenDeclarations(3, matchInput(declarations, OPTIONS))).toEqual([0])
    expect(
      summary([
        { property: 'border-color', value: 'red' },
        { property: 'border', value: 'var(--b)' },
      ]),
    ).toEqual(['border 1'])
  })

  it('drops a whole shorthand whose longhands are all set later', () => {
    const declarations: Declaration[] = [
      { property: 'border-radius', value: 'var(--r)' },
      { property: 'border-radius', value: '0' },
    ]
    expect(summary(declarations)).toEqual([
      'border-bottom-left-radius 1',
      'border-bottom-right-radius 1',
      'border-top-left-radius 1',
      'border-top-right-radius 1',
    ])
    expect(overriddenDeclarations(2, matchInput(declarations, OPTIONS))).toEqual([0])
    expect(
      summary([
        { property: 'text-decoration', value: 'var(--t)' },
        { property: 'text-decoration-line', value: 'underline' },
        { property: 'text-decoration-style', value: 'solid' },
        { property: 'text-decoration-color', value: 'red' },
      ]),
    ).toContain('text-decoration 0')
  })

  it('drops a later longhand that an important whole shorthand covers', () => {
    const declarations: Declaration[] = [
      { property: 'padding', value: 'var(--x)', important: true },
      { property: 'padding-top', value: '0' },
    ]
    expect(summary(declarations)).toEqual(['padding 0'])
    expect(overriddenDeclarations(2, matchInput(declarations, OPTIONS))).toEqual([1])
  })

  it('keeps important longhands and longhands written after the shorthand', () => {
    expect(
      summary([
        { property: 'padding-top', value: '0', important: true },
        { property: 'padding', value: 'var(--x)' },
        { property: 'padding-right', value: '4px' },
      ]),
    ).toEqual(['padding 1', 'padding-right 2', 'padding-top 0'])
  })
})

describe('overriddenDeclarations (TFC106)', () => {
  it('lists the declarations that win no longhand', () => {
    const declarations: Declaration[] = [
      { property: 'color', value: 'red' },
      { property: 'padding', value: '16px' },
      { property: 'color', value: 'blue' },
      { property: 'padding-top', value: '8px' },
    ]
    expect(overriddenDeclarations(4, matchInput(declarations, OPTIONS))).toEqual([0])
    expect(overriddenDeclarations(0, [])).toEqual([])
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

  it('gives every class the variant chain', () => {
    const result = matchDeclarations(
      matcher(spacing),
      matchInput([{ property: 'padding', value: '16px', important: true }], OPTIONS),
      ['md', '[&:hover]'],
    )
    expect(names(result)).toEqual(['md:[&:hover]:p-4!'])
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

  it('never uses an important class that writes a vendor copy the block sets as normal', () => {
    const on = matcher({
      classList: ['select-none'],
      candidates: {
        'select-none': plain('select-none', ['-webkit-user-select: none', 'user-select: none']),
        '[user-select:none]': plain('[user-select:none]', ['user-select: none']),
        '[-webkit-user-select:none]': plain('[-webkit-user-select:none]', [
          '-webkit-user-select: none',
        ]),
      },
    })
    expect(
      names(
        match(on, [
          { property: 'user-select', value: 'none', important: true },
          { property: '-webkit-user-select', value: 'none' },
        ]),
      ),
    ).toEqual(['[-webkit-user-select:none]', '[user-select:none]!'])
    expect(
      names(
        match(on, [
          { property: 'user-select', value: 'none' },
          { property: '-webkit-user-select', value: 'none', important: true },
        ]),
      ),
    ).toEqual(['select-none', '[-webkit-user-select:none]!'])
    expect(
      names(
        match(on, [
          { property: 'user-select', value: 'none', important: true },
          { property: '-webkit-user-select', value: 'none', important: true },
        ]),
      ),
    ).toEqual(['select-none!'])
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
    expect(match(on, [{ property: 'color', value: 'blue' }])).toMatchObject({
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

// Forms Tailwind's own canonicalization finds (TESTING §2.5): every value form a functional root
// takes, and type hints only where they describe the value.
describe('matchDeclarations: functional roots for every value form', () => {
  const probeOf = (root: string, declaration: string) => ({
    [`${root}-(--tfc-probe)`]: plain(`${root}-(--tfc-probe)`, [declaration]),
  })
  const on = matcher({
    theme: { '--spacing': '4px' },
    classList: [
      'p-4',
      'pt-4',
      'py-4',
      'ml-1',
      '-ml-1',
      'rounded-sm',
      'leading-7',
      'text-sm',
      'text-black',
      'shadow-sm',
      'bg-red',
      'bg-cover',
      'bg-left',
      'font-bold',
      'font-sans',
    ],
    modifiers: { 'text-sm': ['tight'] },
    roots: [
      'p',
      'pt',
      'py',
      'ml',
      '-ml',
      'rounded',
      'leading',
      'text',
      'shadow',
      'bg',
      'bg-size',
      'bg-position',
      'filter',
      'font',
    ],
    candidates: {
      'p-4': plain('p-4', ['padding: 16px']),
      'pt-4': plain('pt-4', ['padding-top: 16px']),
      'py-4': plain('py-4', ['padding-block: 16px']),
      'ml-1': plain('ml-1', ['margin-left: 4px']),
      '-ml-1': plain('-ml-1', ['margin-left: -4px']),
      'rounded-sm': plain('rounded-sm', ['border-radius: 2px']),
      'leading-7': plain('leading-7', ['line-height: 28px']),
      'text-sm': plain('text-sm', ['font-size: 14px', 'line-height: 20px']),
      'text-black': plain('text-black', ['color: black']),
      'shadow-sm': plain('shadow-sm', ['box-shadow: 0 1px 2px black']),
      'bg-red': plain('bg-red', ['background-color: red']),
      'bg-cover': plain('bg-cover', ['background-size: cover']),
      'bg-left': plain('bg-left', ['background-position: left']),
      'font-bold': plain('font-bold', ['font-weight: 700']),
      'font-sans': plain('font-sans', ['font-family: sans-serif']),
      ...probeOf('bg-size', 'background-size: var(--tfc-probe)'),
      ...probeOf('bg-position', 'background-position: var(--tfc-probe)'),
      ...probeOf('filter', 'filter: var(--tfc-probe)'),
      'p-(--p)': plain('p-(--p)', ['padding: var(--p)']),
      'pt-(--p)': plain('pt-(--p)', ['padding-top: var(--p)']),
      'p-[var(--a)_var(--b)]': plain('p-[var(--a)_var(--b)]', ['padding: var(--a) var(--b)']),
      'py-(--y)': plain('py-(--y)', ['padding-block: var(--y)']),
      'rounded-(--r)': plain('rounded-(--r)', ['border-radius: var(--r)']),
      'filter-[brightness(0)_invert(1)]': plain('filter-[brightness(0)_invert(1)]', [
        'filter: brightness(0) invert(1)',
      ]),
      '-ml-(--x)': plain('-ml-(--x)', ['margin-left: calc(var(--x) * -1)']),
      'ml-[calc(var(--x)_*_-1)]': plain('ml-[calc(var(--x)_*_-1)]', [
        'margin-left: calc(var(--x) * -1)',
      ]),
      'shadow-(--s,0_0_0_red)': plain('shadow-(--s,0_0_0_red)', ['box-shadow: var(--s,0 0 0 red)']),
      'shadow-[var(--s,0_0_0_red)]': plain('shadow-[var(--s,0_0_0_red)]', [
        'box-shadow: var(--s,0 0 0 red)',
      ]),
      'text-sm/(--lh)': plain('text-sm/(--lh)', ['font-size: 14px', 'line-height: var(--lh)']),
      'text-sm/[var(--lh)]': plain('text-sm/[var(--lh)]', [
        'font-size: 14px',
        'line-height: var(--lh)',
      ]),
      'text-[18.2px]': plain('text-[18.2px]', ['font-size: 18.2px']),
      'text-[18.2px]/7': plain('text-[18.2px]/7', ['font-size: 18.2px', 'line-height: 28px']),
      'text-[#123456]': plain('text-[#123456]', ['color: #123456']),
      'bg-size-[auto_16px]': plain('bg-size-[auto_16px]', ['background-size: auto 16px']),
      'bg-[auto_16px]': plain('bg-[auto_16px]', ['background-size: auto 16px']),
      'bg-position-[var(--x)_left]': plain('bg-position-[var(--x)_left]', [
        'background-position: var(--x) left',
      ]),
      // Tailwind reads a value with a variable as a color unless a hint says otherwise.
      'bg-[var(--x)_left]': plain('bg-[var(--x)_left]', ['background-color: var(--x) left']),
      'bg-[position:var(--x)_left]': plain('bg-[position:var(--x)_left]', [
        'background-position: var(--x) left',
      ]),
      'font-[bolder]': plain('font-[bolder]', ['font-family: bolder']),
      'font-[color:bolder]': plain('font-[color:bolder]', ['font-weight: bolder']),
      '[font-weight:bolder]': plain('[font-weight:bolder]', ['font-weight: bolder']),
      'font-(--f)': plain('font-(--f)', ['font-weight: var(--f)']),
      'font-(color:--f)': plain('font-(color:--f)', ['font-weight: var(--f)']),
      'font-(family-name:--f)': plain('font-(family-name:--f)', ['font-family: var(--f)']),
    },
  })
  const classes = (declarations: Declaration[]): string[] => names(match(on, declarations))

  it('gives a shorthand kept whole the root that sets all of its longhands', () => {
    expect(classes([{ property: 'padding', value: 'var(--p)' }])).toEqual(['p-(--p)'])
    expect(classes([{ property: 'padding', value: 'var(--a) var(--b)' }])).toEqual([
      'p-[var(--a)_var(--b)]',
    ])
    expect(classes([{ property: 'padding-block', value: 'var(--y)' }])).toEqual(['py-(--y)'])
    expect(classes([{ property: 'border-radius', value: 'var(--r)' }])).toEqual(['rounded-(--r)'])
  })

  it('uses roots that have no listed candidate', () => {
    expect(classes([{ property: 'filter', value: 'brightness(0) invert(1)' }])).toEqual([
      'filter-[brightness(0)_invert(1)]',
    ])
  })

  it('writes a negated variable with the negative root', () => {
    expect(classes([{ property: 'margin-left', value: 'calc(var(--x) * -1)' }])).toEqual([
      '-ml-(--x)',
    ])
  })

  it('writes a variable with a fallback in the variable form', () => {
    expect(classes([{ property: 'box-shadow', value: 'var(--s, 0 0 0 red)' }])).toEqual([
      'shadow-(--s,0_0_0_red)',
    ])
  })

  it('writes a variable modifier in the variable form', () => {
    const result = match(on, [
      { property: 'font-size', value: '14px' },
      { property: 'line-height', value: 'var(--lh)' },
    ])
    expect(names(result)).toEqual(['text-sm/(--lh)'])
    expect(result.matches[0]?.kind).toBe('variable')
  })

  it('gives an arbitrary value a modifier for a longhand another class set', () => {
    const result = match(on, [
      { property: 'font-size', value: '18.2px' },
      { property: 'line-height', value: '28px' },
    ])
    expect(names(result)).toEqual(['text-[18.2px]/7'])
    expect(result.matches[0]).toMatchObject({ kind: 'arbitrary-value', declarations: [0, 1] })
    // `text-[#123456]/7` doesn't compile: the classes stay apart.
    expect(
      classes([
        { property: 'color', value: '#123456' },
        { property: 'line-height', value: '28px' },
      ]),
    ).toEqual(['leading-7', 'text-[#123456]'])
  })

  it('prefers the root of the longhand to a root that reads the value by its type', () => {
    expect(classes([{ property: 'background-size', value: 'auto 16px' }])).toEqual([
      'bg-size-[auto_16px]',
    ])
    expect(classes([{ property: 'background-position', value: 'var(--x) left' }])).toEqual([
      'bg-position-[var(--x)_left]',
    ])
  })

  it('uses a type hint only for a value with a variable', () => {
    // `font-[color:bolder]` sets font-weight, but bolder is no color.
    expect(classes([{ property: 'font-weight', value: 'bolder' }])).toEqual([
      '[font-weight:bolder]',
    ])
    expect(classes([{ property: 'font-family', value: 'var(--f)' }])).toEqual([
      'font-(family-name:--f)',
    ])
  })
})
