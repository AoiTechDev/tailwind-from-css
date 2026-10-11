import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { normalizeConditions } from '../../src/css/conditions.ts'
import {
  type NormalDeclaration,
  type NormalizeOptions,
  normalizeDeclaration,
} from '../../src/css/normalize/index.ts'
import { normalizeSelector } from '../../src/css/selector.ts'

// P1 (TESTING §2.4). Until the converter exists (M3), the round trip is checked on the
// normalizer itself: normalizing a normal form again must not change it, n(n(x)) == n(x).

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
