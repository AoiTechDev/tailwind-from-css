import { describe, expect, it } from 'vitest'
import { diagnostic, SEVERITIES } from '../../src/diagnostics.ts'

describe('diagnostics', () => {
  it('has the SPEC §7 severities', () => {
    const bySeverity = (severity: string) =>
      Object.entries(SEVERITIES)
        .filter(([, value]) => value === severity)
        .map(([code]) => code)
        .sort()
    expect(bySeverity('error')).toEqual(['TFC101'])
    expect(bySeverity('warning')).toEqual([
      'TFC102',
      'TFC204',
      'TFC303',
      'TFC402',
      'TFC501',
      'TFC502',
    ])
    expect(bySeverity('info')).toEqual([
      'TFC103',
      'TFC104',
      'TFC105',
      'TFC106',
      'TFC201',
      'TFC202',
      'TFC203',
      'TFC301',
      'TFC302',
      'TFC401',
    ])
  })

  it('builds diagnostics with and without a source', () => {
    expect(diagnostic('TFC106', 'dropped')).toEqual({
      code: 'TFC106',
      severity: 'info',
      message: 'dropped',
    })
    const source = {
      property: 'color',
      value: 'red',
      important: false,
      selector: '&',
      conditions: [],
    }
    expect(diagnostic('TFC502', 'failed', source).source).toBe(source)
  })
})
