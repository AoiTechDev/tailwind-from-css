import { describe, expect, it } from 'vitest'
import { normalValue } from '../../../helpers/normalize.ts'

describe('N15 times in ms', () => {
  it('converts seconds to milliseconds', () => {
    expect(normalValue('transition-duration', '0.15s')).toBe('150ms')
    expect(normalValue('transition-duration', '.15S')).toBe('150ms')
    expect(normalValue('animation-delay', '2s')).toBe('2000ms')
    expect(normalValue('transition-delay', '150ms')).toBe(normalValue('transition-delay', '0.15s'))
  })

  it('keeps different times and zero times apart from zero lengths', () => {
    expect(normalValue('transition-duration', '0.15s')).not.toBe(
      normalValue('transition-duration', '15ms'),
    )
    expect(normalValue('transition-duration', '0s')).toBe('0ms')
    expect(normalValue('transition-duration', '1s')).not.toBe(
      normalValue('transition-duration', '1ms'),
    )
  })
})

describe('N16 angles in deg', () => {
  it('converts turn, grad and rad to degrees', () => {
    expect(normalValue('rotate', '0.25turn')).toBe('90deg')
    expect(normalValue('rotate', '100grad')).toBe('90deg')
    expect(normalValue('rotate', '1rad')).toBe('57.2958deg')
    expect(normalValue('transform', 'rotate(0.5TURN) skew(10deg)')).toBe(
      'rotate(180deg) skew(10deg)',
    )
  })

  it('keeps different angles apart', () => {
    expect(normalValue('rotate', '0.25turn')).not.toBe(normalValue('rotate', '0.24turn'))
    expect(normalValue('rotate', '0.5turn')).not.toBe(normalValue('rotate', '90deg'))
  })
})
