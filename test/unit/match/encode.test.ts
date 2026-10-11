// SPEC §5.5: value → encoded class → the declaration Tailwind generates for it.
import { beforeAll, describe, expect, it } from 'vitest'
import {
  arbitraryProperty,
  arbitraryValue,
  candidateName,
  encodeValue,
  variableValue,
} from '../../../src/match/encode.ts'
import type { TailwindDesignSystem } from '../../../src/tailwind/adapter.ts'
import { designSystem } from '../../helpers/design-system.ts'

/** The declarations Tailwind generates for a class, as `property: value [!important]`. */
function toCss(design: TailwindDesignSystem, className: string): string[] | null {
  const [ast] = design.toAst([className])
  if (!ast) return null
  return ast.rules.flatMap((rule) =>
    rule.declarations.map(
      (declaration) =>
        `${declaration.property}: ${declaration.value}${declaration.important ? ' !important' : ''}`,
    ),
  )
}

function propertyClass(property: string, value: string): string {
  const encoded = encodeValue(value)
  if (encoded === undefined) throw new Error(`${value} is not encodable`)
  return arbitraryProperty(property, encoded)
}

describe('encodeValue', () => {
  let design: TailwindDesignSystem

  beforeAll(async () => {
    design = await designSystem()
  })

  it.each([
    // whitespace
    ['border', '1px solid red', '[border:1px_solid_red]', 'border: 1px solid red'],
    ['margin', '  0 \t\n auto ', '[margin:0_auto]', 'margin: 0 auto'],
    // commas and parentheses don't need the whitespace next to them
    ['color', 'rgb( 0 , 0 , 0 )', '[color:rgb(0,0,0)]', 'color: rgb(0,0,0)'],
    ['color', 'rgb(0 0 0 / 0.5)', '[color:rgb(0_0_0_/_0.5)]', 'color: rgb(0 0 0 / 0.5)'],
    // nested parentheses and math
    ['width', 'calc(100% - 2rem)', '[width:calc(100%_-_2rem)]', 'width: calc(100% - 2rem)'],
    [
      'transform',
      'translate(calc(1px * 2), 0)',
      '[transform:translate(calc(1px_*_2),0)]',
      'transform: translate(calc(1px * 2),0)',
    ],
    // a literal underscore is escaped, except inside url()
    ['font-family', 'a_b, c', '[font-family:a\\_b,c]', 'font-family: a_b,c'],
    ['color', 'var(--a_b)', '[color:var(--a\\_b)]', 'color: var(--a_b)'],
    [
      'background-image',
      'url(a_b.png)',
      '[background-image:url(a_b.png)]',
      'background-image: url(a_b.png)',
    ],
    [
      'background-image',
      'url( "a_b.png" )',
      "[background-image:url('a_b.png')]",
      "background-image: url('a_b.png')",
    ],
    [
      'background-image',
      'linear-gradient(red, blue), url(x_y.png)',
      '[background-image:linear-gradient(red,blue),url(x_y.png)]',
      'background-image: linear-gradient(red,blue),url(x_y.png)',
    ],
    // strings: spaces become `_`, underscores `\_`, `"` becomes `'` when lossless
    ['content', '"a b"', "[content:'a_b']", "content: 'a b'"],
    ['content', '"a_b"', "[content:'a\\_b']", "content: 'a_b'"],
    ['content', '"\\"q\\""', `[content:'"q"']`, `content: '"q"'`],
    ['content', `"it's"`, `[content:"it's"]`, `content: "it's"`],
    ['content', `'say "hi"'`, `[content:'say_"hi"']`, `content: 'say "hi"'`],
    ['content', '"\\201C"', "[content:'\\201C']", "content: '\\201C'"],
    ['content', '"a\\ b"', "[content:'a_b']", "content: 'a b'"],
    // escapes outside strings are kept
    ['font-family', 'Font\\!Name', '[font-family:Font\\!Name]', 'font-family: Font\\!Name'],
    [
      'grid-template-areas',
      '"a b" "c d"',
      "[grid-template-areas:'a_b'_'c_d']",
      "grid-template-areas: 'a b' 'c d'",
    ],
    // brackets inside the value
    [
      'grid-template-columns',
      '[full-start] 1fr [full-end]',
      '[grid-template-columns:[full-start]_1fr_[full-end]]',
      'grid-template-columns: [full-start] 1fr [full-end]',
    ],
    // custom properties
    ['--x', 'a b', '[--x:a_b]', '--x: a b'],
  ])('%s: %s → %s', (property, value, className, declaration) => {
    expect(propertyClass(property, value)).toBe(className)
    expect(toCss(design, className)).toEqual([declaration])
  })

  it('keeps important as the class suffix or prefix', () => {
    const style = { prefix: null, important: 'suffix' } as const
    const core = propertyClass('color', 'red')
    expect(candidateName(core, style)).toBe('[color:red]!')
    expect(toCss(design, '[color:red]!')).toEqual(['color: red !important'])
    expect(candidateName(core, { ...style, important: 'prefix' })).toBe('![color:red]')
    expect(toCss(design, '![color:red]')).toEqual(['color: red !important'])
    expect(candidateName(core, { ...style, important: false })).toBe('[color:red]')
  })

  it('writes arbitrary and variable values with optional type hints', () => {
    expect(arbitraryValue('bg', encodeValue('url(a_b.png)') as string)).toBe('bg-[url(a_b.png)]')
    expect(toCss(design, 'bg-[url(a_b.png)]')).toEqual(['background-image: url(a_b.png)'])
    expect(arbitraryValue('text', 'var(--x)', 'length')).toBe('text-[length:var(--x)]')
    expect(toCss(design, 'text-[length:var(--x)]')).toEqual(['font-size: var(--x)'])
    expect(variableValue('text', '--x')).toBe('text-(--x)')
    expect(toCss(design, 'text-(--x)')).toEqual(['color: var(--x)'])
    expect(variableValue('text', '--x', 'length')).toBe('text-(length:--x)')
    expect(toCss(design, 'text-(length:--x)')).toEqual(['font-size: var(--x)'])
  })

  it.each([
    ['a backtick', 'a`b'],
    ['an unbalanced parenthesis', 'calc(1px'],
    ['a stray closing bracket', 'a]'],
    ['crossed brackets', '([)]'],
    ['an unclosed string', '"abc'],
    ['a tab inside a string', '"a\tb"'],
    ['a space inside a string in url()', 'url("a b.png")'],
    ['a space inside url()', 'url(a b.png)'],
    ['an escaped newline inside a string', '"a\\\nb"'],
    ['a bracket inside a string', '"("'],
    ['an escaped space', 'a\\ b'],
    ['an escaped tab inside a string', '"a\\\tb"'],
    ['an escaped space inside a string in url()', 'url("a\\ b.png")'],
  ])('rejects %s (TFC204)', (_, value) => {
    expect(encodeValue(value)).toBeUndefined()
  })
})

describe('candidateName', () => {
  it('puts the theme prefix first', () => {
    expect(candidateName('p-4', { prefix: 'tw', important: false })).toBe('tw:p-4')
    expect(candidateName('p-4', { prefix: 'tw', important: 'suffix' })).toBe('tw:p-4!')
    expect(candidateName('p-4', { prefix: 'tw', important: 'prefix' })).toBe('tw:!p-4')
  })

  it('compiles under prefix(tw)', async () => {
    const design = await designSystem('prefix')
    expect(toCss(design, 'tw:p-4!')).toEqual(['padding: calc(var(--tw-spacing) * 4) !important'])
    expect(toCss(design, 'tw:!p-4')).toEqual(['padding: calc(var(--tw-spacing) * 4) !important'])
    expect(toCss(design, 'tw:[color:red]')).toEqual(['color: red'])
  })
})
