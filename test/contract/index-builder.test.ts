// SPEC §5.2 against the installed Tailwind: what the index finds for plain CSS, by theme.
import { beforeAll, describe, expect, it } from 'vitest'
import { type NormalDeclaration, normalizeDeclarations } from '../../src/css/normalize/index.ts'
import type { TailwindDesignSystem } from '../../src/tailwind/adapter.ts'
import {
  buildUtilityIndex,
  findByLonghand,
  findBySignature,
  findVariants,
  type UtilityIndex,
} from '../../src/tailwind/index-builder.ts'
import { designSystem } from '../helpers/design-system.ts'

const OPTIONS = { rootFontSize: 16 } as const

/** The normal declarations of a CSS block, one per longhand. */
function block(css: string): NormalDeclaration[] {
  const declarations = css
    .split(';')
    .filter((part) => part.trim() !== '')
    .map((part) => {
      const colon = part.indexOf(':')
      return { property: part.slice(0, colon).trim(), value: part.slice(colon + 1).trim() }
    })
  const winners = new Map<string, NormalDeclaration>()
  for (const declaration of normalizeDeclarations(declarations, OPTIONS)) {
    winners.set(declaration.property, declaration)
  }
  return [...winners.values()]
}

const signature = (index: UtilityIndex, css: string): string[] =>
  findBySignature(index, block(css)).map((utility) => utility.candidate)

const longhand = (index: UtilityIndex, css: string): string[] => {
  const [declaration] = block(css)
  return findByLonghand(index, declaration as NormalDeclaration).map((utility) => utility.candidate)
}

describe('default theme', () => {
  let design: TailwindDesignSystem
  let index: UtilityIndex

  beforeAll(async () => {
    design = await designSystem()
    index = buildUtilityIndex(design, OPTIONS)
  })

  it('finds single and multi-declaration utilities by their whole signature', () => {
    expect(signature(index, 'padding: 16px')[0]).toBe('p-4')
    expect(signature(index, 'padding: 1rem')[0]).toBe('p-4')
    expect(signature(index, 'margin: 0')[0]).toBe('m-0')
    expect(signature(index, 'width: 1rem; height: 1rem')[0]).toBe('size-4')
    expect(
      signature(index, 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap'),
    ).toEqual(['truncate'])
    expect(signature(index, 'font-size: 0.875rem; line-height: calc(1.25 / 0.875)')).toEqual([
      'text-sm',
    ])
    expect(signature(index, 'border-style: solid; border-width: 1px')).toContain('border')
    expect(signature(index, 'box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)')).toEqual(['shadow-xs'])
  })

  it('finds values that only equal after normalization', () => {
    expect(signature(index, 'width: 50%')).toContain('w-1/2')
    expect(signature(index, 'opacity: 0.5')).toEqual(['opacity-50'])
    expect(signature(index, 'color: oklch(0.637 0.237 25.331)')).toEqual(['text-red-500'])
    expect(signature(index, 'background-color: rgb(255, 255, 255)')).toEqual(['bg-white'])
    expect(signature(index, 'background-color: #fff')).toEqual(['bg-white'])
    expect(signature(index, 'border-radius: calc(infinity * 1px)')).toEqual(['rounded-full'])
  })

  it("doesn't equate what isn't equal", () => {
    expect(signature(index, 'color: #ef4444')).toEqual([])
    expect(signature(index, 'border-radius: 9999px')).toEqual([])
    expect(signature(index, 'line-height: 24px')).not.toContain('leading-normal')
    expect(signature(index, 'padding: 13px')).toEqual([])
  })

  it('lists every utility that sets a longhand to a value', () => {
    expect(longhand(index, 'margin-top: 0')).toEqual(expect.arrayContaining(['m-0', 'mt-0']))
    expect(longhand(index, 'margin-top: 0')).not.toContain('my-0')
    expect(longhand(index, 'margin-block-start: 0')).toContain('my-0')
    expect(longhand(index, 'padding-inline-start: 16px')).toEqual(
      expect.arrayContaining(['px-4', 'ps-4']),
    )
  })

  it('knows the functional roots of each longhand', () => {
    const roots = (property: string) => index.roots.get(property)?.map((root) => root.name) ?? []
    expect(roots('padding-top')).toEqual(['pt', 'p'])
    expect(roots('padding-block-start')).toContain('py')
    expect(roots('margin-top')).toEqual(expect.arrayContaining(['-mt', 'mt']))
    expect(roots('z-index')).toEqual(['-z', 'z'])
    expect(roots('color')).toContain('text')
  })

  it('maps variant contexts to variant names', () => {
    const variants = (selector: string, conditions: string[] = []) =>
      findVariants(index, { selector, conditions })
    expect(variants('&:hover', ['@media (hover: hover)'])).toEqual(['hover'])
    expect(variants('&:hover')).toEqual([])
    expect(variants('&', ['@media (min-width: 768px)'])).toEqual(['md', 'min-md'])
    expect(variants('&', ['@media (width < 48rem)'])).toEqual(['max-md'])
    expect(variants('&', ['@container (width >= 28rem)'])).toEqual(
      expect.arrayContaining(['@md', '@min-md']),
    )
    expect(variants('&', ['@media (prefers-color-scheme: dark)'])).toEqual(['dark'])
    expect(variants('&:first-child')).toEqual(['first'])
    expect(variants('&::before')).toEqual(['before'])
    expect(variants('&:nth-child(odd)')).toEqual(['odd'])
    expect(variants('&:is(:where(.group):hover *)', ['@media (hover: hover)'])).toEqual([
      'group-hover',
    ])
    expect(variants('&:not(:first-child)')).toEqual(['not-first'])
    expect(variants('&:has(:checked)')).toEqual(['has-checked'])
    expect(variants('&[aria-checked="true"]')).toEqual(['aria-checked'])
  })
})

describe('custom theme', () => {
  let index: UtilityIndex

  beforeAll(async () => {
    index = buildUtilityIndex(await designSystem('custom-theme'), OPTIONS)
  })

  it('indexes the custom colors and spacing, and only those colors', () => {
    expect(signature(index, 'background-color: #123456')).toEqual(['bg-brand'])
    expect(signature(index, 'padding: 8px')[0]).toBe('p-1')
    expect(signature(index, 'color: oklch(0.637 0.237 25.331)')).toEqual([])
    expect(
      findVariants(index, { selector: '&', conditions: ['@media (min-width: 640px)'] }),
    ).toEqual(['sm', 'min-sm', 'tablet', 'min-tablet'])
  })
})

describe('prefix(tw)', () => {
  let index: UtilityIndex

  beforeAll(async () => {
    index = buildUtilityIndex(await designSystem('prefix'), OPTIONS)
  })

  it('indexes prefixed candidates and unprefixed variant names', () => {
    expect(signature(index, 'color: #123456')).toEqual(['tw:text-brand'])
    expect(signature(index, 'border-style: solid; border-width: 1px')).toContain('tw:border')
    expect(signature(index, 'box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)')).toEqual(['tw:shadow-xs'])
    expect(index.roots.get('padding-top')?.map((root) => root.name)).toContain('p')
    expect(
      findVariants(index, { selector: '&:hover', conditions: ['@media (hover: hover)'] }),
    ).toEqual(['hover'])
  })
})
