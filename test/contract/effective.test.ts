// SPEC §5.6 against the installed Tailwind: what candidates mean once theme and --tw-* variables
// are resolved. Expectations are written as plain CSS and normalized, so they hold on 4.2 and 4.3.
import { beforeAll, describe, expect, it } from 'vitest'
import {
  type NormalDeclaration,
  normalizeDeclarations,
  normalValuesEqual,
} from '../../src/css/normalize/index.ts'
import type { TailwindDesignSystem } from '../../src/tailwind/adapter.ts'
import { BASE_CONTEXT, type Context, effectiveDeclarations } from '../../src/tailwind/effective.ts'
import { designSystem } from '../helpers/design-system.ts'

const OPTIONS = { rootFontSize: 16 } as const

/** Normal form of a CSS block, cascaded and sorted like effective declarations. */
function expected(css: string): NormalDeclaration[] {
  const declarations = css
    .split(';')
    .filter((part) => part.trim() !== '')
    .map((part) => {
      const colon = part.indexOf(':')
      const value = part.slice(colon + 1).trim()
      const important = value.endsWith('!important')
      return {
        property: part.slice(0, colon).trim(),
        value: important ? value.slice(0, -'!important'.length).trim() : value,
        important,
      }
    })
  const winners = new Map<string, NormalDeclaration>()
  for (const declaration of normalizeDeclarations(declarations, OPTIONS)) {
    winners.set(declaration.property, declaration)
  }
  return [...winners.values()].sort((a, b) => (a.property < b.property ? -1 : 1))
}

function expectEquivalent(actual: NormalDeclaration[], css: string): void {
  const wanted = expected(css)
  expect(actual.map((declaration) => declaration.property)).toEqual(
    wanted.map((declaration) => declaration.property),
  )
  actual.forEach((declaration, index) => {
    const other = wanted[index] as NormalDeclaration
    expect(normalValuesEqual(declaration.value, other.value), declaration.property).toBe(true)
    expect(declaration.important).toBe(other.important)
  })
}

describe('default theme', () => {
  let design: TailwindDesignSystem
  const effective = (candidates: string[], context: Context = BASE_CONTEXT) =>
    effectiveDeclarations(design, candidates, context, OPTIONS)

  beforeAll(async () => {
    design = await designSystem()
  })

  it('lets a whole shorthand override the longhands Tailwind puts before it', () => {
    expectEquivalent(effective(['border-t-[red]', '[border:var(--a)]']), 'border: var(--a)')
    expectEquivalent(
      effective(['pt-4', '[padding:var(--a)]']),
      'padding: var(--a); padding-top: 16px',
    )
  })

  it('reduces shadow-xs to its visible layer', () => {
    expectEquivalent(effective(['shadow-xs']), 'box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)')
  })

  it('resolves border through the @property initial value of --tw-border-style', () => {
    expectEquivalent(effective(['border']), 'border-style: solid; border-width: 1px')
    expectEquivalent(
      effective(['border', 'border-dashed']),
      'border-style: dashed; border-width: 1px',
    )
  })

  it('gives m-0 and m-1 their lengths whether spacing is a calc (≤ 4.3.0) or not', () => {
    expectEquivalent(effective(['m-0']), 'margin: 0')
    expectEquivalent(effective(['m-1']), 'margin: 4px')
    expectEquivalent(effective(['-mt-2']), 'margin-top: -0.5rem')
  })

  it('folds fractions and keeps opacity percentages equal to numbers', () => {
    expectEquivalent(effective(['w-1/2']), 'width: 50%')
    expectEquivalent(effective(['opacity-50']), 'opacity: 0.5')
  })

  it('reads bg-red-500/50 as red-500 at half alpha', () => {
    const red = design.themeValue('--color-red-500') as string
    expectEquivalent(
      effective(['bg-red-500/50']),
      `background-color: ${red.replace(/\)$/, ' / 0.5)')}`,
    )
    expectEquivalent(effective(['bg-white']), 'background-color: #fff')
  })

  it("takes text-sm's line-height from the theme through the --tw-leading fallback", () => {
    expectEquivalent(effective(['text-sm']), 'font-size: 0.875rem; line-height: calc(1.25 / 0.875)')
    expectEquivalent(effective(['text-sm', 'leading-6']), 'font-size: 14px; line-height: 24px')
    expectEquivalent(effective(['text-sm/6']), 'font-size: 14px; line-height: 24px')
  })

  it('applies hover: in its own context: @media (hover: hover) and &:hover', () => {
    const hover = { selector: '&:hover', conditions: ['@media (hover: hover)'] }
    expectEquivalent(effective(['hover:flex'], hover), 'display: flex')
    expect(effective(['hover:flex'])).toEqual([])
    expect(effective(['hover:flex'], { selector: '&:hover', conditions: [] })).toEqual([])
  })

  it('matches md: against min-width conditions', () => {
    expectEquivalent(
      effective(['md:p-4'], { selector: '&', conditions: ['@media (min-width: 768px)'] }),
      'padding: 16px',
    )
  })

  it("adds before:'s empty content", () => {
    expectEquivalent(
      effective(['before:flex'], { selector: '&::before', conditions: [] }),
      'content: ""; display: flex',
    )
    expectEquivalent(
      effective(["before:content-['x']"], { selector: '&::before', conditions: [] }),
      'content: "x"',
    )
  })

  it('resolves the font stack and multi-declaration utilities', () => {
    expectEquivalent(
      effective(['font-sans']),
      `font-family: ${design.themeValue('--font-sans') as string}`,
    )
    expectEquivalent(
      effective(['truncate']),
      'overflow: hidden; text-overflow: ellipsis; white-space: nowrap',
    )
    expectEquivalent(effective(['size-4']), 'width: 1rem; height: 1rem')
    expectEquivalent(effective(['ring']), 'box-shadow: 0 0 0 1px currentcolor')
  })

  it('keeps !important and arbitrary values', () => {
    expectEquivalent(effective(['p-4!']), 'padding: 16px !important')
    expectEquivalent(effective(['[color:red]']), 'color: red')
    expectEquivalent(effective(['p-[13px]']), 'padding: 13px')
  })

  it('splits container by context', () => {
    expectEquivalent(effective(['container']), 'width: 100%')
    expectEquivalent(
      effective(['container'], { selector: '&', conditions: ['@media (min-width: 40rem)'] }),
      'max-width: 640px',
    )
  })
})

describe('custom theme', () => {
  let design: TailwindDesignSystem

  beforeAll(async () => {
    design = await designSystem('custom-theme')
  })

  it('resolves custom colors and the custom spacing', () => {
    const effective = (candidates: string[]) =>
      effectiveDeclarations(design, candidates, BASE_CONTEXT, OPTIONS)
    expectEquivalent(effective(['bg-brand']), 'background-color: #123456')
    expectEquivalent(effective(['text-ink']), 'color: oklch(20% 0.02 260)')
    expectEquivalent(effective(['p-1']), 'padding: 8px')
    expect(effective(['bg-red-500'])).toEqual([])
  })
})

describe('prefix(tw)', () => {
  let design: TailwindDesignSystem
  const effective = (candidates: string[]) =>
    effectiveDeclarations(design, candidates, BASE_CONTEXT, OPTIONS)

  beforeAll(async () => {
    design = await designSystem('prefix')
  })

  it('reads --tw-color-* as theme variables, not as internal ones', () => {
    expectEquivalent(effective(['tw:text-brand']), 'color: #123456')
    expectEquivalent(effective(['tw:bg-brand/50']), 'background-color: rgb(18 52 86 / 0.5)')
  })

  it('still resolves the internal --tw-* variables', () => {
    expectEquivalent(effective(['tw:border']), 'border-style: solid; border-width: 1px')
    expectEquivalent(effective(['tw:shadow-xs']), 'box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)')
    expectEquivalent(
      effective(['tw:text-sm']),
      'font-size: 0.875rem; line-height: calc(1.25 / 0.875)',
    )
    expectEquivalent(effective(['tw:m-1']), 'margin: 4px')
  })

  it('ignores unprefixed candidates', () => {
    expect(effective(['flex'])).toEqual([])
  })
})
