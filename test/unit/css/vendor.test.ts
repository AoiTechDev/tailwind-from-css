// SPEC §5.4 step 6: vendor-prefixed copies of an unprefixed declaration are redundant.
import { describe, expect, it } from 'vitest'
import { normalizeDeclarations } from '../../../src/css/normalize/index.ts'
import { redundantVendorDeclarations } from '../../../src/css/vendor.ts'
import type { Declaration } from '../../../src/types.ts'

const options = { rootFontSize: 16 } as const

function redundant(declarations: Declaration[]): string[] {
  const block = normalizeDeclarations(declarations, options)
  return [...redundantVendorDeclarations(block, options)].map(
    (position) => block[position]?.property ?? '',
  )
}

describe('redundantVendorDeclarations', () => {
  it('finds prefixed copies with equal values and importance', () => {
    expect(
      redundant([
        { property: '-webkit-user-select', value: 'none' },
        { property: 'user-select', value: 'none' },
      ]),
    ).toEqual(['-webkit-user-select'])
    expect(
      redundant([
        { property: '-moz-box-shadow', value: '0 0 0 1px RED, 0 0 #0000' },
        { property: 'box-shadow', value: '0 0 0 1px #f00' },
      ]),
    ).toEqual(['-moz-box-shadow'])
  })

  it('reads a prefixed shorthand as the unprefixed one', () => {
    expect(
      redundant([
        { property: '-webkit-border-radius', value: '4px' },
        { property: 'border-radius', value: '0.25rem' },
      ]),
    ).toEqual(['-webkit-border-radius'])
  })

  it('keeps prefixed declarations that differ or stand alone', () => {
    expect(
      redundant([
        { property: '-webkit-user-select', value: 'text' },
        { property: 'user-select', value: 'none' },
      ]),
    ).toEqual([])
    expect(
      redundant([
        { property: '-webkit-user-select', value: 'none', important: true },
        { property: 'user-select', value: 'none' },
      ]),
    ).toEqual([])
    expect(redundant([{ property: '-webkit-line-clamp', value: '3' }])).toEqual([])
    expect(redundant([{ property: 'user-select', value: 'none' }])).toEqual([])
  })
})
