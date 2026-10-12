import { describe, expect, it } from 'vitest'
import {
  compareSpecificity,
  extractSubject,
  nestSelector,
  normalizeSelector,
  relativeSelector,
  selectorRelation,
  specificity,
  takesClasses,
} from '../../../src/css/selector.ts'

const n = normalizeSelector

describe('N50 selector transforms', () => {
  it('keeps an nth argument that is not An+B as written', () => {
    expect(n('&:nth-child( foo )')).toBe('&:nth-child(foo)')
    expect(n('&:nth-child(+03)')).toBe('&:nth-child(3)')
  })

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

  it('keeps a leading :is()/:where() that names elements when the compound would be empty', () => {
    expect(extractSubject(':where(.btn)')).toEqual({ subject: ':where(.btn)', transform: '&' })
    expect(extractSubject(':where(.btn):hover')).toEqual({
      subject: ':where(.btn)',
      transform: '&:hover',
    })
    expect(extractSubject('nav :where(a, [role=link])')).toEqual({
      subject: 'nav :where(a,[role="link"])',
      transform: '&',
    })
    expect(extractSubject(':is(button, [type=submit]):focus-visible')).toEqual({
      subject: ':is(button,[type="submit"])',
      transform: '&:focus-visible',
    })
    expect(extractSubject(':is(.a)::before')).toEqual({ subject: '.a', transform: '&::before' })
    expect(extractSubject(':where(a:not([role=button])):is([aria-current], :hover)')).toEqual({
      subject: ':where(a:not([role="button"]))',
      transform: '&:is([aria-current],:hover)',
    })
    expect(extractSubject(':where(:root)')).toEqual({ subject: ':where(:root)', transform: '&' })
  })

  it('strips :is()/:where() of states only, and those after the subject', () => {
    expect(extractSubject('.a > :is(:hover, :focus)')).toEqual({
      subject: '.a > *',
      transform: '&:is(:hover,:focus)',
    })
    expect(extractSubject(':where(:hover)')).toEqual({ subject: '*', transform: '&:where(:hover)' })
    expect(extractSubject('.a > :where(:hover :focus)')).toEqual({
      subject: '.a > *',
      transform: '&:where(:hover :focus)',
    })
    expect(extractSubject('.a:is(.b, .c)')).toEqual({ subject: '.a', transform: '&:is(.b,.c)' })
    expect(extractSubject('.a :hover:where(.b)')).toEqual({
      subject: '.a *',
      transform: '&:hover:where(.b)',
    })
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

describe('selectorRelation (ADR-0013)', () => {
  it('finds rules that match the same subject whenever the context does', () => {
    expect(selectorRelation('&', '&')).toBe('same')
    expect(selectorRelation('&', '&:hover')).toBe('same')
    expect(selectorRelation('&:hover', '&:hover:focus')).toBe('same')
    expect(selectorRelation('&', '.dark &')).toBe('same')
    expect(selectorRelation('.dark &', '.dark &:hover')).toBe('same')
    expect(selectorRelation('&::before', '&::before:hover')).toBe('same')
  })

  it('finds the element of a pseudo-element context', () => {
    expect(selectorRelation('&', '&::before')).toBe('element')
    expect(selectorRelation('&:hover', '&:hover::before')).toBe('element')
  })

  it('rejects everything else', () => {
    expect(selectorRelation('&:focus', '&:hover')).toBeUndefined()
    expect(selectorRelation('&:focus', '&:hover::before')).toBeUndefined()
    expect(selectorRelation('&::before', '&::after')).toBeUndefined()
    expect(selectorRelation('&::before', '&')).toBeUndefined()
    expect(selectorRelation('&::before:hover', '&::before')).toBeUndefined()
    expect(selectorRelation('.dark &', '.x &')).toBeUndefined()
    expect(selectorRelation('&', ':is(& > *)')).toBeUndefined()
    expect(selectorRelation('&', '& > p')).toBeUndefined()
    expect(selectorRelation('&', '&:hover, &:focus')).toBeUndefined()
    expect(selectorRelation('&', '&:hover&')).toBeUndefined()
    expect(selectorRelation('&', '[')).toBeUndefined()
  })
})

describe('nestSelector (CSS nesting)', () => {
  it('splits a top-level list and reads & as :scope', () => {
    expect(nestSelector('.a,\n  .b  .c')).toEqual(['.a', '.b .c'])
    expect(nestSelector('& .a')).toEqual([':scope .a'])
  })

  it('substitutes the parent where that keeps the meaning, else wraps it in :is()', () => {
    expect(nestSelector('&:hover, .dark &', '.card')).toEqual(['.card:hover', '.dark .card'])
    expect(nestSelector('> .c, .d', '.a')).toEqual(['.a > .c', '.a .d'])
    expect(nestSelector('& + &', '.a .b')).toEqual(['.a .b + :is(.a .b)'])
    expect(nestSelector('.x&', 'p.y')).toEqual(['.x:is(p.y)'])
    expect(nestSelector(':not(&)', 'p')).toEqual([':not(p)'])
  })

  it('keeps whitespace inside strings', () => {
    expect(nestSelector('[title="a  b"]   &', '.a')).toEqual(['[title="a  b"] .a'])
    expect(nestSelector("[title='a\\'  b'] &", '.a')).toEqual(["[title='a\\'  b'] .a"])
  })

  it('is undefined for a selector that does not parse or has an empty member', () => {
    expect(nestSelector('.a!')).toBeUndefined()
    expect(nestSelector('.a,,.b', '.c')).toBeUndefined()
  })
})

describe('takesClasses', () => {
  it('is false when every compound is the root or any element', () => {
    for (const subject of [':root', 'html', 'HTML', '*', ':scope', ':host', 'html *', '* + *']) {
      expect(takesClasses(subject), subject).toBe(false)
    }
    expect(takesClasses(':host-context(.dark)')).toBe(false)
    for (const subject of [':where(:root)', ':is(html, :root)', ':where(html *)', ':where(*)']) {
      expect(takesClasses(subject), subject).toBe(false)
    }
  })

  it('is true when some compound names an element', () => {
    for (const subject of [
      'body',
      '.a',
      '#a',
      '[data-x]',
      '.a > *',
      ':root .a',
      'html.dark',
      ':where(.btn)',
      ':is(:root, .a)',
      'nav :where(a)',
    ]) {
      expect(takesClasses(subject), subject).toBe(true)
    }
  })

  it('is false for a list or a selector that does not parse', () => {
    expect(takesClasses('.a, .b')).toBe(false)
    expect(takesClasses('.a!')).toBe(false)
  })
})
