import { describe, expect, it } from 'vitest'
import { toDeclarations, toPropertyName } from '../../../src/css/declarations.ts'

describe('toPropertyName', () => {
  it.each([
    ['backgroundColor', 'background-color'],
    ['WebkitLineClamp', '-webkit-line-clamp'],
    ['MozOsxFontSmoothing', '-moz-osx-font-smoothing'],
    ['msFlex', '-ms-flex'],
    ['OTransition', '-o-transition'],
    ['Padding', 'padding'],
    ['background-color', 'background-color'],
    ['Background-Color', 'background-color'],
    ['COLOR', 'color'],
    ['  color ', 'color'],
    ['--brandColor', '--brandColor'],
  ])('%s → %s', (input, expected) => {
    expect(toPropertyName(input)).toBe(expected)
  })
})

describe('toDeclarations', () => {
  describe('from a string', () => {
    it('reads declarations, important and custom properties', () => {
      expect(
        toDeclarations('color: red !IMPORTANT; Padding:4px 8px; --X: A  B').declarations,
      ).toEqual([
        { property: 'color', value: 'red', important: true },
        { property: 'padding', value: '4px 8px', important: false },
        { property: '--X', value: 'A  B', important: false },
      ])
    })

    it('skips comments and empty input', () => {
      expect(toDeclarations('/* x */ color: red; /* y */')).toEqual({
        declarations: [{ property: 'color', value: 'red', important: false }],
        invalid: [],
      })
      expect(toDeclarations('')).toEqual({ declarations: [], invalid: [] })
    })

    it('keeps the valid declarations when one is broken', () => {
      expect(toDeclarations('color: red; padding; margin: 0')).toEqual({
        declarations: [
          { property: 'color', value: 'red', important: false },
          { property: 'margin', value: '0', important: false },
        ],
        invalid: [{ property: 'padding', value: '', important: false, code: 'TFC102' }],
      })
      expect(toDeclarations('width: calc(1px; color: blue').invalid).toEqual([
        { property: 'width', value: 'calc(1px; color: blue', important: false, code: 'TFC102' },
      ])
    })

    it('rejects empty values, rules and at-rules', () => {
      expect(toDeclarations('color: ;').invalid).toEqual([
        { property: 'color', value: '', important: false, code: 'TFC102' },
      ])
      expect(toDeclarations('color: red } b { x: y').invalid).toEqual([
        { property: '', value: 'b { x: y}', important: false, code: 'TFC102' },
      ])
      expect(
        toDeclarations('&:hover { color: red } @media print {}').invalid.map((d) => d.code),
      ).toEqual(['TFC102', 'TFC102'])
    })
  })

  describe('from a record', () => {
    it('converts camelCase keys and appends px to numbers of non-unitless properties', () => {
      expect(
        toDeclarations({
          backgroundColor: '#fff',
          padding: 8,
          marginTop: -4.5,
          lineHeight: 1.5,
          zIndex: 10,
          opacity: 0.5,
          WebkitLineClamp: 2,
          msFlexGrow: 1,
          '--gap': 4,
          width: 0,
        }).declarations,
      ).toEqual([
        { property: 'background-color', value: '#fff', important: false },
        { property: 'padding', value: '8px', important: false },
        { property: 'margin-top', value: '-4.5px', important: false },
        { property: 'line-height', value: '1.5', important: false },
        { property: 'z-index', value: '10', important: false },
        { property: 'opacity', value: '0.5', important: false },
        { property: '-webkit-line-clamp', value: '2', important: false },
        { property: '-ms-flex-grow', value: '1', important: false },
        { property: '--gap', value: '4', important: false },
        { property: 'width', value: '0', important: false },
      ])
    })

    it('reads a trailing !important in a value', () => {
      expect(toDeclarations({ color: 'red ! important' }).declarations).toEqual([
        { property: 'color', value: 'red', important: true },
      ])
    })

    it('rejects non-finite numbers, empty values and values that end the declaration', () => {
      expect(
        toDeclarations({
          width: Number.NaN,
          height: Number.POSITIVE_INFINITY,
          top: ' ',
          color: 'red; x: y',
        }).invalid,
      ).toEqual([
        { property: 'width', value: 'NaN', important: false, code: 'TFC102' },
        { property: 'height', value: 'Infinity', important: false, code: 'TFC102' },
        { property: 'top', value: '', important: false, code: 'TFC102' },
        { property: 'color', value: 'red; x: y', important: false, code: 'TFC102' },
      ])
    })

    it('rejects unbalanced brackets and strings, but not brackets inside strings', () => {
      const { declarations, invalid } = toDeclarations({
        content: '"(;}"',
        width: 'calc(1px',
        height: 'calc(1px))',
        grid: '[a',
        quotes: '"open',
        top: 'calc(1px]',
      })
      expect(declarations).toEqual([{ property: 'content', value: '"(;}"', important: false }])
      expect(invalid.map((d) => d.property)).toEqual(['width', 'height', 'grid', 'quotes', 'top'])
      expect(toDeclarations({ content: '"a\\"b"' }).invalid).toEqual([])
    })

    it('rejects property names that are not identifiers', () => {
      expect(
        toDeclarations({ 'a b': '1', '--': '1', '': '1', 'a:b': '1' }).invalid.map(
          (d) => d.property,
        ),
      ).toEqual(['a b', '--', '', 'a:b'])
    })
  })

  describe('from an array', () => {
    it('keeps important and converts camelCase properties', () => {
      expect(
        toDeclarations([
          { property: 'marginTop', value: '1px' },
          { property: 'color', value: 'red', important: true },
          { property: 'color', value: 'blue !important', important: false },
        ]).declarations,
      ).toEqual([
        { property: 'margin-top', value: '1px', important: false },
        { property: 'color', value: 'red', important: true },
        { property: 'color', value: 'blue', important: true },
      ])
    })

    it('reports invalid entries with TFC102', () => {
      expect(toDeclarations([{ property: 'x', value: 'a;b', important: true }]).invalid).toEqual([
        { property: 'x', value: 'a;b', important: true, code: 'TFC102' },
      ])
    })
  })
})
