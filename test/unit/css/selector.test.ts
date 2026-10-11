import { describe, expect, it } from 'vitest'
import {
  compareSpecificity,
  extractSubject,
  normalizeSelector,
  relativeSelector,
  specificity,
} from '../../../src/css/selector.ts'

const n = normalizeSelector

describe('N50 selector transforms', () => {
  it('makes the Tailwind 4.2 and 4.3 spellings equal', () => {
    expect(n('&:not(*:hover)')).toBe(n('&:not(:hover)'))
    expect(n('&:has(*:checked)')).toBe(n('&:has(:checked)'))
    expect(n('.x>p')).toBe(n('.x > p'))
    expect(n('&:not(*:hover)')).toBe('&:not(:hover)')
  })

  it('normalizes whitespace and combinators', () => {
    expect(n('.a   .b')).toBe('.a .b')
    expect(n('.a+.b~.c')).toBe('.a + .b ~ .c')
    expect(n(':has(>p)')).toBe(':has(> p)')
    expect(n('a /* c */ b')).toBe('a b')
    expect(n('.a/* c */.b')).toBe('.a.b')
    expect(n('.a , .b')).toBe('.a,.b')
  })

  it('quotes attribute values and lowercases the case flag', () => {
    expect(n('[a=b]')).toBe('[a="b"]')
    expect(n("[a='b']")).toBe(n('[a=b]'))
    expect(n("[data-state='open' I]")).toBe('[data-state="open" i]')
    expect(n('[a]')).toBe('[a]')
    expect(n('[a="say \\"hi\\""]')).toBe('[a="say \\"hi\\""]')
  })

  it('lowercases pseudo names and writes legacy pseudo-elements with ::', () => {
    expect(n('&:HOVER::BEFORE')).toBe('&:hover::before')
    expect(n('.a:before')).toBe(n('.a::before'))
    expect(n('.a:First-Line')).toBe('.a::first-line')
    expect(n('&:LANG(en)')).toBe('&:lang(en)')
  })

  it('writes An+B in one form', () => {
    expect(n('&:nth-child(2N + 1)')).toBe('&:nth-child(2n+1)')
    expect(n('&:nth-child(odd)')).toBe(n('&:nth-child(2n+1)'))
    expect(n('&:nth-of-type(even)')).toBe('&:nth-of-type(2n)')
    expect(n('&:nth-child(+n-0)')).toBe('&:nth-child(n)')
    expect(n('&:nth-child(-n+3)')).toBe('&:nth-child(-n+3)')
    expect(n('&:nth-child(03n-2)')).toBe('&:nth-child(3n-2)')
    expect(n('&:nth-last-child( +5 )')).toBe('&:nth-last-child(5)')
    expect(n('&:nth-child(even of .a  .b)')).toBe('&:nth-child(2n of .a .b)')
  })

  it('unwraps :is() with one compound argument', () => {
    expect(n(':is(.a) .b')).toBe('.a .b')
    expect(n('.a:is(.b)')).toBe('.a.b')
    expect(n('.a:is(div)')).toBe('div.a')
    expect(n('&:is(:hover)')).toBe(n('&:hover'))
  })

  it('drops * only next to other simple selectors', () => {
    expect(n('*.a')).toBe('.a')
    expect(n('*::before')).toBe('::before')
    expect(n('*')).toBe('*')
    expect(n('* > p')).toBe('* > p')
    expect(n('ns|*.a')).toBe('ns|*.a')
    expect(n(':is(*)')).toBe('*')
  })

  it('keeps :where(), complex :is() and selectors that change meaning', () => {
    expect(n(':where(.a)')).toBe(':where(.a)')
    expect(n(':where(.a)')).not.toBe(n('.a'))
    expect(n(':is(.a .b)')).toBe(':is(.a .b)')
    expect(n(':is(.a, .b)')).toBe(':is(.a,.b)')
    expect(n(':is(:where(.group):hover *)')).toBe(':is(:where(.group):hover *)')
    expect(n('div:is(span)')).toBe('div:is(span)')
    expect(n('.a:is(::before)')).toBe('.a:is(::before)')
    expect(n('.a .b')).not.toBe(n('.a > .b'))
    expect(n('&:hover')).not.toBe(n('&:focus'))
  })

  it('keeps nesting selectors and ancestors', () => {
    expect(n('.dark  &')).toBe('.dark &')
    expect(n('&  .a')).toBe('& .a')
  })

  it('only collapses whitespace in a selector that does not parse', () => {
    expect(n('.a[  ')).toBe('.a[')
    expect(n(':not(')).toBe(':not(')
  })
})

describe('idempotence on malformed selectors (property-test seeds)', () => {
  it.each([
    ',\n',
    'a, ',
    'a,',
    String.raw`\a+`,
    String.raw`:\a+`,
    String.raw`\ ,+`,
    String.raw`\ *`,
    'a ()a',
    String.raw`/\a/`,
  ])('%j', (selector) => {
    const once = normalizeSelector(selector)
    expect(normalizeSelector(once)).toBe(once)
  })

  it('terminates a trailing hex escape with a space', () => {
    expect(normalizeSelector(String.raw`.\31+.b`)).toBe(String.raw`.\31  + .b`)
    expect(normalizeSelector(String.raw`.\31 .b`)).toBe(String.raw`.\31 .b`)
  })

  it('treats empty list members and unknown combinators as unreadable', () => {
    expect(normalizeSelector('a, ')).toBe('a,')
    expect(normalizeSelector('a ()a')).toBe('a ()a')
  })
})

describe('extractSubject', () => {
  it('splits trailing pseudo-classes and pseudo-elements off the last compound', () => {
    expect(extractSubject('.card .title:hover::before')).toEqual({
      subject: '.card .title',
      transform: '&:hover::before',
    })
    expect(extractSubject('a:hover')).toEqual({ subject: 'a', transform: '&:hover' })
    expect(extractSubject('.a:not(.b)')).toEqual({ subject: '.a', transform: '&:not(.b)' })
    expect(extractSubject('.a::-webkit-scrollbar-thumb:hover')).toEqual({
      subject: '.a',
      transform: '&::-webkit-scrollbar-thumb:hover',
    })
    expect(extractSubject('.a:BEFORE')).toEqual({ subject: '.a', transform: '&::before' })
  })

  it('uses * for a compound that only had pseudos', () => {
    expect(extractSubject(':hover')).toEqual({ subject: '*', transform: '&:hover' })
    expect(extractSubject('.a > :focus')).toEqual({ subject: '.a > *', transform: '&:focus' })
    expect(extractSubject('::selection')).toEqual({ subject: '*', transform: '&::selection' })
  })

  it('keeps pseudo-classes that are not at the end, and :root', () => {
    expect(extractSubject('.a:hover .b')).toEqual({ subject: '.a:hover .b', transform: '&' })
    expect(extractSubject('.a:hover.b')).toEqual({ subject: '.a:hover.b', transform: '&' })
    expect(extractSubject(':root')).toEqual({ subject: ':root', transform: '&' })
    expect(extractSubject('html')).toEqual({ subject: 'html', transform: '&' })
  })

  it('rejects selector lists and broken selectors', () => {
    expect(extractSubject('.a, .b')).toBeUndefined()
    expect(extractSubject('.a[')).toBeUndefined()
  })
})

describe('relativeSelector', () => {
  it('replaces the class of a candidate with & and normalizes the rest', () => {
    expect(relativeSelector('.hover\\:flex:hover', 'hover:flex')).toBe('&:hover')
    expect(relativeSelector('.p-4', 'p-4')).toBe('&')
    expect(relativeSelector('.w-1\\/2', 'w-1/2')).toBe('&')
    expect(relativeSelector('.\\[color\\:red\\]\\!', '[color:red]!')).toBe('&')
    expect(relativeSelector('.tw\\:flex', 'tw:flex')).toBe('&')
  })

  it('keeps every other part of the selector', () => {
    expect(relativeSelector(':is(.\\*\\:x > *)', '*:x')).toBe(':is(& > *)')
    expect(relativeSelector(':where(.space-x-2>:not(:last-child))', 'space-x-2')).toBe(
      ':where(& > :not(:last-child))',
    )
    expect(relativeSelector('.group-hover\\:x:is(:where(.group):hover *)', 'group-hover:x')).toBe(
      '&:is(:where(.group):hover *)',
    )
    expect(relativeSelector(':where(:focus) .in-focus\\:x', 'in-focus:x')).toBe(':where(:focus) &')
    expect(relativeSelector('.not-hover\\:x:not(*:hover)', 'not-hover:x')).toBe('&:not(:hover)')
  })

  it('replaces every occurrence, including in each member of a list', () => {
    expect(relativeSelector('.m\\:x *::marker, .m\\:x::marker', 'm:x')).toBe('& ::marker,&::marker')
  })

  it('prints what normalizeSelector would print for the replaced selector', () => {
    for (const [selector, className] of [
      ['.a  >  .x:HOVER', 'x'],
      ['.x:is(.y)', 'x'],
      ['.x:before', 'x'],
      ['.x:nth-child( 2N + 1 )', 'x'],
      ['.x , .x:focus', 'x'],
      ['.x[data-a=b]', 'x'],
      ['.x >>> .y', 'x'],
    ] as const) {
      const relative = relativeSelector(selector, className) as string
      expect(normalizeSelector(relative)).toBe(relative)
      expect(relative).toBe(normalizeSelector(selector.replaceAll(`.${className}`, '&')))
    }
  })

  it('is undefined when the class is missing or the selector does not parse', () => {
    expect(relativeSelector('.other', 'p-4')).toBeUndefined()
    expect(relativeSelector('.p-4[', 'p-4')).toBeUndefined()
    expect(relativeSelector('[class=p-4]', 'p-4')).toBeUndefined()
  })
})

describe('specificity', () => {
  it('counts ids, classes and types', () => {
    expect(specificity('#a .b:hover')).toEqual([1, 2, 0])
    expect(specificity('div.a[href]')).toEqual([0, 2, 1])
    expect(specificity('.a::before')).toEqual([0, 1, 1])
    expect(specificity('.a:before')).toEqual([0, 1, 1])
    expect(specificity('* > *')).toEqual([0, 0, 0])
  })

  it('applies the :is/:not/:has/:where and nth rules', () => {
    expect(specificity(':where(#a) .b')).toEqual([0, 1, 0])
    expect(specificity(':is(#a, .b)')).toEqual([1, 0, 0])
    expect(specificity(':not(.a.b)')).toEqual([0, 2, 0])
    expect(specificity(':has(> p)')).toEqual([0, 0, 1])
    expect(specificity('li:nth-child(2n of .x)')).toEqual([0, 2, 1])
    expect(specificity('li:nth-child(2n)')).toEqual([0, 1, 1])
    expect(specificity('::slotted(.a)')).toEqual([0, 1, 1])
    expect(specificity(':host(.a)')).toEqual([0, 2, 0])
  })

  it('counts & as the given nesting specificity', () => {
    expect(specificity('&:hover')).toEqual([0, 1, 0])
    expect(specificity('&:hover', { nesting: [0, 1, 0] })).toEqual([0, 2, 0])
    expect(specificity('.dark &', { nesting: [1, 0, 0] })).toEqual([1, 1, 0])
  })

  it('takes the highest of a list, and zero for a broken selector', () => {
    expect(specificity('.a, #b')).toEqual([1, 0, 0])
    expect(specificity('.a[')).toEqual([0, 0, 0])
  })

  it('orders specificities', () => {
    expect(compareSpecificity([1, 0, 0], [0, 9, 9])).toBeGreaterThan(0)
    expect(compareSpecificity([0, 1, 0], [0, 1, 1])).toBeLessThan(0)
    expect(compareSpecificity([0, 1, 1], [0, 1, 1])).toBe(0)
  })
})
