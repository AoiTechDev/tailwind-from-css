import { describe, expect, it } from 'vitest'
import { normalizeDeclarations } from '../../../../src/css/normalize/index.ts'
import { formatNumber, parseDimension } from '../../../../src/css/normalize/lengths.ts'
import { normal, normalValue } from '../../../helpers/normalize.ts'

describe('N10 lengths to px', () => {
  it('converts rem with the root font size', () => {
    expect(normalValue('width', '0.875rem')).toBe('14px')
    expect(normalValue('width', '1.4rem', { rootFontSize: 10 })).toBe('14px')
    expect(normalValue('width', '14px')).toBe(normalValue('width', '0.875rem'))
  })

  it('converts absolute units', () => {
    expect(normalValue('width', '12pt')).toBe('16px')
    expect(normalValue('width', '1in')).toBe('96px')
    expect(normalValue('width', '1pc')).toBe('16px')
    expect(normalValue('width', '2.54cm')).toBe('96px')
    expect(normalValue('width', '25.4mm')).toBe('96px')
    expect(normalValue('width', '4Q')).toBe('3.7795px')
  })

  it('rounds to 4 decimals', () => {
    expect(normalValue('width', '1.234567px')).toBe('1.2346px')
    expect(normalValue('width', '.5px')).toBe('0.5px')
    expect(normalValue('width', '+1e1px')).toBe('10px')
  })

  it('converts em when the block sets an absolute font size', () => {
    const block = normalizeDeclarations(
      [
        { property: 'font-size', value: '14px' },
        { property: 'padding-top', value: '1em' },
        { property: 'line-height', value: '1.5em' },
      ],
      { rootFontSize: 16 },
    )
    expect(block.map((d) => d.value)).toEqual(['14px', '14px', '21px'])
  })

  it('resolves em against the winning font size, important first', () => {
    const block = normalizeDeclarations(
      [
        { property: 'font-size', value: '10px', important: true },
        { property: 'font-size', value: '20px' },
        { property: 'font', value: 'bold 1.5em/2em a' },
        { property: 'margin', value: '1em' },
      ],
      { rootFontSize: 16 },
    )
    expect(block.find((d) => d.property === 'margin-top')?.value).toBe('10px')
    expect(block.find((d) => d.property === 'line-height')?.value).toBe('20px')
    expect(block.filter((d) => d.property === 'font-size').map((d) => d.value)).toEqual([
      '10px',
      '20px',
      '1.5em',
    ])
  })

  it('takes the font size from the font shorthand', () => {
    const block = normalizeDeclarations(
      [
        { property: 'font', value: '12px a' },
        { property: 'width', value: '2em' },
      ],
      { rootFontSize: 16 },
    )
    expect(block.at(-1)?.value).toBe('24px')
  })

  it('keeps rem apart from px when rootFontSize is false', () => {
    expect(normalValue('width', '1rem', { rootFontSize: false })).toBe('1rem')
    expect(normalValue('width', '1rem', { rootFontSize: false })).not.toBe(
      normalValue('width', '16px'),
    )
  })

  it('keeps em without a known basis, and font-size em, as written', () => {
    expect(normalValue('width', '1em')).toBe('1em')
    expect(
      normalizeDeclarations(
        [
          { property: 'font-size', value: '2em' },
          { property: 'width', value: '1em' },
        ],
        { rootFontSize: 16 },
      ).map((d) => d.value),
    ).toEqual(['2em', '1em'])
    expect(normalValue('width', '1em', { emBasis: 10 })).toBe('10px')
    expect(normalValue('font-size', '1em', { emBasis: 10 })).toBe('1em')
  })

  it('keeps relative units as written', () => {
    expect(normalValue('width', '50vw')).toBe('50vw')
    expect(normalValue('width', '2ch')).toBe('2ch')
    expect(normalValue('width', '50vw')).not.toBe(normalValue('width', '50%'))
  })
})

describe('N11 zero lengths', () => {
  it('drops the unit of a zero length', () => {
    expect(normalValue('margin-top', '0px')).toBe('0')
    expect(normalValue('margin-top', '0rem')).toBe('0')
    expect(normalValue('margin-top', '-0em')).toBe('0')
    expect(normalValue('width', '0vw')).toBe(normalValue('width', '0'))
    expect(normalValue('transform', 'translate(0px, 0px)')).toBe('translate(0,0)')
  })

  it('makes Tailwind 4.3.0 and 4.3.1 zero spacing equal', () => {
    const before = normal('margin', 'calc(var(--spacing) * 0)', {
      variables: new Map([['--spacing', '0.25rem']]),
    })
    expect(before).toBe(normal('margin', '0px'))
    expect(before).toBe(normal('margin', '0'))
  })

  it('keeps the unit for percentages, times and angles', () => {
    expect(normalValue('width', '0%')).toBe('0%')
    expect(normalValue('transition-duration', '0s')).toBe('0ms')
    expect(normalValue('rotate', '0turn')).toBe('0deg')
  })

  it('keeps the unit where a bare 0 is a number or a flex factor', () => {
    expect(normalValue('flex-basis', '0px')).toBe('0px')
    expect(normalValue('flex-basis', '0px')).not.toBe(normalValue('flex-basis', '0'))
    expect(normalValue('flex-basis', '0px')).not.toBe(normalValue('flex-basis', '0%'))
    expect(normalValue('line-height', '0px')).not.toBe(normalValue('line-height', '0'))
  })

  it('keeps the unit inside math functions and var() fallbacks', () => {
    expect(normalValue('width', 'calc(0px + var(--x))')).toBe('calc(0px + var(--x))')
    expect(normalValue('width', 'var(--x, 0px)')).toBe('var(--x,0px)')
    expect(normalValue('width', 'max(0px, var(--x))')).toBe('max(0px,var(--x))')
  })
})

describe('N13 numbers and percentages', () => {
  it('reads a percentage as a number where the grammar makes them equal', () => {
    expect(normalValue('opacity', '50%')).toBe('0.5')
    expect(normalValue('opacity', '50%')).toBe(normalValue('opacity', '.5'))
    expect(normalValue('fill-opacity', '25%')).toBe('0.25')
    expect(normalValue('stroke-opacity', '100%')).toBe('1')
    expect(normalValue('scale', '50% 150%')).toBe('0.5 1.5')
  })

  it('keeps percentages elsewhere', () => {
    expect(normalValue('width', '50%')).toBe('50%')
    expect(normalValue('filter', 'opacity(50%)')).toBe('opacity(50%)')
    expect(normalValue('opacity', '0.5')).not.toBe(normalValue('opacity', '0.6'))
  })
})

describe('numbers', () => {
  it('formats without exponent, trailing zeros or negative zero', () => {
    expect(formatNumber(1.5)).toBe('1.5')
    expect(formatNumber(-0)).toBe('0')
    expect(formatNumber(-0.00001)).toBe('0')
    expect(formatNumber(2 / 3, 2)).toBe('0.67')
    expect(formatNumber(1e20)).toBe('100000000000000000000')
  })

  it('parses only finite numbers with a plain unit', () => {
    expect(parseDimension('-.5EM')).toEqual({ value: -0.5, unit: 'em' })
    expect(parseDimension('1e999px')).toBeUndefined()
    expect(parseDimension('1px+2px')).toBeUndefined()
    expect(parseDimension('auto')).toBeUndefined()
  })
})
