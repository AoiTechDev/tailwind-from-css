import fc from 'fast-check'
import { beforeAll, describe, expect, it } from 'vitest'
import { createConverter } from '../../src/converter.ts'
import { normalizeConditions } from '../../src/css/conditions.ts'
import { toDeclarations } from '../../src/css/declarations.ts'
import {
  type NormalDeclaration,
  type NormalizeOptions,
  normalizeDeclaration,
  normalValuesEqual,
} from '../../src/css/normalize/index.ts'
import { normalizeSelector } from '../../src/css/selector.ts'
import { matchInput } from '../../src/match/exact.ts'
import type { TailwindDesignSystem } from '../../src/tailwind/adapter.ts'
import {
  type Context,
  contextKey,
  effectiveDeclarations,
  normalizeContext,
} from '../../src/tailwind/effective.ts'
import type {
  ConversionResult,
  Converter,
  Declaration,
  SourceRef,
  StyleInput,
} from '../../src/types.ts'
import { designSystem } from '../helpers/design-system.ts'

// TESTING §2.4. The normalizer must be idempotent, n(n(x)) == n(x), on valid and malformed input.
// Conversions must round-trip through Tailwind (P1), account for every declaration (P2), and be
// deterministic (P3), independent of declaration order (P4) and exact in `exact` mode (P5).

const number = fc.integer({ min: -20_000, max: 20_000 }).map((n) => n / 100)
const positive = fc.integer({ min: 0, max: 20_000 }).map((n) => n / 100)
const byte = fc.integer({ min: 0, max: 255 })
const unit = fc.constantFrom('px', 'rem', 'em', '%', 'pt', 'vw', 'ch', 'in')
const length = fc.oneof(
  fc.tuple(number, unit).map(([value, u]) => `${value}${u}`),
  fc.constant('0'),
  fc.constant('auto'),
)

const hex = fc
  .array(fc.constantFrom(...'0123456789abcdefABCDEF'), { minLength: 3, maxLength: 8 })
  .filter((digits) => digits.length !== 5 && digits.length !== 7)
  .map((digits) => `#${digits.join('')}`)

const color = fc.oneof(
  hex,
  fc.tuple(byte, byte, byte).map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`),
  fc
    .tuple(byte, byte, byte, fc.double({ min: 0, max: 1, noNaN: true }))
    .map(([r, g, b, a]) => `rgba(${r} ${g} ${b} / ${a})`),
  fc
    .tuple(fc.integer({ min: 0, max: 360 }), byte, byte)
    .map(([h, s, l]) => `hsl(${h}deg ${s % 101}% ${l % 101}%)`),
  fc.tuple(byte, byte, byte).map(([h, w, b]) => `hwb(${h} ${w % 101}% ${b % 101}%)`),
  fc
    .tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 400 }), positive)
    .map(([l, c, h]) => `oklch(${l / 10}% ${c / 1000} ${h})`),
  fc.tuple(byte, byte).map(([a, b]) => `oklab(0.5 ${(a - 128) / 400} ${(b - 128) / 400} / 50%)`),
  fc
    .tuple(byte, byte, byte)
    .map(([r, g, b]) => `color(display-p3 ${r / 255} ${g / 255} ${b / 255})`),
  fc.constantFrom('red', 'Transparent', 'currentColor', 'rebeccapurple', 'canvastext'),
  fc
    .tuple(byte, fc.integer({ min: 0, max: 100 }))
    .map(([r, p]) => `color-mix(in oklab, rgb(${r} 0 0) ${p}%, transparent)`),
)

const calc = fc.oneof(
  fc.tuple(length, length).map(([a, b]) => `calc(${a} + ${b})`),
  fc.tuple(length, number).map(([a, b]) => `calc(${a} * ${b})`),
  fc.integer({ min: 1, max: 12 }).map((d) => `calc(1 / ${d} * 100%)`),
  fc.tuple(length, length).map(([a, b]) => `min(${a}, ${b})`),
  fc.constant('calc(infinity * 1px)'),
  fc.tuple(length).map(([a]) => `calc(${a} - var(--x))`),
)

const time = fc.tuple(positive, fc.constantFrom('s', 'ms', 'S')).map(([v, u]) => `${v}${u}`)
const angle = fc
  .tuple(number, fc.constantFrom('deg', 'turn', 'rad', 'grad'))
  .map(([v, u]) => `${v}${u}`)
const family = fc.constantFrom(
  'Arial',
  "'Segoe UI'",
  'Helvetica Neue',
  'SANS-SERIF',
  '"serif"',
  'system-ui',
  '-apple-system',
)
const shadowLayer = fc
  .tuple(fc.boolean(), fc.array(length, { minLength: 2, maxLength: 4 }), fc.option(color))
  .map(([inset, lengths, paint]) => [inset ? 'inset' : '', ...lengths, paint ?? ''].join(' '))
const lineStyle = fc.constantFrom('solid', 'dashed', 'none', 'double')

const declaration: fc.Arbitrary<[string, string]> = fc.oneof(
  fc.tuple(
    fc.constantFrom('width', 'margin-top', 'padding-left', 'top', 'flex-basis', 'line-height'),
    fc.oneof(length, calc),
  ),
  fc.tuple(
    fc.constantFrom('margin', 'padding', 'inset', 'border-radius', 'gap'),
    fc.array(length, { minLength: 1, maxLength: 4 }).map((v) => v.join(' ')),
  ),
  fc.tuple(fc.constantFrom('color', 'background-color', 'border-top-color', 'fill'), color),
  fc.tuple(
    fc.constant('box-shadow'),
    fc.array(shadowLayer, { minLength: 1, maxLength: 5 }).map((v) => v.join(', ')),
  ),
  fc.tuple(
    fc.constant('text-shadow'),
    fc.array(shadowLayer, { minLength: 1, maxLength: 3 }).map((v) => v.join(', ')),
  ),
  fc.tuple(
    fc.constant('font-family'),
    fc.array(family, { minLength: 1, maxLength: 5 }).map((v) => v.join(', ')),
  ),
  fc.tuple(
    fc.constant('font'),
    fc
      .tuple(fc.constantFrom('', 'bold ', 'italic 300 '), length, family)
      .map(([p, s, f]) => `${p}${s}/1.5 ${f}`),
  ),
  fc.tuple(
    fc.constantFrom('border', 'outline', 'border-left'),
    fc.tuple(length, lineStyle, color).map((parts) => parts.join(' ')),
  ),
  fc.tuple(
    fc.constant('transition'),
    fc
      .tuple(
        fc.constantFrom('opacity', 'all', 'transform'),
        time,
        fc.constantFrom('ease', 'linear', 'cubic-bezier(0.4, 0, 0.2, 1)'),
      )
      .map((parts) => parts.join(' ')),
  ),
  fc.tuple(fc.constant('flex'), fc.constantFrom('1', 'none', 'auto', '2 3', '1 1 0', '0 0 30px')),
  fc.tuple(
    fc.constantFrom('opacity', 'scale'),
    fc.oneof(
      positive.map(String),
      positive.map((v) => `${v}%`),
    ),
  ),
  fc.tuple(fc.constant('rotate'), angle),
  fc.tuple(
    fc.constant('transform'),
    angle.map((a) => `rotate(${a}) translate(1rem, 0px)`),
  ),
  fc.tuple(fc.constantFrom('transition-duration', 'animation-delay'), time),
  fc.tuple(
    fc.constant('content'),
    fc.constantFrom("'a'", '"b"', "'it\\'s'", 'none', 'normal', '"\\201C"'),
  ),
  fc.tuple(
    fc.constant('background'),
    fc
      .tuple(color, fc.constantFrom('', ' url(a.png) no-repeat center / cover'))
      .map(([c, rest]) => `${c}${rest}`),
  ),
  fc.tuple(fc.constant('--custom'), fc.string()),
)

const options: NormalizeOptions = {
  rootFontSize: 16,
  variables: new Map([['--spacing', '0.25rem']]),
}

const normalize = (property: string, value: string): NormalDeclaration[] =>
  normalizeDeclaration({ property, value }, options)

describe('P1 round trip (normalization is idempotent)', () => {
  it('declarations', () => {
    fc.assert(
      fc.property(declaration, fc.boolean(), ([property, value], important) => {
        const once = normalizeDeclaration({ property, value, important }, options)
        const twice = once.flatMap((d) => normalizeDeclaration(d, options))
        expect(twice).toEqual(once)
      }),
    )
  })

  it('declarations normalize like their own longhands', () => {
    fc.assert(
      fc.property(declaration, ([property, value]) => {
        for (const longhand of normalize(property, value)) {
          expect(normalize(longhand.property, longhand.value)).toEqual([longhand])
        }
      }),
    )
  })

  const feature = fc.oneof(
    fc
      .tuple(fc.constantFrom('min-width', 'max-width', 'min-height'), length)
      .map(([f, v]) => `(${f}: ${v})`),
    fc.tuple(length, fc.constantFrom('<', '<=', '>', '>=')).map(([v, op]) => `(${v} ${op} width)`),
    fc.constantFrom('(hover: hover)', '(prefers-color-scheme: DARK)', '(orientation:portrait)'),
  )
  const condition = fc.oneof(
    fc
      .tuple(
        fc.constantFrom('', 'only screen and ', 'print and ', 'all and '),
        fc.array(feature, { minLength: 1, maxLength: 3 }),
      )
      .map(([prefix, features]) => `@media ${prefix}${features.join(' and ')}`),
    fc
      .array(feature, { minLength: 1, maxLength: 2 })
      .map((features) => `@container card ${features.join(' and ')}`),
    fc.constantFrom(
      '@supports (display:grid)',
      '@starting-style',
      '@media print',
      '@media not (hover: hover)',
    ),
  )

  it('conditions', () => {
    fc.assert(
      fc.property(fc.array(condition, { maxLength: 4 }), (list) => {
        const once = normalizeConditions(list, options)
        expect(normalizeConditions(once, options)).toEqual(once)
      }),
    )
  })

  const simple = fc.constantFrom(
    '.a',
    '#b',
    'div',
    '*',
    '[data-x=y]',
    "[aria-x='z' i]",
    ':hover',
    ':BEFORE',
    '::after',
    ':nth-child(2N + 1)',
    ':nth-child(odd)',
    ':not(*:hover)',
    ':is(.c)',
    ':where(.d)',
    ':has(> p)',
    '&',
  )
  const compound = fc.array(simple, { minLength: 1, maxLength: 3 }).map((parts) => parts.join(''))
  const selector = fc
    .array(fc.tuple(compound, fc.constantFrom(' ', '>', ' + ', '~')), {
      minLength: 1,
      maxLength: 3,
    })
    .map((pairs) =>
      pairs.map(([c, combinator], index) => (index === 0 ? c : `${combinator}${c}`)).join(''),
    )

  it('selectors', () => {
    fc.assert(
      fc.property(selector, (text) => {
        const once = normalizeSelector(text)
        expect(normalizeSelector(once)).toBe(once)
      }),
    )
  })
})

// Malformed input must not make normalization drift or throw either (CSS problems never throw).
const fragment = fc.constantFrom(
  ...'abAB019 .,/()*+-%#"\'\\:;[]!\n'.split(''),
  'px',
  'rem',
  'calc(',
  'var(--x',
  'rgb(',
  'red',
  'inset',
  'url(',
  'none',
  's',
)
const junk = fc.array(fc.oneof(fragment), { maxLength: 14 }).map((parts) => parts.join(''))

describe('P1 on malformed input', () => {
  it('declarations', () => {
    const property = fc.constantFrom(
      'width',
      'color',
      'margin',
      'font',
      'background',
      'box-shadow',
      'content',
      'font-family',
      'transition',
      'animation',
      'flex',
      'border',
      'grid-area',
      'opacity',
      'place-items',
      'list-style',
      'text-decoration',
      'border-radius',
      'mask',
      '--custom',
    )
    fc.assert(
      fc.property(property, junk, (name, value) => {
        const once = normalize(name, value)
        expect(once.flatMap((d) => normalize(d.property, d.value))).toEqual(once)
      }),
    )
  })

  it('conditions', () => {
    const atRule = fc.constantFrom('@media', '@supports', '@container', '@layer', '')
    const list = fc.array(
      fc.tuple(atRule, junk).map(([name, prelude]) => `${name} ${prelude}`),
      { maxLength: 3 },
    )
    fc.assert(
      fc.property(list, (conditions) => {
        const once = normalizeConditions(conditions, options)
        expect(normalizeConditions(once, options)).toEqual(once)
      }),
    )
  })

  it('selectors', () => {
    fc.assert(
      fc.property(junk, (text) => {
        const once = normalizeSelector(text)
        expect(normalizeSelector(once)).toBe(once)
      }),
    )
  })
})

// Converter properties on the default theme. Values are what a stylesheet or a capture tool
// would produce: theme-aligned and arbitrary lengths, colors in several syntaxes, keywords.
const px = fc.integer({ min: 0, max: 80 }).map((n) => `${n}px`)
const signedPx = fc.integer({ min: -40, max: 80 }).map((n) => `${n}px`)
const rem = fc.integer({ min: 0, max: 24 }).map((n) => `${n / 4}rem`)
const percent = fc.constantFrom('25%', '50%', '33.333333%', '100%', '12.5%', '7%')
const spacing = fc.oneof(px, rem, fc.constant('0'))
const paint = fc.oneof(
  hex,
  fc.tuple(byte, byte, byte).map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`),
  fc.tuple(byte, byte, byte).map(([r, g, b]) => `rgba(${r}, ${g}, ${b}, 0.5)`),
  fc.constantFrom('#fff', '#000000', 'white', 'transparent', 'currentColor', '#ef4444'),
)
const keywordDeclaration = fc.constantFrom<[string, string]>(
  ['display', 'flex'],
  ['display', 'grid'],
  ['display', 'none'],
  ['display', 'inline-block'],
  ['position', 'absolute'],
  ['position', 'relative'],
  ['flex-direction', 'column'],
  ['align-items', 'center'],
  ['justify-content', 'space-between'],
  ['text-align', 'center'],
  ['overflow', 'hidden'],
  ['white-space', 'nowrap'],
  ['font-weight', 'bold'],
  ['font-weight', '500'],
  ['cursor', 'pointer'],
  ['text-transform', 'uppercase'],
  ['user-select', 'none'],
  ['-webkit-user-select', 'none'],
  ['outline-style', 'none'],
)
const converterDeclaration: fc.Arbitrary<[string, string]> = fc.oneof(
  fc.tuple(fc.constantFrom('padding', 'padding-left', 'margin-top', 'gap', 'row-gap'), spacing),
  fc.tuple(fc.constantFrom('margin', 'top', 'left', 'margin-right'), fc.oneof(signedPx, rem)),
  fc.tuple(
    fc.constantFrom('padding', 'margin', 'inset'),
    fc.array(spacing, { minLength: 2, maxLength: 4 }).map((v) => v.join(' ')),
  ),
  fc.tuple(fc.constantFrom('width', 'height', 'max-width'), fc.oneof(px, rem, percent)),
  fc.tuple(fc.constantFrom('color', 'background-color', 'border-color', 'fill'), paint),
  fc.tuple(fc.constant('font-size'), fc.oneof(px, rem)),
  fc.tuple(
    fc.constant('line-height'),
    fc.oneof(px, fc.constantFrom('1', '1.25', '1.5', '2', 'normal')),
  ),
  fc.tuple(
    fc.constant('opacity'),
    fc.integer({ min: 0, max: 100 }).map((n) => String(n / 100)),
  ),
  fc.tuple(fc.constant('border-radius'), fc.oneof(px, fc.constantFrom('9999px', '50%'))),
  fc.tuple(
    fc.constant('border-width'),
    fc.integer({ min: 0, max: 8 }).map((n) => `${n}px`),
  ),
  fc.tuple(fc.constant('z-index'), fc.integer({ min: -5, max: 60 }).map(String)),
  fc.tuple(
    fc.constant('box-shadow'),
    fc.constantFrom(
      'none',
      '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      '0 0 0 2px #3b82f6',
      '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    ),
  ),
  fc.tuple(fc.constant('letter-spacing'), fc.constantFrom('-0.025em', '0.05em', '1px', '0')),
  fc.tuple(fc.constant('transition-duration'), fc.constantFrom('150ms', '0.3s', '75ms')),
  fc.tuple(fc.constant('aspect-ratio'), fc.constantFrom('16 / 9', '1 / 1', '4 / 3', 'auto')),
  fc.tuple(fc.constant('content'), fc.constantFrom('"x"', '""', 'none', '"a b"')),
  fc.tuple(fc.constantFrom('--x', '--brand'), fc.constantFrom('1', '#123456', 'a b')),
  keywordDeclaration,
)
const selectors = ['&', '&:hover', '&:focus', '&:first-child', '&[data-state=open]', '.dark &']
const conditionLists: readonly (readonly string[])[] = [
  [],
  ['@media (min-width: 768px)'],
  ['@media (max-width: 767px)'],
  ['@media (hover: hover)'],
  ['@supports (display: grid)'],
]
const styleInput: fc.Arbitrary<StyleInput> = fc
  .tuple(
    fc.array(converterDeclaration, { minLength: 1, maxLength: 5 }),
    fc.boolean(),
    fc.constantFrom(...selectors, '&::before'),
    fc.constantFrom(...conditionLists),
  )
  .map(([pairs, important, selector, conditions]) => ({
    declarations: pairs.map(([property, value], index) => ({
      property,
      value,
      important: important && index === 0,
    })),
    selector,
    conditions: [...conditions],
  }))
const element = fc.array(styleInput, { minLength: 1, maxLength: 3 })

const OPTIONS = { rootFontSize: 16 } as const
let converter: Converter
let design: TailwindDesignSystem

beforeAll(async () => {
  converter = await createConverter()
  design = await designSystem()
}, 60_000)

const contextOf = (style: {
  readonly selector?: string
  readonly conditions?: readonly string[]
}): Context => ({
  selector: style.selector ?? '&',
  conditions: [...(style.conditions ?? [])],
})
const keyOf = (context: Context): string => contextKey(normalizeContext(context, OPTIONS))
const longhands = (property: string, value: string): string[] =>
  normalizeDeclaration({ property, value }, OPTIONS).map((declaration) => declaration.property)

function sameRef(a: SourceRef, b: SourceRef): boolean {
  return (
    a.property === b.property &&
    a.value === b.value &&
    a.important === b.important &&
    keyOf(a) === keyOf(b)
  )
}

/** Longhands per context key that the result says got no class (unconverted or TFC105). */
function lostLonghands(result: ConversionResult): Map<string, Set<string>> {
  const lost = new Map<string, Set<string>>()
  const refs = [
    ...result.unconverted,
    ...result.diagnostics.flatMap((d) => (d.code === 'TFC105' && d.source ? [d.source] : [])),
  ]
  for (const ref of refs) {
    const key = keyOf(ref)
    const set = lost.get(key) ?? new Set<string>()
    for (const longhand of longhands(ref.property, ref.value)) set.add(longhand)
    lost.set(key, set)
  }
  return lost
}

/** Longhands a class's variant chain sets by itself (`before:` sets `content`). */
function variantAdds(className: string, context: Context): string[] {
  let depth = 0
  let end = -1
  for (let index = 0; index < className.length; index++) {
    const char = className[index]
    if (char === '[' || char === '(') depth++
    else if (char === ']' || char === ')') depth--
    else if (char === ':' && depth === 0) end = index
  }
  if (end === -1) return []
  const probe = `${className.slice(0, end)}:[--tfc-probe:0]`
  return effectiveDeclarations(design, [probe], context, OPTIONS).map((d) => d.property)
}

interface Block {
  readonly context: Context
  readonly declarations: Declaration[]
}

/** The element's declarations per context, merged in array order like the converter does. */
function blocks(input: readonly StyleInput[]): Map<string, Block> {
  const found = new Map<string, Block>()
  for (const style of input) {
    const context = contextOf(style)
    const key = keyOf(context)
    const block = found.get(key) ?? { context, declarations: [] }
    block.declarations.push(...toDeclarations(style.declarations).declarations)
    found.set(key, block)
  }
  return found
}

// The nightly job runs 5,000 cases per property; each conversion compiles with Tailwind.
describe('converter properties (default theme, exact mode)', { timeout: 600_000 }, () => {
  it('P1 round trip: the classes generate the converted declarations in every context', () => {
    fc.assert(
      fc.property(element, (input) => {
        const result = converter.convertStyles(input)
        const lost = lostLonghands(result)
        for (const [key, block] of blocks(input)) {
          const missing = lost.get(key) ?? new Set()
          const expected = matchInput(block.declarations, OPTIONS).filter(
            (declaration) => !missing.has(declaration.property),
          )
          const actual = effectiveDeclarations(design, result.classes, block.context, OPTIONS)
          expect(actual.map((d) => d.property)).toEqual(expected.map((d) => d.property))
          actual.forEach((declaration, position) => {
            const wanted = expected[position] as NormalDeclaration
            expect(declaration.important).toBe(wanted.important)
            expect(
              normalValuesEqual(declaration.value, wanted.value),
              `${declaration.property}: ${declaration.value} vs ${wanted.value}`,
            ).toBe(true)
          })
        }
      }),
    )
  })

  it('P2 accounting: every declaration is mapped, unconverted, or dropped with TFC105/TFC106', () => {
    fc.assert(
      fc.property(element, (input) => {
        const result = converter.convertStyles(input)
        for (const style of input) {
          const { declarations, invalid } = toDeclarations(style.declarations)
          for (const declaration of [...declarations, ...invalid]) {
            const ref: SourceRef = {
              property: declaration.property,
              value: declaration.value,
              important: declaration.important === true,
              selector: style.selector ?? '&',
              conditions: [...(style.conditions ?? [])],
            }
            const mapped = result.mappings.some((m) => m.sources.some((s) => sameRef(s, ref)))
            const parts = longhands(ref.property, ref.value)
            const unconverted = result.unconverted.some(
              (entry) =>
                sameRef(entry, ref) ||
                (keyOf(entry) === keyOf(ref) && parts.includes(entry.property)),
            )
            const dropped = result.diagnostics.some(
              (d) =>
                (d.code === 'TFC105' || d.code === 'TFC106') &&
                d.source !== undefined &&
                sameRef(d.source, ref),
            )
            expect(mapped || unconverted || dropped, JSON.stringify(ref)).toBe(true)
          }
        }
        // Exactly one class per longhand: classes of one context never set the same longhand.
        const seen = new Map<string, string>()
        for (const mapping of result.mappings) {
          const context = contextOf(mapping.sources[0] as SourceRef)
          const added = new Set(variantAdds(mapping.className, context))
          const own = effectiveDeclarations(design, [mapping.className], context, OPTIONS)
          for (const declaration of own.filter((d) => !added.has(d.property))) {
            const slot = `${keyOf(context)}|${declaration.property}`
            expect(seen.get(slot), `${slot} set by ${mapping.className}`).toBeUndefined()
            seen.set(slot, mapping.className)
          }
        }
      }),
    )
  })

  it('P3 determinism: converting twice gives the same result and leaves the input alone', () => {
    fc.assert(
      fc.property(element, (input) => {
        const copy = structuredClone(input)
        const first = JSON.stringify(converter.convertStyles(input))
        expect(JSON.stringify(converter.convertStyles(input))).toBe(first)
        expect(input).toEqual(copy)
      }),
    )
  })

  // Declarations whose longhands don't overlap, so their order can't matter to the cascade.
  const disjointBlock = fc
    .array(converterDeclaration, { minLength: 2, maxLength: 6 })
    .map((pairs) => {
      const taken = new Set<string>()
      return pairs.filter(([property, value]) => {
        const parts = longhands(property, value)
        if (parts.length === 0 || parts.some((part) => taken.has(part))) return false
        for (const part of parts) taken.add(part)
        return true
      })
    })
  const permuted = disjointBlock.chain((pairs) =>
    fc.tuple(
      fc.constant(pairs),
      fc.shuffledSubarray(pairs, { minLength: pairs.length, maxLength: pairs.length }),
    ),
  )

  it('P4 order independence: shuffling declarations of one context keeps the classes', () => {
    fc.assert(
      fc.property(
        permuted,
        fc.constantFrom(...selectors),
        fc.constantFrom(...conditionLists),
        ([pairs, shuffled], selector, conditions) => {
          const convert = (list: readonly [string, string][]) =>
            converter.convertStyles({
              selector,
              conditions: [...conditions],
              declarations: list.map(([property, value]) => ({ property, value })),
            }).classes
          expect(convert(shuffled)).toEqual(convert(pairs))
        },
      ),
    )
  })

  it('P5 exactness flag: exact mode applies no relaxation', () => {
    fc.assert(
      fc.property(element, (input) => {
        const result = converter.convertStyles(input)
        expect(result.mappings.filter((mapping) => mapping.relaxation !== undefined)).toEqual([])
        expect(result.diagnostics.map((d) => d.code)).not.toContain('TFC203')
        expect(result.exact).toBe(result.unconverted.length === 0)
      }),
    )
  })
})
