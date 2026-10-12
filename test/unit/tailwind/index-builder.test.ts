import { describe, expect, it } from 'vitest'
import type { NormalDeclaration } from '../../../src/css/normalize/index.ts'
import { BASE_CONTEXT } from '../../../src/tailwind/effective.ts'
import {
  buildUtilityIndex,
  findByLonghand,
  findBySignature,
  findVariants,
  utilityIndex,
} from '../../../src/tailwind/index-builder.ts'
import { ast, type FakeDesignInput, fakeDesign, rule, variant } from '../../helpers/fake-design.ts'

const OPTIONS = { rootFontSize: 16 } as const

const d = (property: string, value: string): NormalDeclaration => ({
  property,
  value,
  important: false,
})

const names = (found: readonly { candidate: string }[]): string[] =>
  found.map((utility) => utility.candidate)

const PROBE = '[--tfc-probe:0]'
const probeClass = (variantName: string): string =>
  `.${`${variantName}:${PROBE}`.replace(/[^\w-]/g, (char) => `\\${char}`)}`
const probe = (variantName: string, selector: string, conditions: string[] = []) => ({
  [`${variantName}:${PROBE}`]: ast([
    rule(selector.replace('&', probeClass(variantName)), ['--tfc-probe: 0'], conditions),
  ]),
})

const input: FakeDesignInput = {
  theme: { '--spacing': '0.25rem', '--color-white': '#fff' },
  roots: ['p', 'pl', 'px', 'bg', 'text', 'w', '-mt'],
  candidates: {
    'p-4': ast([rule('.p-4', ['padding: calc(var(--spacing) * 4)'])]),
    'px-4': ast([rule('.px-4', ['padding-inline: calc(var(--spacing) * 4)'])]),
    'pl-4': ast([rule('.pl-4', ['padding-left: calc(var(--spacing) * 4)'])]),
    'p-px': ast([rule('.p-px', ['padding: 1px'])]),
    'w-full': ast([rule('.w-full', ['width: 100%'])]),
    'w-1/1': ast([rule('.w-1\\/1', ['width: calc(1 / 1 * 100%)'])]),
    'w-whole': ast([rule('.w-whole', ['width: 100%'])]),
    'w-10': ast([rule('.w-10', ['width: 40px'])]),
    'w-ten': ast([rule('.w-ten', ['width: 40px'])]),
    '-mt-2': ast([rule('.-mt-2', ['margin-top: calc(var(--spacing) * -2)'])]),
    'bg-white': ast([rule('.bg-white', ['background-color: var(--color-white)'])]),
    'text-white': ast([rule('.text-white', ['color: var(--color-white)'])]),
    truncate: ast([
      rule('.truncate', ['overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap']),
    ]),
    container: ast([
      rule('.container', ['width: 100%']),
      rule('.container', ['max-width: 40rem'], ['@media (width >= 40rem)']),
    ]),
    'space-x-1': ast([rule(':where(.space-x-1 > :not(:last-child))', ['margin-left: 4px'])]),
    'from-x': ast([rule('.from-x', ['--tw-gradient-from: red'])]),
    ...probe('hover', '&:hover', ['@media (hover: hover)']),
    ...probe('focus', '&:focus'),
    ...probe('md', '&', ['@media (width >= 48rem)']),
    ...probe('min-md', '&', ['@media (width >= 48rem)']),
    ...probe('max-md', '&', ['@media (width < 48rem)']),
    ...probe('@md', '&', ['@container (width >= 28rem)']),
    [`not-hover:${PROBE}`]: ast([
      rule(`${probeClass('not-hover')}:not(:hover)`, ['--tfc-probe: 0']),
      rule(probeClass('not-hover'), ['--tfc-probe: 0'], ['@media not (hover: hover)']),
    ]),
  },
  classList: [
    'p-4',
    'px-4',
    'pl-4',
    'p-px',
    'w-full',
    'w-1/1',
    'w-whole',
    'w-10',
    'w-ten',
    '-mt-2',
    'bg-white',
    'text-white',
    'truncate',
    'container',
    'space-x-1',
    'from-x',
    'not-compiling',
  ],
  variants: [
    variant('hover'),
    variant('focus'),
    variant('md'),
    variant('not', ['hover', 'first']),
    variant('min', ['md']),
    variant('max', ['md']),
    variant('@', ['md'], false),
    variant('data', []),
    { ...variant('supports', []), isArbitrary: true },
  ],
}

const index = buildUtilityIndex(fakeDesign(input), OPTIONS)

describe('bySignature (SPEC §5.2 steps 3–4)', () => {
  it('stores each base-context candidate under its sorted normal declarations', () => {
    expect(
      names(
        findBySignature(index, [
          d('padding-top', '16px'),
          d('padding-right', '16px'),
          d('padding-bottom', '16px'),
          d('padding-left', '16px'),
        ]),
      ),
    ).toEqual(['p-4'])
    expect(
      names(
        findBySignature(index, [
          d('white-space', 'nowrap'),
          d('overflow-x', 'hidden'),
          d('overflow-y', 'hidden'),
          d('text-overflow', 'ellipsis'),
        ]),
      ),
    ).toEqual(['truncate'])
    expect(names(findBySignature(index, [d('margin-top', '-8px')]))).toEqual(['-mt-2'])
  })

  it('needs the whole set: a subset or a superset is no hit', () => {
    expect(findBySignature(index, [d('padding-top', '16px')])).toEqual([])
    expect(findBySignature(index, [d('width', '40px'), d('height', '40px')])).toEqual([])
    expect(findBySignature(index, [])).toEqual([])
  })

  it('orders equal candidates: named over bare, then shorter, then by code unit', () => {
    expect(names(findBySignature(index, [d('width', '100%')]))).toEqual([
      'w-full',
      'w-whole',
      'w-1/1',
    ])
    expect(names(findBySignature(index, [d('width', '40px')]))).toEqual(['w-ten', 'w-10'])
  })

  it('orders positive candidates before negative ones of the same kind', () => {
    const signed = buildUtilityIndex(
      fakeDesign({
        roots: ['tracking', '-tracking'],
        candidates: {
          '-tracking-wide': ast([rule('.-tracking-wide', ['letter-spacing: -0.025em'])]),
          'tracking-tight': ast([rule('.tracking-tight', ['letter-spacing: -0.025em'])]),
        },
      }),
      OPTIONS,
    )
    expect(names(findBySignature(signed, [d('letter-spacing', '-0.025em')]))).toEqual([
      'tracking-tight',
      '-tracking-wide',
    ])
  })

  it('finds sRGB colors within half an 8-bit step', () => {
    expect(names(findBySignature(index, [d('color', 'srgb(254.6 255 255 / 1)')]))).toEqual([
      'text-white',
    ])
    expect(names(findBySignature(index, [d('color', 'srgb(255 255 255 / 0.999)')]))).toEqual([
      'text-white',
    ])
    expect(findBySignature(index, [d('color', 'srgb(254.4 255 255 / 1)')])).toEqual([])
  })

  it('leaves out candidates with other contexts, nothing left, or no compiled form', () => {
    const all = [...index.bySignature.values()].flat().map((utility) => utility.candidate)
    expect(all).not.toContain('container')
    expect(all).not.toContain('space-x-1')
    expect(all).not.toContain('from-x')
    expect(all).not.toContain('not-compiling')
  })
})

describe('byLonghand (SPEC §5.2 step 4)', () => {
  it('lists every candidate that sets a longhand to a value', () => {
    expect(names(findByLonghand(index, d('padding-left', '16px')))).toEqual(['p-4', 'pl-4'])
    expect(names(findByLonghand(index, d('padding-inline-start', '16px')))).toEqual(['px-4'])
    expect(names(findByLonghand(index, d('overflow-x', 'hidden')))).toEqual(['truncate'])
    expect(names(findByLonghand(index, d('background-color', 'srgb(255 255 255 / 1)')))).toEqual([
      'bg-white',
    ])
    expect(findByLonghand(index, d('padding-left', '17px'))).toEqual([])
  })

  it('keeps the declarations of each candidate for set cover', () => {
    const [px] = findByLonghand(index, d('padding-inline-end', '16px'))
    expect(px?.declarations).toEqual([
      d('padding-inline-end', '16px'),
      d('padding-inline-start', '16px'),
    ])
    expect(px?.kind).toBe('bare')
    expect(px?.order).toBe(1n)
    expect(findByLonghand(index, d('width', '40px'))[0]?.kind).toBe('named')
  })
})

describe('roots (SPEC §5.2 step 4)', () => {
  it('maps each longhand to the functional roots whose candidates set it', () => {
    expect(index.roots.get('padding-left')).toEqual([
      { name: 'pl', longhands: ['padding-left'], modifiers: false },
      {
        name: 'p',
        longhands: ['padding-bottom', 'padding-left', 'padding-right', 'padding-top'],
        modifiers: false,
      },
    ])
    expect(index.roots.get('padding-inline-start')?.map((root) => root.name)).toEqual(['px'])
    expect(index.roots.get('margin-top')).toEqual([
      { name: '-mt', longhands: ['margin-top'], modifiers: false },
    ])
    expect(index.roots.get('width')?.map((root) => root.name)).toEqual(['w'])
    expect(index.roots.get('overflow-x')).toBeUndefined()
  })

  it('knows which roots take modifiers', () => {
    const withModifiers = buildUtilityIndex(
      fakeDesign({
        roots: ['text'],
        modifiers: { 'text-sm': ['tight'] },
        candidates: { 'text-sm': ast([rule('.text-sm', ['font-size: 14px'])]) },
      }),
      OPTIONS,
    )
    expect(withModifiers.roots.get('font-size')).toEqual([
      { name: 'text', longhands: ['font-size'], modifiers: true },
    ])
  })

  it('compiles roots without a listed candidate once with a variable', () => {
    const selector = (root: string): string =>
      `.${`${root}-(--tfc-probe)`.replace(/[^\w-]/g, (char) => `\\${char}`)}`
    const probed = buildUtilityIndex(
      fakeDesign({
        roots: ['bg', 'bg-size', 'divide', 'from'],
        candidates: {
          'bg-red': ast([rule('.bg-red', ['background-color: red'])]),
          'bg-size-(--tfc-probe)': ast([
            rule(selector('bg-size'), ['background-size: var(--tfc-probe)']),
          ]),
          // Rules for other elements, or only Tailwind's variables: no root.
          'divide-(--tfc-probe)': ast([
            rule(`:where(${selector('divide')} > :not(:last-child))`, [
              'border-color: var(--tfc-probe)',
            ]),
          ]),
          'from-(--tfc-probe)': ast([
            rule(selector('from'), ['--tw-gradient-from: var(--tfc-probe)']),
          ]),
        },
      }),
      OPTIONS,
    )
    expect(probed.roots.get('background-size')).toEqual([
      { name: 'bg-size', longhands: ['background-size'], modifiers: false },
    ])
    expect(probed.roots.get('background-color')?.map((root) => root.name)).toEqual(['bg'])
    expect(probed.roots.get('border-top-color')).toBeUndefined()
    expect([...probed.roots.keys()].sort()).toEqual(['background-color', 'background-size'])
  })

  it('assigns each candidate to its longest root, after the prefix', () => {
    const prefixed = buildUtilityIndex(
      fakeDesign({
        prefix: 'tw',
        roots: ['bg', 'bg-linear'],
        candidates: {
          'tw:bg-linear-45': ast([rule('.tw\\:bg-linear-45', ['background-image: none'])]),
          'tw:bg-red': ast([rule('.tw\\:bg-red', ['background-color: red'])]),
        },
      }),
      OPTIONS,
    )
    expect(prefixed.roots.get('background-image')?.map((root) => root.name)).toEqual(['bg-linear'])
    expect(prefixed.roots.get('background-color')?.map((root) => root.name)).toEqual(['bg'])
  })
})

describe('variant index (SPEC §5.2 step 5)', () => {
  it('maps the normalized context of each variant to its names, shortest first', () => {
    expect(
      findVariants(index, { selector: '&:hover', conditions: ['@media (hover:hover)'] }),
    ).toEqual(['hover'])
    expect(findVariants(index, { selector: '&:focus', conditions: [] })).toEqual(['focus'])
    expect(
      findVariants(index, { selector: '&', conditions: ['@media (min-width: 768px)'] }),
    ).toEqual(['md', 'min-md'])
    expect(findVariants(index, { selector: '&', conditions: ['@media (width < 48rem)'] })).toEqual([
      'max-md',
    ])
    expect(
      findVariants(index, { selector: '&', conditions: ['@container (min-width: 28rem)'] }),
    ).toEqual(['@md'])
  })

  it('skips variants with several contexts, arbitrary-only ones and ones that do not compile', () => {
    expect(findVariants(index, { selector: '&:not(:hover)', conditions: [] })).toEqual([])
    expect(findVariants(index, BASE_CONTEXT)).toEqual([])
    expect([...index.variants.values()].flat().sort()).toEqual([
      '@md',
      'focus',
      'hover',
      'max-md',
      'md',
      'min-md',
    ])
  })
})

describe('utilityIndex memoization (SPEC §5.2)', () => {
  const source = { css: '@import "tailwindcss";', base: '/project' }

  it('returns the same index for the same version, CSS, base and root font size', () => {
    const design = fakeDesign(input)
    const first = utilityIndex(design, source, OPTIONS)
    expect(utilityIndex(fakeDesign(input), source, OPTIONS)).toBe(first)
    expect(utilityIndex(design, { ...source, css: `${source.css} ` }, OPTIONS)).not.toBe(first)
    expect(utilityIndex(design, { ...source, base: '/other' }, OPTIONS)).not.toBe(first)
    expect(utilityIndex(design, source, { rootFontSize: 10 })).not.toBe(first)
    expect(utilityIndex(fakeDesign({ ...input, version: '4.2.0' }), source, OPTIONS)).not.toBe(
      first,
    )
  })

  it('keeps the eight most recent indexes', () => {
    const design = fakeDesign(input)
    const oldest = utilityIndex(design, { ...source, css: 'oldest' }, OPTIONS)
    for (let count = 0; count < 8; count++) {
      utilityIndex(design, { ...source, css: `newer ${count}` }, OPTIONS)
    }
    expect(utilityIndex(design, { ...source, css: 'newer 0' }, OPTIONS)).toBe(
      utilityIndex(design, { ...source, css: 'newer 0' }, OPTIONS),
    )
    expect(utilityIndex(design, { ...source, css: 'oldest' }, OPTIONS)).not.toBe(oldest)
  })

  it('builds with the root font size it is keyed by', () => {
    const tens = utilityIndex(fakeDesign(input), source, { rootFontSize: 10 })
    expect(names(findByLonghand(tens, d('padding-top', '10px')))).toEqual(['p-4'])
  })
})
