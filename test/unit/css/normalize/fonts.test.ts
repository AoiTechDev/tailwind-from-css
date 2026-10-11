import { describe, expect, it } from 'vitest'
import { normal, normalValue } from '../../../helpers/normalize.ts'

const family = (value: string): string => normalValue('font-family', value)

describe('N41 font-family lists', () => {
  it('normalizes quotes and whitespace of family names', () => {
    expect(family("'Segoe UI'")).toBe('"Segoe UI"')
    expect(family('Segoe UI')).toBe('"Segoe UI"')
    expect(family('Segoe   UI')).toBe(family('"Segoe UI"'))
    expect(family('ui-sans-serif,  system-ui')).toBe(family('ui-sans-serif, system-ui'))
  })

  it('lowercases generic families and never quotes them', () => {
    expect(family('SANS-SERIF')).toBe('sans-serif')
    expect(family('UI-Monospace, Serif')).toBe('ui-monospace,serif')
    expect(family("ui-sans-serif, system-ui, 'Segoe UI', Helvetica Neue, SANS-SERIF")).toBe(
      'ui-sans-serif,system-ui,"Segoe UI","Helvetica Neue",sans-serif',
    )
  })

  it('keeps a quoted generic name apart from the generic family', () => {
    expect(family('"serif"')).not.toBe(family('serif'))
    expect(family('"serif"')).toBe('"serif"')
  })

  it('keeps single unquoted names as written, since some are browser keywords', () => {
    expect(family('-apple-system')).toBe('-apple-system')
    expect(family('-apple-system')).not.toBe(family('"-apple-system"'))
    expect(family('BlinkMacSystemFont')).toBe('BlinkMacSystemFont')
    expect(family('Arial')).not.toBe(family('arial'))
  })
})

describe('N43 font-weight keywords', () => {
  it('reads normal as 400 and bold as 700', () => {
    expect(normalValue('font-weight', 'bold')).toBe('700')
    expect(normalValue('font-weight', 'BOLD')).toBe('700')
    expect(normalValue('font-weight', 'normal')).toBe('400')
    expect(normal('font', 'bold 12px a')).toContain('font-weight: 700')
  })

  it('keeps relative and other weights as written', () => {
    expect(normalValue('font-weight', 'bolder')).toBe('bolder')
    expect(normalValue('font-weight', 'lighter')).toBe('lighter')
    expect(normalValue('font-weight', '600')).not.toBe(normalValue('font-weight', 'bold'))
  })
})
