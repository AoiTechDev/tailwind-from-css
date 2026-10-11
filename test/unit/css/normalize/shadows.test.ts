import { describe, expect, it } from 'vitest'
import { normalValue } from '../../../helpers/normalize.ts'

const shadow = (value: string): string => normalValue('box-shadow', value)

describe('N40 no-op shadow layers', () => {
  it("makes Tailwind's five-layer shadow equal to its one visible layer", () => {
    const tailwind = [
      '0 0 #0000',
      '0 0 #0000',
      '0 0 #0000',
      '0 0 #0000',
      '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    ].join(', ')
    expect(shadow(tailwind)).toBe(shadow('0 1px 2px 0 rgb(0 0 0 / 0.05)'))
    expect(shadow(tailwind)).toBe('0 1px 2px 0 srgb(0 0 0 / 0.05)')
  })

  it('removes layers that paint nothing; an empty list is none', () => {
    expect(shadow('0 0 #0000')).toBe('none')
    expect(shadow('0 0 0 0 red')).toBe('none')
    expect(shadow('inset 0 0 0 0 red')).toBe('none')
    expect(shadow('0 4px 8px transparent, 0 1px red')).toBe('0 1px 0 0 srgb(255 0 0 / 1)')
    expect(shadow('0 4px 8px oklch(0.5 0.1 20 / 0)')).toBe('none')
    expect(shadow('none')).toBe('none')
  })

  it('prints every layer in one order with defaults filled in', () => {
    expect(shadow('red 0 1px')).toBe('0 1px 0 0 srgb(255 0 0 / 1)')
    expect(shadow('0 1px red inset')).toBe('inset 0 1px 0 0 srgb(255 0 0 / 1)')
    expect(shadow('1px 1px')).toBe('1px 1px 0 0 currentcolor')
    expect(normalValue('text-shadow', '1px 1px 2px #000')).toBe('1px 1px 2px srgb(0 0 0 / 1)')
    expect(normalValue('text-shadow', '#000 1px 1px')).toBe('1px 1px 0 srgb(0 0 0 / 1)')
  })

  it('keeps a value with an unclosed function as written (property-test seed)', () => {
    expect(shadow('0\ncalc(')).toBe('0 calc(')
    expect(shadow(shadow('0\ncalc('))).toBe('0 calc(')
  })

  it('keeps visible layers', () => {
    expect(shadow('0 0 0 1px red')).toBe('0 0 0 1px srgb(255 0 0 / 1)')
    expect(shadow('0 0 0 1px red')).not.toBe('none')
    expect(shadow('inset 0 1px red')).not.toBe(shadow('0 1px red'))
  })

  it('keeps layers it cannot read as written', () => {
    expect(shadow('0 1px var(--c)')).toBe('0 1px var(--c)')
    expect(shadow('var(--a), 0 0 #0000')).toBe('var(--a)')
    expect(shadow('1px')).toBe('1px')
    expect(shadow('1px 1px 1px 1px 1px')).toBe('1px 1px 1px 1px 1px')
    expect(shadow('red blue 1px 1px')).toBe('srgb(255 0 0 / 1) srgb(0 0 255 / 1) 1px 1px')
    expect(shadow('inset inset 1px 1px')).toBe('inset inset 1px 1px')
  })
})
