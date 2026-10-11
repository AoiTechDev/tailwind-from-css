import { describe, expect, it } from 'vitest'
import { normalizeValue } from '../../../../src/css/normalize/index.ts'
import { normal, normalValue } from '../../../helpers/normalize.ts'

describe('N02 keyword case', () => {
  it('lowercases keywords, units, functions and hex digits', () => {
    expect(normalValue('display', 'BLOCK')).toBe('block')
    expect(normalValue('width', '10PX')).toBe('10px')
    expect(normalValue('transform', 'TranslateX(1PX)')).toBe('translatex(1px)')
    expect(normalValue('color', '#ABCDEF')).toBe(normalValue('color', '#abcdef'))
    expect(normalValue('position', 'Absolute')).toBe(normalValue('position', 'absolute'))
  })

  it('lowercases CSS-wide keywords in every property', () => {
    expect(normalValue('animation-name', 'INHERIT')).toBe('inherit')
    expect(normalValue('--x', 'INHERIT')).toBe('INHERIT')
  })

  it('keeps the case of strings, urls, custom idents and variable names', () => {
    expect(normalValue('content', '"ABC"')).toBe('"ABC"')
    expect(normalValue('background-image', 'URL(Foo.PNG)')).toBe('url("Foo.PNG")')
    expect(normalValue('animation-name', 'MySpin')).toBe('MySpin')
    expect(normalValue('grid-template-areas', '"Head Head"')).toBe('"Head Head"')
    expect(normalValue('color', 'VAR(--Brand)')).toBe('var(--Brand)')
    expect(normalValue('counter-reset', 'Chapter 2')).toBe('Chapter 2')
  })

  it('reads named colors only where a color can appear', () => {
    expect(normalValue('animation-name', 'red')).toBe('red')
    expect(normalValue('outline-color', 'Red')).toBe('srgb(255 0 0 / 1)')
  })

  it('keeps differently cased custom idents apart', () => {
    expect(normalValue('animation-name', 'Spin')).not.toBe(normalValue('animation-name', 'spin'))
    expect(normalValue('grid-row-start', 'Header')).not.toBe(
      normalValue('grid-row-start', 'header'),
    )
    expect(normalValue('content', '"A"')).not.toBe(normalValue('content', '"a"'))
  })
})

describe('N03 whitespace and commas', () => {
  it('prints one space between tokens and none inside parentheses or around commas', () => {
    expect(normalValue('transform', 'translate( 10px ,  20px )   rotate(1deg)')).toBe(
      'translate(10px,20px) rotate(1deg)',
    )
    expect(normalValue('transition-property', 'opacity , transform')).toBe('opacity,transform')
    expect(normalValue('font-feature-settings', '"liga"   1')).toBe('"liga" 1')
  })

  it('prints a slash with spaces around it', () => {
    expect(normalValue('aspect-ratio', '16/9')).toBe('16 / 9')
    expect(normalValue('aspect-ratio', '16  /  9')).toBe('16 / 9')
    expect(normalValue('grid-template', '/ auto')).toBe('/ auto')
  })

  it('strips comments, which separate tokens like a space', () => {
    expect(normalValue('margin-top', '1px/* gap */')).toBe('1px')
    expect(normalValue('transition-property', 'opacity/**/transform')).toBe('opacity transform')
  })

  it('only collapses whitespace and comments in custom properties', () => {
    expect(normalValue('--x', '  A   /* x */ B  ')).toBe('A B')
    expect(normalValue('--x', 'Fn( 1REM ,  "S  S" )')).toBe('Fn(1REM,"S  S")')
    expect(normalValue('--x', 'a , b')).toBe('a,b')
    expect(normal('--Brand', 'red')).toBe('--Brand: red')
  })

  it('does not close what a custom property leaves open (property-test seed)', () => {
    expect(normalValue('--custom', '("')).toBe('("')
    expect(normalValue('--custom', normalValue('--custom', '("'))).toBe('("')
  })

  it('never prints a slash and a star as a comment (property-test seed)', () => {
    expect(normalValue('--custom', '/ *')).toBe('/ *')
    expect(normalValue('--custom', normalValue('--custom', '/ *'))).toBe('/ *')
  })

  it('keeps whitespace that separates tokens', () => {
    expect(normalValue('transition-property', 'a b')).not.toBe(
      normalValue('transition-property', 'a,b'),
    )
    expect(normalValue('--x', 'a b')).not.toBe(normalValue('--x', 'ab'))
  })
})

describe('idempotence on malformed values (property-test seeds)', () => {
  it.each([
    ['width', 'var(--x\\'],
    ['width', 'url(red'],
    ['width', 'calc(0)s'],
    ['box-shadow', '\\\n,'],
    ['box-shadow', ',/'],
    ['content', '"a"attr(x)'],
  ])('%s: %j', (property, value) => {
    const once = normal(property, value)
    const [, normalized = ''] = once.split(': ')
    expect(normal(property, normalized)).toBe(once)
  })

  it('separates values written without a space', () => {
    expect(normalValue('width', 'calc(0)s')).toBe('0 s')
    expect(normalValue('content', '"a"attr(x)')).toBe('"a" attr(x)')
  })

  it('keeps an unclosed function as written', () => {
    expect(normalValue('width', 'var(--x\\')).toBe('var(--x\\')
    expect(normalValue('background-image', 'url(red')).toBe('url(red')
  })
})

describe('normalizeValue', () => {
  it('prints unicode ranges and other nodes as written', () => {
    expect(
      normalizeValue('unicode-range', 'U+0025-00FF', {
        rootFontSize: 16,
        emBasis: undefined,
        variables: undefined,
      }),
    ).toBe('U+0025-00FF')
  })

  it('prints parentheses outside math functions', () => {
    expect(normalValue('grid-template-columns', '[a] ( 1fr )')).toBe('[a] (1fr)')
  })
})
