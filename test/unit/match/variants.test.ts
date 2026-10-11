// SPEC §5.3: context → variant chain, against the real design system (TESTING §2.1).
import { beforeAll, describe, expect, it } from 'vitest'
import {
  createVariantResolver,
  type VariantResult,
  variantChain,
} from '../../../src/match/variants.ts'
import { buildUtilityIndex } from '../../../src/tailwind/index-builder.ts'
import { designSystem, type TailwindFixture } from '../../helpers/design-system.ts'

const OPTIONS = { rootFontSize: 16 } as const

type Row = readonly [
  selector: string,
  conditions: readonly string[],
  chain: string | null,
  codes?: string,
]

function resolverFor(fixture?: TailwindFixture) {
  let resolve: (
    selector: string,
    conditions: readonly string[],
    properties?: string[],
  ) => VariantResult
  beforeAll(async () => {
    const design = await designSystem(fixture)
    const resolver = createVariantResolver(design, buildUtilityIndex(design, OPTIONS))
    resolve = (selector, conditions, properties = []) =>
      variantChain(resolver, { selector, conditions }, new Set(properties))
  })
  /** The chain as `a:b:`, or `null` for TFC303; codes joined by `,`. */
  return (selector: string, conditions: readonly string[], properties?: string[]) => {
    const result = resolve(selector, [...conditions], properties)
    return 'code' in result
      ? { chain: null, codes: result.code }
      : {
          chain: result.variants.map((variant) => `${variant}:`).join(''),
          codes: result.codes.join(','),
        }
  }
}

type Chain = ReturnType<typeof resolverFor>

function expectRow(chain: Chain, [selector, conditions, expected, codes = '']: Row): void {
  expect(chain(selector, conditions)).toEqual({ chain: expected, codes })
}

describe('default theme', () => {
  const chain = resolverFor()

  it.for<Row>([
    ['&', [], ''],
    // whole contexts
    ['&:hover', ['@media (hover: hover)'], 'hover:'],
    ['&:is(:where(.group):hover *)', ['@media (hover: hover)'], 'group-hover:'],
    // ADR-0006: plain :hover is not hover:
    ['&:hover', [], '[&:hover]:', 'TFC301'],
    // media
    ['&', ['@media (min-width: 768px)'], 'md:'],
    ['&', ['@media (width >= 48rem)'], 'md:'],
    ['&', ['@media screen and (min-width: 768px)'], 'md:'],
    ['&', ['@media (width < 48rem)'], 'max-md:'],
    ['&', ['@media (min-width: 700px)'], 'min-[700px]:'],
    ['&', ['@media (width < 700px)'], 'max-[700px]:'],
    ['&', ['@media (max-width: 767px)'], '[@media(max-width:767px)]:', 'TFC302'],
    [
      '&',
      ['@media (min-width: 768px) and (max-width: 1023px)'],
      'md:[@media(max-width:1023px)]:',
      'TFC302',
    ],
    ['&', ['@media (min-width: 768px)', '@media (width < 64rem)'], 'max-lg:md:'],
    ['&', ['@media (prefers-color-scheme: dark)'], 'dark:'],
    ['&', ['@media (prefers-reduced-motion: no-preference)'], 'motion-safe:'],
    ['&', ['@media print'], 'print:'],
    ['&', ['@media (orientation: portrait)'], 'portrait:'],
    ['&', ['@media (min-resolution: 2dppx)'], '[@media(min-resolution:2dppx)]:', 'TFC302'],
    // supports, container, starting-style
    ['&', ['@supports (display: grid)'], 'supports-[display:grid]:'],
    ['&', ['@container (min-width: 448px)'], '@md:'],
    ['&', ['@container (min-width: 400px)'], '@[400px]:'],
    ['&', ['@container (width < 400px)'], '@max-[400px]:'],
    ['&', ['@starting-style'], 'starting:'],
    // selectors
    ['&:first-child', [], 'first:'],
    ['&:focus', [], 'focus:'],
    ['&:disabled', [], 'disabled:'],
    ['&::placeholder', [], 'placeholder:'],
    ['&:focus:hover', [], 'focus:[&:hover]:', 'TFC301'],
    ['&:hover:focus', [], '[&:hover]:focus:', 'TFC301'],
    ['&:hover:active', [], '[&:hover]:active:', 'TFC301'],
    ['&:nth-child(2n+1)', [], 'odd:'],
    ['&:nth-child(3n+1)', [], 'nth-[3n+1]:'],
    ['&:not(:first-child)', [], 'not-first:'],
    ['&:not(.a)', [], 'not-[.a]:'],
    ['&:has(:checked)', [], 'has-checked:'],
    ['&:has(.a)', [], 'has-[.a]:'],
    ['&[data-state=open]', [], 'data-[state=open]:'],
    ['&[data-state="a b"]', [], "data-[state='a_b']:"],
    ['&[aria-checked="true"]', [], 'aria-checked:'],
    ['&[aria-sort="ascending"]', [], 'aria-[sort=ascending]:'],
    ['.dark &', [], '[.dark_&]:', 'TFC301'],
    ['& > p', [], '[&>p]:', 'TFC301'],
    // selectors and conditions together
    ['&:hover', ['@media (min-width: 768px)'], 'md:[&:hover]:', 'TFC301'],
    ['&:hover', ['@media (hover: hover)', '@media (min-width: 768px)'], 'md:hover:'],
    ['&:focus', ['@media (max-width: 767px)'], '[@media(max-width:767px)]:focus:', 'TFC302'],
  ])('%s %j → %s', (row) => expectRow(chain, row))

  it('uses before:/after: only where the block sets content itself', () => {
    expect(chain('&::before', [], ['content', 'color'])).toEqual({ chain: 'before:', codes: '' })
    expect(chain('&::before', [], ['color'])).toEqual({ chain: '[&::before]:', codes: 'TFC301' })
    expect(chain('&:hover::after', [], ['content'])).toEqual({
      chain: '[&:hover]:after:',
      codes: 'TFC301',
    })
  })

  it('reports contexts that cannot be written as a class (TFC303)', () => {
    expect(chain('&[data-x="a`b"]', [])).toEqual({ chain: null, codes: 'TFC303' })
    expect(chain('&', ['@media (min-width: 768px) and (x: "`")'])).toEqual({
      chain: null,
      codes: 'TFC303',
    })
  })
})

describe('custom theme', () => {
  const chain = resolverFor('custom-theme')

  it.for<Row>([
    ['&', ['@media (min-width: 640px)'], 'sm:'],
    ['&', ['@media (min-width: 768px)'], 'md:'],
    ['&:hover', ['@media (hover: hover)'], 'hover:'],
  ])('%s %j → %s', (row) => expectRow(chain, row))
})

describe('custom variants', () => {
  const chain = resolverFor('custom-variant')

  it.for<Row>([
    ['&:where(.dark, .dark *)', [], 'dark:'],
    [
      '&',
      ['@media (prefers-color-scheme: dark)'],
      '[@media(prefers-color-scheme:dark)]:',
      'TFC302',
    ],
    ['&', ['@media (pointer: fine)'], 'fine-pointer:'],
    ['&:where([data-theme="midnight"] *)', [], 'theme-midnight:'],
  ])('%s %j → %s', (row) => expectRow(chain, row))
})

describe('prefix(tw)', () => {
  const chain = resolverFor('prefix')

  it.for<Row>([
    ['&:hover', ['@media (hover: hover)'], 'hover:'],
    ['&:hover', [], '[&:hover]:', 'TFC301'],
    ['&', ['@media (min-width: 700px)'], 'min-[700px]:'],
    ['&[data-state=open]', [], 'data-[state=open]:'],
  ])('%s %j → %s', (row) => expectRow(chain, row))
})
