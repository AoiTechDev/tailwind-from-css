import { describe, expect, it } from 'vitest'
import {
  normalizeColor,
  normalizeColorMix,
  quantizedKey,
  toleranceKeys,
} from '../../../../src/css/normalize/colors.ts'
import { normalValuesEqual } from '../../../../src/css/normalize/index.ts'
import { normalValue } from '../../../helpers/normalize.ts'

const color = (value: string): string => normalValue('color', value)

describe('N20 sRGB colors', () => {
  it('gives every sRGB syntax of one color the same normal form', () => {
    const white = 'srgb(255 255 255 / 1)'
    for (const value of [
      '#FFF',
      '#ffffff',
      '#ffff',
      'rgb(255,255,255)',
      'rgb(255 255 255 / 100%)',
      'rgba(255, 255, 255, 1)',
      'rgb(100% 100% 100%)',
      'white',
      'WHITE',
      'hsl(0 0% 100%)',
      'hsla(120deg, 50%, 100%, 1)',
      'hwb(0 100% 0%)',
      'color(srgb 1 1 1)',
    ]) {
      expect(color(value), value).toBe(white)
    }
  })

  it('keeps alpha, and transparent is black at alpha 0', () => {
    expect(color('rgba(0,0,0,.5)')).toBe('srgb(0 0 0 / 0.5)')
    expect(color('#0000')).toBe('srgb(0 0 0 / 0)')
    expect(color('transparent')).toBe('srgb(0 0 0 / 0)')
    expect(color('rgb(0 0 0 / 150%)')).toBe('srgb(0 0 0 / 1)')
  })

  it('clamps legacy syntaxes like browsers do, but not color(srgb …)', () => {
    expect(color('rgb(300 -5 0)')).toBe('srgb(255 0 0 / 1)')
    expect(color('color(srgb 1.2 0 0)')).toBe('srgb(306 0 0 / 1)')
  })

  it('rounds channels to 2 decimals and keeps missing ones', () => {
    expect(color('hsl(0 84% 60%)')).toBe('srgb(238.68 67.32 67.32 / 1)')
    expect(color('rgb(none 0 0)')).toBe('srgb(none 0 0 / 1)')
  })

  it('reads its own normal form back unchanged', () => {
    expect(color('srgb(238.68 67.32 67.32 / 1)')).toBe('srgb(238.68 67.32 67.32 / 1)')
    expect(color('srgb(none 0 0 / 0.5)')).toBe('srgb(none 0 0 / 0.5)')
  })

  it('treats channels within half an 8-bit step as equal', () => {
    expect(normalValuesEqual(color('hsl(0 84% 60%)'), color('rgb(239 67 67)'))).toBe(true)
    expect(normalValuesEqual('srgb(0 0 0 / 0.5)', 'srgb(0 0 0 / 0.501)')).toBe(true)
    expect(normalValuesEqual('a srgb(1 2 3 / 1) b', 'a srgb(1.4 2 3 / 1) b')).toBe(true)
    expect(normalValuesEqual('srgb(none 0 0 / 1)', 'srgb(none 0 0 / 1)')).toBe(true)
  })

  it('keeps colors more than half a step apart, and other text, different', () => {
    expect(normalValuesEqual(color('hsl(0 84% 60%)'), color('#ef4444'))).toBe(false)
    expect(normalValuesEqual('srgb(0 0 0 / 0.5)', 'srgb(0 0 0 / 0.51)')).toBe(false)
    expect(normalValuesEqual('srgb(none 0 0 / 1)', 'srgb(0 0 0 / 1)')).toBe(false)
    expect(normalValuesEqual('a srgb(0 0 0 / 1)', 'b srgb(0 0 0 / 1)')).toBe(false)
    expect(normalValuesEqual('srgb(0 0 0 / 1)', 'srgb(0 0 0 / 1) srgb(0 0 0 / 1)')).toBe(false)
  })

  it('keeps v3 red-500 apart from v4 red-500', () => {
    expect(color('#ef4444')).not.toBe(color('oklch(63.7% 0.237 25.331)'))
    expect(color('rgb(255 0 0 / 0)')).not.toBe(color('transparent'))
    expect(color('#fff')).not.toBe(color('#fffe'))
  })
})

describe('N21 other color spaces', () => {
  it('keeps each space, with L as a fraction and 4 decimals', () => {
    expect(color('oklch(63.7% 0.237 25.331)')).toBe('oklch(0.637 0.237 25.331 / 1)')
    expect(color('oklch(0.637 0.237 25.331)')).toBe('oklch(0.637 0.237 25.331 / 1)')
    expect(color('OKLCH(0.63712345 0.237 25.331deg / 50%)')).toBe(
      'oklch(0.6371 0.237 25.331 / 0.5)',
    )
    expect(color('oklab(50% 0.1 -0.1)')).toBe('oklab(0.5 0.1 -0.1 / 1)')
    expect(color('lab(50% 40 59.5)')).toBe('lab(50 40 59.5 / 1)')
    expect(color('lch(50 30 0.5turn)')).toBe('lch(50 30 180 / 1)')
  })

  it('prints color() spaces with their CSS names', () => {
    expect(color('color(display-p3 1 0 0)')).toBe('color(display-p3 1 0 0 / 1)')
    expect(color('color(rec2020 1 0 0)')).toBe('color(rec2020 1 0 0 / 1)')
    expect(color('color(a98-rgb 1 0 0)')).toBe('color(a98-rgb 1 0 0 / 1)')
    expect(color('color(prophoto-rgb 1 0 0)')).toBe('color(prophoto-rgb 1 0 0 / 1)')
    expect(color('color(srgb-linear 1 0 0)')).toBe('color(srgb-linear 1 0 0 / 1)')
    expect(color('color(xyz 0.1 0.2 0.3)')).toBe(color('color(xyz-d65 0.1 0.2 0.3)'))
    expect(color('color(xyz-d50 0.1 0.2 0.3)')).toBe('color(xyz-d50 0.1 0.2 0.3 / 1)')
  })

  it('never equates colors across spaces', () => {
    expect(color('oklch(1 0 0)')).not.toBe(color('white'))
    expect(color('color(display-p3 1 1 1)')).not.toBe(color('white'))
    expect(color('oklch(0.5 0 none)')).not.toBe(color('oklch(0.5 0 0)'))
  })

  it('leaves what culori cannot read as written', () => {
    expect(color('rgb(from red r g b)')).toBe('rgb(from srgb(255 0 0 / 1) r g b)')
    expect(color('rgb(var(--r) 0 0)')).toBe('rgb(var(--r) 0 0)')
    expect(normalizeColor('#12345')).toBeUndefined()
    // culori throws on this one (property-test seed).
    expect(normalizeColor('rgb(9a)')).toBeUndefined()
    expect(color('rgb(9a)')).toBe('rgb(9a)')
  })
})

describe('N22 color-mix with transparent', () => {
  it('is the other color with its alpha scaled by its weight', () => {
    expect(color('color-mix(in oklab, #000 50%, transparent)')).toBe(color('rgb(0 0 0 / 0.5)'))
    expect(color('color-mix(in srgb, transparent, red 25%)')).toBe('srgb(255 0 0 / 0.25)')
    expect(color('color-mix(in oklch, rgb(0 0 0 / 0.5) 50%, transparent)')).toBe(
      'srgb(0 0 0 / 0.25)',
    )
    expect(color('color-mix(in srgb, red, transparent)')).toBe('srgb(255 0 0 / 0.5)')
    expect(color('color-mix(in srgb, red, transparent 75%)')).toBe('srgb(255 0 0 / 0.25)')
  })

  it("matches Tailwind's opacity modifier", () => {
    const variables = new Map([['--color-red-500', 'oklch(63.7% 0.237 25.331)']])
    expect(
      normalValue(
        'background-color',
        'color-mix(in oklab, var(--color-red-500) 50%, transparent)',
        {
          variables,
        },
      ),
    ).toBe('oklch(0.637 0.237 25.331 / 0.5)')
  })

  it('scales alpha down when the weights add up to less than 100%', () => {
    expect(color('color-mix(in srgb, red 30%, transparent 20%)')).toBe('srgb(255 0 0 / 0.3)')
    expect(color('color-mix(in srgb, red 60%, transparent 60%)')).toBe('srgb(255 0 0 / 0.5)')
  })

  it('keeps other mixes as written', () => {
    expect(color('color-mix(in srgb, red 50%, blue)')).toBe(
      'color-mix(in srgb,srgb(255 0 0 / 1) 50%,srgb(0 0 255 / 1))',
    )
    expect(color('color-mix(in oklab, var(--x) 50%, transparent)')).toBe(
      'color-mix(in oklab,var(--x) 50%,srgb(0 0 0 / 0))',
    )
    expect(color('color-mix(in srgb, red 0%, transparent 0%)')).toBe(
      'color-mix(in srgb,srgb(255 0 0 / 1) 0%,srgb(0 0 0 / 0) 0%)',
    )
    expect(color('color-mix(in srgb, transparent, transparent)')).toBe(
      'color-mix(in srgb,srgb(0 0 0 / 0),srgb(0 0 0 / 0))',
    )
    expect(normalizeColorMix('color-mix(srgb, a, b)')).toBe('color-mix(srgb, a, b)')
    expect(normalizeColorMix('color-mix(in srgb,a b c,d)')).toBe('color-mix(in srgb,a b c,d)')
    expect(normalizeColorMix('color-mix(in srgb,a,b,c)')).toBe('color-mix(in srgb,a,b,c)')
    expect(normalizeColorMix('color-mix(in srgb,srgb(0 0 0 / 1) x%,srgb(0 0 0 / 0))')).toBe(
      'color-mix(in srgb,srgb(0 0 0 / 1) x%,srgb(0 0 0 / 0))',
    )
  })

  it('keeps different weights apart', () => {
    expect(color('color-mix(in oklab, #000 40%, transparent)')).not.toBe(
      color('color-mix(in oklab, #000 50%, transparent)'),
    )
    expect(color('color-mix(in oklab, #000 50%, transparent)')).not.toBe(color('#000'))
  })
})

describe('N23 currentcolor', () => {
  it('lowercases currentColor everywhere', () => {
    expect(color('currentColor')).toBe('currentcolor')
    expect(normalValue('fill', 'CURRENTCOLOR')).toBe('currentcolor')
    expect(normalValue('box-shadow', '0 1px currentColor')).toBe('0 1px 0 0 currentcolor')
    expect(normalValue('list-style-type', 'currentColor')).toBe('currentcolor')
  })

  it('keeps currentcolor apart from concrete colors and keywords', () => {
    expect(color('currentColor')).not.toBe(color('black'))
    expect(color('currentColor')).not.toBe(color('inherit'))
  })
})

describe('normalizeColor cache', () => {
  it('gives the same answers before and after the cache fills up', () => {
    const first = normalizeColor('#123456')
    for (let blue = 0; blue < 5000; blue++) {
      expect(normalizeColor(`rgb(1 2 ${blue % 256} / ${blue / 5000})`)).toMatch(/^srgb\(1 2 /)
    }
    expect(normalizeColor('#123456')).toBe(first)
    expect(normalizeColor('nope')).toBeUndefined()
    expect(normalizeColor('nope')).toBeUndefined()
  })
})

describe('index keys for the N20 tolerance', () => {
  it('rounds every srgb() channel to an 8-bit step', () => {
    expect(quantizedKey('srgb(10.4 20.5 255 / 0.05)')).toBe('srgb(10 21 255 / 13)')
    expect(quantizedKey('0 1px 2px 0 srgb(0 0 0 / 1), srgb(none 1 2 / 0)')).toBe(
      '0 1px 2px 0 srgb(0 0 0 / 255), srgb(none 1 2 / 0)',
    )
    expect(quantizedKey('oklch(0.637 0.237 25.331 / 1)')).toBe('oklch(0.637 0.237 25.331 / 1)')
  })

  it('lists every key a color within the tolerance can have, the rounded one first', () => {
    expect(toleranceKeys('srgb(10 20 30 / 1)', 64)).toEqual(['srgb(10 20 30 / 255)'])
    expect(toleranceKeys('srgb(10.5 20 30 / 1)', 64)).toEqual([
      'srgb(11 20 30 / 255)',
      'srgb(10 20 30 / 255)',
    ])
    expect(toleranceKeys('srgb(10.2 none 30 / 0.5)', 64)).toEqual([
      'srgb(10 none 30 / 128)',
      'srgb(10 none 30 / 127)',
      'srgb(11 none 30 / 128)',
      'srgb(11 none 30 / 127)',
    ])
    expect(toleranceKeys('none', 64)).toEqual(['none'])
  })

  it('finds the key of every value that compares equal', () => {
    const pairs = [
      ['srgb(10.4 20 30 / 1)', 'srgb(10.6 20 30 / 1)'],
      ['srgb(10.5 20 30 / 1)', 'srgb(10.01 20 30 / 1)'],
      ['srgb(0 0 0 / 0.05)', 'srgb(0 0 0 / 0.0510)'],
      ['a srgb(0 0 0 / 1) b srgb(1.5 2 3 / 1)', 'a srgb(0.2 0 0 / 1) b srgb(1.9 2 3 / 1)'],
    ] as const
    for (const [a, b] of pairs) {
      expect(normalValuesEqual(a, b)).toBe(true)
      expect(toleranceKeys(a, 64)).toContain(quantizedKey(b))
      expect(toleranceKeys(b, 64)).toContain(quantizedKey(a))
    }
  })

  it('falls back to the rounded key alone beyond the limit', () => {
    expect(toleranceKeys('srgb(0.5 0.5 0.5 / 0.5)', 8)).toEqual(['srgb(1 1 1 / 128)'])
    expect(toleranceKeys('srgb(0.5 0.5 0.5 / 0.5)', 16)).toHaveLength(16)
  })
})
