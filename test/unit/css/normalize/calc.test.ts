import { describe, expect, it } from 'vitest'
import { normalValue } from '../../../helpers/normalize.ts'

const spacing = { variables: new Map([['--spacing', '0.25rem']]) }

describe('N12 calc() folding', () => {
  it('folds constants to one dimension', () => {
    expect(normalValue('width', 'calc(0.25rem * 4)')).toBe('16px')
    expect(normalValue('width', 'calc(10px / 4)')).toBe('2.5px')
    expect(normalValue('width', 'calc(2 * (1px + 2px))')).toBe('6px')
    expect(normalValue('width', 'calc(1px + calc(2px * 3))')).toBe('7px')
    expect(normalValue('z-index', 'calc(2 + 3)')).toBe('5')
    expect(normalValue('width', 'CALC(1PX + 1PX)')).toBe('2px')
  })

  it('substitutes known variables first, as Tailwind spacing needs', () => {
    expect(normalValue('padding-top', 'calc(var(--spacing) * 4)', spacing)).toBe('16px')
    expect(normalValue('margin-top', 'calc(var(--spacing) * -4)', spacing)).toBe('-16px')
    expect(normalValue('margin-top', 'var(--spacing)', spacing)).toBe('4px')
    expect(normalValue('margin-top', 'var(--spacing)', { variables: new Map() })).toBe(
      'var(--spacing)',
    )
  })

  it('substitutes nested variables, but not endlessly', () => {
    const variables = new Map([
      ['--a', 'var(--b)'],
      ['--b', '2px'],
      ['--loop', 'var(--loop)'],
    ])
    expect(normalValue('width', 'calc(var(--a) * 2)', { variables })).toBe('4px')
    expect(normalValue('width', 'var(--loop)', { variables })).toBe('var(--loop)')
  })

  it('prints mixed units as a sorted sum', () => {
    expect(normalValue('width', 'calc(100% - 1rem)')).toBe('calc(100% - 16px)')
    expect(normalValue('width', 'calc(-16px + 100%)')).toBe(
      normalValue('width', 'calc(100% - 1rem)'),
    )
    expect(normalValue('width', 'calc(-1rem + 50vw + 1rem)')).toBe('50vw')
    expect(normalValue('width', 'calc(100% - 100%)')).toBe('0%')
    expect(normalValue('width', 'calc(1px - 1px)')).toBe('0')
    expect(normalValue('width', 'calc(1vw - 1vw + 0%)')).toBe('0%')
  })

  it('keeps infinity and NaN in calc()', () => {
    expect(normalValue('border-top-left-radius', 'calc(infinity * 1px)')).toBe(
      'calc(infinity * 1px)',
    )
    expect(normalValue('width', 'calc(1px / 0)')).toBe('calc(infinity * 1px)')
    expect(normalValue('width', 'calc(-infinity * 1px)')).toBe('calc(-infinity * 1px)')
    expect(normalValue('width', 'calc(NaN * 1px)')).toBe('calc(NaN * 1px)')
    expect(normalValue('z-index', 'calc(infinity)')).toBe('calc(infinity)')
    expect(normalValue('width', 'calc(infinity * 1px + 100%)')).toBe('calc(100% + infinity * 1px)')
  })

  it('uses pi and e', () => {
    expect(normalValue('rotate', 'calc(pi * 1rad)')).toBe('180deg')
    expect(normalValue('z-index', 'calc(e * 1)')).toBe('2.7183')
  })

  it('folds min(), max() and clamp() of one unit', () => {
    expect(normalValue('width', 'min(10px, 2rem)')).toBe('10px')
    expect(normalValue('width', 'max(10px, 2rem)')).toBe('32px')
    expect(normalValue('width', 'clamp(1rem, 2.5rem, 2rem)')).toBe('32px')
    expect(normalValue('width', 'min(100%, calc(48rem + 2px))')).toBe('min(100%,770px)')
  })

  it('keeps calc(infinity * 1px) apart from 9999px', () => {
    expect(normalValue('width', 'calc(infinity * 1px)')).not.toBe(normalValue('width', '9999px'))
  })

  it('leaves expressions with variables or mixed types unfolded, but normalized', () => {
    expect(normalValue('width', 'calc( var(--x)*2 )')).toBe('calc(var(--x) * 2)')
    expect(normalValue('width', 'calc(1px + var(--x))')).toBe('calc(1px + var(--x))')
    expect(normalValue('width', 'calc(PI * var(--x))')).toBe('calc(pi * var(--x))')
    expect(normalValue('width', 'calc((1rem + var(--x)) / 2)')).toBe('calc((16px + var(--x)) / 2)')
    expect(normalValue('width', 'calc(1px + 2)')).toBe('calc(1px + 2)')
    expect(normalValue('width', 'calc(1px * 2px)')).toBe('calc(1px * 2px)')
    expect(normalValue('width', 'calc(1px / 2px)')).toBe('calc(1px / 2px)')
    expect(normalValue('width', 'calc(auto)')).toBe('calc(auto)')
    expect(normalValue('width', 'min(10px, 50%)')).toBe('min(10px,50%)')
    expect(normalValue('width', 'max(1px + 1px, var(--x))')).toBe('max(2px,var(--x))')
    expect(normalValue('width', 'calc(var(--x) * calc(100% - 1px))')).toBe(
      'calc(var(--x) * calc(100% - 1px))',
    )
  })

  it('prints invalid expressions as normalized tokens', () => {
    expect(normalValue('width', 'calc(1px +)')).toBe('calc(1px +)')
    expect(normalValue('width', 'calc(1px 2px)')).toBe('calc(1px 2px)')
    expect(normalValue('width', 'calc((1px +))')).toBe('calc((1px +))')
    expect(normalValue('width', 'calc(* 2)')).toBe('calc(* 2)')
    expect(normalValue('width', 'clamp(1px, 2px)')).toBe('clamp(1px,2px)')
    expect(normalValue('width', 'calc(1px * min(1px, 2))')).toBe('calc(1px * min(1px,2))')
  })

  it('keeps rem when rootFontSize is false', () => {
    expect(normalValue('width', 'calc(0.25rem * 4)', { rootFontSize: false })).toBe('1rem')
    expect(normalValue('width', 'calc(0.25rem * 4)', { rootFontSize: false })).not.toBe('16px')
  })
})

describe('N14 fractions of 100%', () => {
  it('folds a fraction of 100% to a percentage', () => {
    expect(normalValue('width', 'calc(1/2 * 100%)')).toBe('50%')
    expect(normalValue('width', 'calc(1 / 3 * 100%)')).toBe('33.3333%')
    expect(normalValue('width', 'calc(100% / 4)')).toBe('25%')
    expect(normalValue('width', 'calc(13 / 17 * 100%)')).toBe('76.4706%')
  })

  it('matches the percentage it equals and nothing else', () => {
    expect(normalValue('width', 'calc(1/2 * 100%)')).toBe(normalValue('width', '50%'))
    expect(normalValue('width', 'calc(1/2 * 100%)')).not.toBe(normalValue('width', '51%'))
    expect(normalValue('width', 'calc(1/2 * 100vw)')).not.toBe(normalValue('width', '50%'))
  })
})
