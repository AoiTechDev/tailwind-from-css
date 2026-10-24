// SPEC §5.4 against the installed Tailwind: CSS of one block → classes, with no relaxations.
// Every result is also checked the way verify will: the classes' effective declarations must
// equal the input's.
import { beforeAll, describe, expect, it } from 'vitest'
import { toDeclarations } from '../../src/css/declarations.ts'
import { normalValuesEqual } from '../../src/css/normalize/index.ts'
import {
  createMatcher,
  type Match,
  type MatchDeclaration,
  type MatchResult,
  matchDeclarations,
  matchInput,
} from '../../src/match/exact.ts'
import type { TailwindDesignSystem } from '../../src/tailwind/adapter.ts'
import { BASE_CONTEXT, effectiveDeclarations } from '../../src/tailwind/effective.ts'
import { buildUtilityIndex, type UtilityIndex } from '../../src/tailwind/index-builder.ts'
import { designSystem, type TailwindFixture } from '../helpers/design-system.ts'

const OPTIONS = { rootFontSize: 16 } as const

interface Conversion {
  readonly input: MatchDeclaration[]
  readonly result: MatchResult
  /** Class names in Tailwind's order. */
  readonly classes: string[]
}

function sortedClasses(design: TailwindDesignSystem, matches: readonly Match[]): string[] {
  const names = matches.map((match) => match.className)
  const orders = design.classOrder(names)
  return names
    .map((name, index) => ({ name, order: orders[index] ?? -1n }))
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.name < b.name ? -1 : 1))
    .map((entry) => entry.name)
}

/** The effective declarations of the classes must equal the input minus what was skipped. */
function expectVerified(design: TailwindDesignSystem, conversion: Conversion): void {
  const skipped = new Set(conversion.result.skipped.map((entry) => entry.declaration))
  const wanted = conversion.input.filter((_, position) => !skipped.has(position))
  const actual = effectiveDeclarations(design, conversion.classes, BASE_CONTEXT, OPTIONS)
  expect(actual.map((declaration) => declaration.property)).toEqual(
    wanted.map((declaration) => declaration.property),
  )
  actual.forEach((declaration, position) => {
    const expected = wanted[position] as MatchDeclaration
    expect(normalValuesEqual(declaration.value, expected.value), declaration.property).toBe(true)
    expect(declaration.important, declaration.property).toBe(expected.important)
  })
}

function converter(fixture?: TailwindFixture) {
  let design: TailwindDesignSystem
  let index: UtilityIndex
  beforeAll(async () => {
    design = await designSystem(fixture)
    index = buildUtilityIndex(design, OPTIONS)
  })
  return (css: string, important: 'suffix' | 'prefix' = 'suffix'): Conversion => {
    const input = matchInput(toDeclarations(css).declarations, OPTIONS)
    const result = matchDeclarations(createMatcher(design, index, { important }), input)
    const conversion = { input, result, classes: sortedClasses(design, result.matches) }
    expectVerified(design, conversion)
    return conversion
  }
}

describe('default theme', () => {
  const convert = converter()
  const classes = (css: string): string[] => convert(css).classes

  it('finds whole signatures, including multi-declaration utilities', () => {
    expect(classes('padding: 16px')).toEqual(['p-4'])
    expect(classes('padding: 1rem')).toEqual(['p-4'])
    expect(classes('width: 50%')).toEqual(['w-1/2'])
    expect(classes('width: 1rem; height: 1rem')).toEqual(['size-4'])
    expect(classes('overflow: hidden; text-overflow: ellipsis; white-space: nowrap')).toEqual([
      'truncate',
    ])
    expect(classes('grid-template-columns: repeat(3, minmax(0, 1fr))')).toEqual(['grid-cols-3'])
    expect(classes('font-weight: bold')).toEqual(['font-bold'])
    expect(classes('aspect-ratio: 16 / 9')).toEqual(['aspect-video'])
  })

  it('covers the rest with physical utilities, never logical ones', () => {
    expect(classes('margin: 0 auto')).toEqual(['mt-0', 'mr-auto', 'mb-0', 'ml-auto'])
    expect(classes('padding: 16px 0')).toEqual(['pt-4', 'pr-0', 'pb-4', 'pl-0'])
    expect(classes('margin: 0; padding: 16px; color: #fff')).toEqual(['m-0', 'p-4', 'text-white'])
  })

  it('compiles bare values that the class list does not enumerate', () => {
    expect(classes('padding: 13px')).toEqual(['p-3.25'])
    expect(classes('padding: 16px 13px')).toEqual(['pt-4', 'pr-3.25', 'pb-4', 'pl-3.25'])
    expect(classes('margin-top: -13px')).toEqual(['-mt-3.25'])
    expect(classes('width: 13px; height: 13px')).toEqual(['size-3.25'])
    expect(classes('width: 33.3333%')).toEqual(['w-1/3'])
    expect(classes('z-index: 37')).toEqual(['z-37'])
    expect(classes('opacity: 0.37')).toEqual(['opacity-37'])
    expect(classes('opacity: 37%')).toEqual(['opacity-37'])
    expect(classes('aspect-ratio: 4 / 5')).toEqual(['aspect-4/5'])
    expect(classes('font-size: 14px; width: 2em')).toEqual(['w-7', 'text-[14px]'])
  })

  it('uses modifiers for line heights and color alpha', () => {
    expect(classes('font-size: 14px; line-height: 24px')).toEqual(['text-sm/6'])
    expect(classes('font-size: 14px; line-height: 23px')).toEqual(['text-sm/5.75'])
    expect(classes('font-size: 14px; line-height: 23.5px')).toEqual(['text-sm/[23.5px]'])
    expect(classes('font-size: 14px; line-height: 1.5')).toEqual(['text-sm/normal'])
    expect(classes('font-size: 14px; line-height: 1.45')).toEqual(['text-sm/[1.45]'])
    expect(classes('font-size: 0.875rem; line-height: 1.25rem')).toEqual(['text-sm/5'])
    expect(classes('background-color: rgb(0 0 0 / 0.5)')).toEqual(['bg-black/50'])
    expect(classes('color: oklch(63.7% 0.237 25.331 / 0.5)')).toEqual(['text-red-500/50'])
  })

  it('falls back to variables, arbitrary values and arbitrary properties', () => {
    const color = convert('color: #ef4444')
    expect(color.classes).toEqual(['text-[#ef4444]'])
    expect(color.result.matches[0]?.kind).toBe('arbitrary-value')
    expect(classes('border-radius: 9999px')).toEqual(['rounded-[9999px]'])
    expect(classes('width: 13.5%')).toEqual(['w-[13.5%]'])
    expect(classes('width: calc(100% - 2rem)')).toEqual(['w-[calc(100%_-_2rem)]'])
    expect(classes('color: var(--brand)')).toEqual(['text-(--brand)'])
    expect(convert('font-size: var(--size)').result.matches).toEqual([
      { className: 'text-(length:--size)', kind: 'variable', declarations: [0] },
    ])
    expect(classes('content: "a b"')).toEqual(["content-['a_b']"])
    expect(classes('-webkit-line-clamp: 3')).toEqual(['[-webkit-line-clamp:3]'])
    expect(convert('-webkit-line-clamp: 3').result.matches[0]?.kind).toBe('arbitrary-property')
  })

  it('writes custom properties as arbitrary properties', () => {
    expect(classes('--x: a b')).toEqual(['[--x:a_b]'])
    expect(classes('--brand-color: #ef4444; color: var(--brand-color)')).toEqual([
      'text-(--brand-color)',
      '[--brand-color:#ef4444]',
    ])
  })

  it('drops vendor-prefixed copies of an unprefixed declaration (TFC105)', () => {
    const conversion = convert('-webkit-user-select: none; user-select: none')
    expect(conversion.classes).toEqual(['select-none'])
    expect(conversion.result.skipped).toEqual([{ declaration: 0, code: 'TFC105' }])
    expect(classes('user-select: none')).toEqual(['select-none'])
    expect(convert('-webkit-user-select: text; user-select: none').classes).toEqual([
      'select-none',
      '[-webkit-user-select:text]',
    ])
  })

  it('marks important declarations with the suffix or the prefix', () => {
    expect(classes('padding: 16px !important')).toEqual(['p-4!'])
    expect(convert('padding: 16px !important', 'prefix').classes).toEqual(['!p-4'])
    expect(classes('padding: 13px !important; color: #fff')).toEqual(['p-3.25!', 'text-white'])
    expect(classes('color: #ef4444 !important')).toEqual(['text-[#ef4444]!'])
  })

  it('reports values that cannot be encoded (TFC204)', () => {
    const conversion = convert('color: #fff; font-family: a`b')
    expect(conversion.classes).toEqual(['text-white'])
    expect(conversion.result.skipped).toEqual([{ declaration: 1, code: 'TFC204' }])
    expect(conversion.input[1]?.property).toBe('font-family')
  })

  it('converts a data: URL with spaces, writing them as %20 (N44)', () => {
    const conversion = convert(
      `background-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='8'/>")`,
    )
    expect(conversion.classes).toEqual([
      `bg-[url("data:image/svg+xml,<svg%20xmlns='http://www.w3.org/2000/svg'%20width='8'/>")]`,
    ])
    expect(conversion.result.skipped).toEqual([])
  })
})

describe('custom theme', () => {
  const convert = converter('custom-theme')
  const classes = (css: string): string[] => convert(css).classes

  it('uses the custom colors and spacing', () => {
    expect(classes('background-color: #123456')).toEqual(['bg-brand'])
    expect(classes('padding: 8px')).toEqual(['p-1'])
    expect(classes('padding: 12px')).toEqual(['p-1.5'])
    expect(classes('padding: 13px')).toEqual(['p-[13px]'])
    expect(classes('color: oklch(0.637 0.237 25.331)')).toEqual([
      'text-[oklch(0.637_0.237_25.331)]',
    ])
    expect(classes('background-color: rgb(18 52 86 / 0.5)')).toEqual(['bg-brand/50'])
  })
})

describe('prefix(tw)', () => {
  const convert = converter('prefix')
  const classes = (css: string): string[] => convert(css).classes

  it('prefixes every kind of class', () => {
    expect(classes('padding: 16px')).toEqual(['tw:p-4'])
    expect(classes('padding: 13px')).toEqual(['tw:p-3.25'])
    expect(classes('margin: 0 auto')).toEqual(['tw:mt-0', 'tw:mr-auto', 'tw:mb-0', 'tw:ml-auto'])
    expect(classes('color: #123456')).toEqual(['tw:text-brand'])
    expect(classes('color: #ef4444')).toEqual(['tw:text-[#ef4444]'])
    expect(classes('font-size: 14px; line-height: 24px')).toEqual(['tw:text-sm/6'])
    expect(classes('font-size: var(--size)')).toEqual(['tw:text-(length:--size)'])
    expect(classes('--x: 1')).toEqual(['tw:[--x:1]'])
    expect(classes('padding: 16px !important')).toEqual(['tw:p-4!'])
    expect(convert('padding: 16px !important', 'prefix').classes).toEqual(['tw:!p-4'])
  })
})
