import { describe, expect, it } from 'vitest'
import { normalizeDeclaration, normalizeDeclarations } from '../../../../src/css/normalize/index.ts'
import { splitTopLevel } from '../../../../src/css/normalize/split.ts'
import { isColorToken, isLengthToken } from '../../../../src/css/normalize/tokens.ts'

const options = { rootFontSize: 16 } as const

describe('normalizeDeclaration', () => {
  it('lowercases the property and carries important to every longhand', () => {
    expect(
      normalizeDeclaration({ property: 'PADDING', value: '1px 2px', important: true }, options),
    ).toEqual([
      { property: 'padding-top', value: '1px', important: true },
      { property: 'padding-right', value: '2px', important: true },
      { property: 'padding-bottom', value: '1px', important: true },
      { property: 'padding-left', value: '2px', important: true },
    ])
    expect(normalizeDeclaration({ property: 'Color', value: 'RED' }, options)).toEqual([
      { property: 'color', value: 'srgb(255 0 0 / 1)', important: false },
    ])
  })

  it('never expands custom properties', () => {
    expect(normalizeDeclaration({ property: '--margin', value: '0  auto' }, options)).toEqual([
      { property: '--margin', value: '0 auto', important: false },
    ])
  })
})

describe('normalizeDeclarations', () => {
  it('keeps every declaration in order without deduplicating', () => {
    const block = normalizeDeclarations(
      [
        { property: 'color', value: 'red' },
        { property: 'color', value: 'blue' },
      ],
      options,
    )
    expect(block.map((d) => d.value)).toEqual(['srgb(255 0 0 / 1)', 'srgb(0 0 255 / 1)'])
  })

  it('leaves em alone when the font size is not an absolute length', () => {
    const block = normalizeDeclarations(
      [
        { property: 'font-size', value: 'large' },
        { property: 'width', value: '1em' },
      ],
      options,
    )
    expect(block.at(-1)?.value).toBe('1em')
  })
})

describe('value tokens', () => {
  it('splits at top-level separators only', () => {
    expect(splitTopLevel('a  b(c d) "e f" [g h]', ' ')).toEqual(['a', 'b(c d)', '"e f"', '[g h]'])
    expect(splitTopLevel("a,'b,\\'c',d(e,f)", ',')).toEqual(['a', "'b,\\'c'", 'd(e,f)'])
    expect(splitTopLevel('a;b', ';')).toEqual(['a', 'b'])
  })

  it('classifies normalized tokens', () => {
    expect(isLengthToken('0')).toBe(true)
    expect(isLengthToken('calc(100% - 1px)')).toBe(true)
    expect(isLengthToken('300ms')).toBe(false)
    expect(isLengthToken('50%')).toBe(false)
    expect(isColorToken('canvastext')).toBe(true)
    expect(isColorToken('light-dark(srgb(0 0 0 / 1),srgb(255 255 255 / 1))')).toBe(true)
    expect(isColorToken('inset')).toBe(false)
  })
})
