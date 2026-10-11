import { describe, expect, it } from 'vitest'
import { decodeEscapes, quoteString } from '../../../../src/css/normalize/strings.ts'
import { normalValue } from '../../../helpers/normalize.ts'

const content = (value: string): string => normalValue('content', value)

describe('N42 content and strings', () => {
  it('prints every string with double quotes', () => {
    expect(content("'a'")).toBe('"a"')
    expect(content('"a"')).toBe('"a"')
    expect(content("''")).toBe('""')
    expect(content("'it\\'s'")).toBe('"it\'s"')
    expect(content('\'say "hi"\'')).toBe('"say \\"hi\\""')
  })

  it('resolves escapes to the characters they stand for', () => {
    expect(content('"\\201C"')).toBe('"\u201C"')
    expect(content('"\\61 b"')).toBe('"ab"')
    expect(content('"a\\\nb"')).toBe('"ab"')
    expect(content('"\\0"')).toBe('"\uFFFD"')
    expect(content('"\\😀"')).toBe('"😀"')
  })

  it('escapes only quotes, backslashes and control characters', () => {
    expect(quoteString('a"b\\c')).toBe('"a\\"b\\\\c"')
    expect(quoteString('line\nbreak')).toBe('"line\\a break"')
    expect(decodeEscapes(quoteString('tab\there'))).toBe('"tab\there"')
    expect(decodeEscapes('trailing\\')).toBe('trailing')
  })

  it('quotes url() arguments the same way', () => {
    expect(normalValue('background-image', 'url(a.png)')).toBe('url("a.png")')
    expect(normalValue('background-image', "url( 'a.png' )")).toBe('url("a.png")')
    expect(normalValue('background-image', 'url()')).toBe('url("")')
  })

  it('keeps none, normal and different strings apart', () => {
    expect(content('none')).not.toBe(content('normal'))
    expect(content('""')).not.toBe(content('" "'))
    expect(content('"a"')).not.toBe(content('"A"'))
  })
})
