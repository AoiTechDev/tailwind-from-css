// ADR-0007: async factory, synchronous conversion, structured results, one-shot helpers memoized.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  convertCss,
  converterFromDesign,
  convertStyles,
  createConverter,
  sharedConverter,
} from '../../src/converter.ts'
import { TfcError } from '../../src/errors.ts'
import { resolveOptions } from '../../src/options.ts'
import type { CandidateAst } from '../../src/tailwind/adapter.ts'
import type { Converter, StyleInput } from '../../src/types.ts'
import { FIXTURES, REPO_ROOT } from '../helpers/design-system.ts'
import { ast, fakeDesign, rule } from '../helpers/fake-design.ts'

const installed = (
  JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'node_modules', 'tailwindcss', 'package.json'), 'utf8'),
  ) as { version: string }
).version

async function rejectionCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (error) {
    return error instanceof TfcError ? error.code : 'not a TfcError'
  }
  return undefined
}

let converter: Converter

beforeAll(async () => {
  converter = await createConverter()
}, 60_000)

describe('createConverter', () => {
  it('reports the loaded Tailwind version and the resolved, frozen options', () => {
    expect(converter.tailwindVersion).toBe(installed)
    expect(converter.options).toEqual(resolveOptions(undefined, { base: process.cwd() }))
    expect(Object.isFrozen(converter.options)).toBe(true)
    expect(Object.isFrozen(converter)).toBe(true)
  })

  it('rejects invalid options with TFC904 and a broken entry CSS with TFC903', async () => {
    expect(await rejectionCode(createConverter({ mode: 'fast' as never }))).toBe('TFC904')
    expect(
      await rejectionCode(createConverter({ tailwind: { css: '@import "./missing.css";' } })),
    ).toBe('TFC903')
  })

  it('loads the entry CSS relative to tailwind.base', async () => {
    const custom = await createConverter({
      tailwind: {
        css: '@import "./tailwind.css";',
        base: resolve(FIXTURES, 'tailwind', 'custom-theme'),
      },
    })
    expect(custom.convertStyles({ declarations: 'background-color: #123456' }).classes).toEqual([
      'bg-brand',
    ])
  }, 60_000)
})

describe('conversion is synchronous', () => {
  it('convertStyles and toCss return values, not promises', () => {
    const result = converter.convertStyles({ declarations: 'padding: 16px' })
    expect(result).not.toBeInstanceOf(Promise)
    expect(typeof (result as unknown as { then?: unknown }).then).toBe('undefined')
    expect(result.classes).toEqual(['p-4'])
    expect(typeof converter.toCss(['p-4'])).toBe('string')
  })
})

describe('convertStyles', () => {
  // CI P3 seed -121319052: classes cached from an earlier conversion carried `getClassOrder`
  // keys of another call, so verification cascaded them in the wrong order.
  it('gives the same result whatever the converter converted before', async () => {
    const input = [
      {
        selector: '&[data-state=open]',
        conditions: ['@media (max-width: 767px)'],
        declarations: 'padding-left: 0; border-radius: 72px',
      },
      {
        selector: '&:first-child',
        declarations:
          'padding: 1.75rem 5.25rem 43px; content: none; border-radius: 50%; fill: transparent; border-width: 1px',
      },
      {
        selector: '&:first-child',
        conditions: ['@media (min-width: 768px)'],
        declarations:
          '--brand: a b !important; border-radius: 9999px; content: ""; line-height: 33px; inset: 23px 4rem',
      },
    ]
    const fresh = await createConverter()
    const warmed = await createConverter()
    warmed.convertStyles(input[2] as StyleInput)
    const expected = JSON.stringify(fresh.convertStyles(input))
    expect(JSON.stringify(warmed.convertStyles(input))).toBe(expected)
    expect(fresh.convertStyles(input).classes).toContain("md:first:content-['']")
  })

  it('accepts every declarations shape', () => {
    for (const declarations of [
      'padding: 16px; color: #fff',
      { padding: 16, color: '#fff' },
      [
        { property: 'padding', value: '16px' },
        { property: 'color', value: '#fff' },
      ],
    ]) {
      expect(converter.convertStyles({ declarations }).classes).toEqual(['p-4', 'text-white'])
    }
  })

  it('maps every class to the declarations it came from', () => {
    const result = converter.convertStyles([
      { declarations: 'margin: 0 auto' },
      { selector: '&:hover', declarations: 'color: #ef4444' },
    ])
    expect(result.className).toBe('mt-0 mr-auto mb-0 ml-auto [&:hover]:text-[#ef4444]')
    const margin = { property: 'margin', value: '0 auto', important: false, selector: '&' }
    expect(result.mappings[0]).toEqual({
      className: 'mt-0',
      kind: 'bare',
      sources: [{ ...margin, conditions: [] }],
    })
    expect(result.mappings[4]).toEqual({
      className: '[&:hover]:text-[#ef4444]',
      kind: 'arbitrary-value',
      sources: [
        {
          property: 'color',
          value: '#ef4444',
          important: false,
          selector: '&:hover',
          conditions: [],
        },
      ],
    })
    expect(result.diagnostics.map((d) => d.code)).toEqual(['TFC201', 'TFC301'])
    expect(result.exact).toBe(true)
  })

  it('merges inputs with the same context in array order, later winning', () => {
    const result = converter.convertStyles([
      { selector: '&:hover', declarations: 'color: #fff; padding: 16px' },
      { selector: '&:HOVER', declarations: { color: '#000' } },
    ])
    expect(result.classes).toEqual(['[&:hover]:p-4', '[&:hover]:text-black'])
    expect(result.diagnostics.map((d) => [d.code, d.source?.value])).toEqual([
      ['TFC106', '#fff'],
      ['TFC301', '16px'],
    ])
  })

  it('never throws on malformed CSS', () => {
    const result = converter.convertStyles([
      { declarations: 'color: ; padding: 16px; }{ margin' },
      { selector: '&:hover', declarations: 'width: calc(' },
      { selector: '&:hover)', declarations: 'color: red' },
      { conditions: ['@media ((('], declarations: 'color: red' },
    ])
    expect(result.classes).toContain('p-4')
    expect(result.unconverted.map((entry) => entry.code)).toContain('TFC102')
    expect(result.exact).toBe(false)
  })

  it('reports a context that has no variant as TFC303, declarations as written', () => {
    const result = converter.convertStyles({
      selector: '&:hover',
      conditions: ['@media (min-width: 768px) {'],
      declarations: 'margin: 0 auto',
    })
    expect(result.classes).toEqual([])
    expect(result.unconverted).toEqual([
      {
        property: 'margin',
        value: '0 auto',
        important: false,
        selector: '&:hover',
        conditions: ['@media (min-width: 768px) {'],
        code: 'TFC303',
      },
    ])
  })

  it('drops redundant vendor copies (TFC105) and keeps important declarations important', () => {
    const result = converter.convertStyles({
      declarations: '-webkit-user-select: none; user-select: none; padding: 16px !important',
    })
    expect(result.classes).toEqual(['p-4!', 'select-none'])
    expect(result.diagnostics.map((d) => [d.code, d.source?.property])).toEqual([
      ['TFC105', '-webkit-user-select'],
    ])
  })

  it('reports values that cannot be classes per longhand when the declaration was expanded', () => {
    const result = converter.convertStyles({
      declarations: 'content: "a`b"; margin: 1px 2px; list-style: "a`b" inside',
    })
    expect(result.unconverted).toEqual([
      expect.objectContaining({ property: 'content', value: '"a`b"', code: 'TFC204' }),
      expect.objectContaining({ property: 'list-style-type', value: '"a`b"', code: 'TFC204' }),
    ])
    expect(result.mappings.find((m) => m.className === 'list-inside')?.sources).toEqual([
      expect.objectContaining({ property: 'list-style', value: '"a`b" inside' }),
    ])
    expect(result.classes).toEqual([
      'mt-px',
      'mr-0.5',
      'mb-px',
      'ml-0.5',
      'list-inside',
      'list-image-none',
    ])
  })

  it('converts nothing to an empty, exact result', () => {
    expect(converter.convertStyles([])).toEqual({
      className: '',
      classes: [],
      mappings: [],
      unconverted: [],
      diagnostics: [],
      exact: true,
    })
  })
})

describe('verification failures', () => {
  // A design system whose classes change after the index was built: the index promises red, but
  // the class (and, for `TFC502`, its arbitrary property too) compiles to blue.
  const ARBITRARY = String.raw`.\[color\:red\]`

  function lyingConverter(alsoArbitrary: boolean): Converter {
    const red = (selector: string): CandidateAst => ast([rule(selector, ['color: red'])])
    const candidates: Record<string, CandidateAst> = {
      'text-red': red('.text-red'),
      '[color:red]': red(ARBITRARY),
    }
    const design = fakeDesign({ candidates, classList: ['text-red'] })
    const converter = converterFromDesign(
      design,
      resolveOptions({ tailwind: { css: `/* lying ${alsoArbitrary} */` } }, { base: REPO_ROOT }),
    )
    candidates['text-red'] = ast([rule('.text-red', ['color: blue'])])
    if (alsoArbitrary) candidates['[color:red]'] = ast([rule(ARBITRARY, ['color: blue'])])
    return converter
  }

  it('falls back to an arbitrary property with TFC501', () => {
    const result = lyingConverter(false).convertStyles({ declarations: 'color: red' })
    expect(result.classes).toEqual(['[color:red]'])
    expect(result.diagnostics.map((d) => d.code)).toEqual(['TFC202', 'TFC501'])
    expect(result.exact).toBe(true)
  })

  it('reports the declaration as unconverted with TFC502 when the fallback fails too', () => {
    const result = lyingConverter(true).convertStyles({ declarations: 'color: red' })
    expect(result.classes).toEqual([])
    expect(result.unconverted.map((entry) => [entry.code, entry.property])).toEqual([
      ['TFC502', 'color'],
    ])
    expect(result.diagnostics.map((d) => d.code)).toEqual(['TFC501', 'TFC502'])
  })
})

describe('convertCss', () => {
  const STYLESHEET = [
    '.btn {',
    '  padding: 16px;',
    '  color: #fff;',
    '}',
    '.card { margin: 0 }',
    '.btn:hover { color: #000 }',
    '@media (min-width: 640px) {',
    '  .btn { padding: 24px }',
    '}',
  ].join('\n')

  it('returns a value, not a promise', () => {
    const result = converter.convertCss(STYLESHEET)
    expect(result).not.toBeInstanceOf(Promise)
    expect(typeof (result as unknown as { then?: unknown }).then).toBe('undefined')
  })

  it('groups rules by subject in source order, each converted as one element', () => {
    const { rules, passthroughCss, diagnostics } = converter.convertCss(STYLESHEET)
    expect(rules.map((rule) => [rule.subject, rule.selectors, rule.result.className])).toEqual([
      ['.btn', ['.btn', '.btn:hover'], 'p-4 text-white sm:p-6 [&:hover]:text-black'],
      ['.card', ['.card'], 'm-0'],
    ])
    expect(passthroughCss).toBe('')
    expect(diagnostics).toEqual([])
    expect(rules.every((rule) => rule.result.exact)).toBe(true)
  })

  it('reads group and peer variants in the shape of Tailwind 4.3 and of insiders', () => {
    const { rules } = converter.convertCss(
      [
        '@media (hover: hover) {',
        '  .a:is(:where(.group):hover *) { display: flex }',
        '  :is(:where(.group):hover .b) { display: flex }',
        '}',
        ':is(:where(.peer):checked ~ .c) { display: flex }',
      ].join('\n'),
    )
    expect(rules.map((rule) => [rule.subject, rule.result.className, rule.result.exact])).toEqual([
      ['.a', 'group-hover:flex', true],
      ['.b', 'group-hover:flex', true],
      ['.c', 'peer-checked:flex', true],
    ])
  })

  it('gives every source its selector transform, conditions, line and column', () => {
    const [btn] = converter.convertCss(STYLESHEET).rules
    const sources = Object.fromEntries(
      (btn?.result.mappings ?? []).map((mapping) => [mapping.className, mapping.sources]),
    )
    expect(sources['p-4']).toEqual([
      {
        property: 'padding',
        value: '16px',
        important: false,
        selector: '&',
        conditions: [],
        line: 2,
        column: 3,
      },
    ])
    expect(sources['sm:p-6']).toEqual([
      expect.objectContaining({
        selector: '&',
        conditions: ['@media (min-width: 640px)'],
        line: 8,
        column: 10,
      }),
    ])
    expect(sources['[&:hover]:text-black']).toEqual([
      expect.objectContaining({ selector: '&:hover', line: 6, column: 14 }),
    ])
  })

  it('reports unconverted declarations and diagnostics with their position', () => {
    const [rule] = converter.convertCss('.a {\n  color: ;\n  padding: 1px;\n}').rules
    expect(rule?.result.classes).toEqual(['p-px'])
    expect(rule?.result.unconverted).toEqual([
      expect.objectContaining({ property: 'color', code: 'TFC102', line: 2, column: 3 }),
    ])
    expect(rule?.result.diagnostics.map((d) => [d.code, d.source?.line])).toEqual([['TFC102', 2]])
  })

  it('splits selector lists and merges selectors of one subject without repeats', () => {
    const { rules } = converter.convertCss(
      '.a, .b { padding: 16px } .a::before { content: "" } .a { margin: 0 }',
    )
    expect(rules.map((rule) => [rule.subject, rule.selectors, rule.result.className])).toEqual([
      ['.a', ['.a', '.a::before'], "m-0 p-4 before:content-['']"],
      ['.b', ['.b'], 'p-4'],
    ])
  })

  it('passes at-rules and class-less subjects through', () => {
    const { rules, passthroughCss, diagnostics } = converter.convertCss(
      '@keyframes x { to { opacity: 0 } }\n:root { --a: 1 }\n.a { padding: 16px }',
    )
    expect(rules.map((rule) => rule.subject)).toEqual(['.a'])
    expect(passthroughCss).toBe(
      '@keyframes x {\n  to {\n    opacity: 0;\n  }\n}\n\n:root {\n  --a: 1;\n}\n',
    )
    expect(diagnostics.map((d) => d.code)).toEqual(['TFC103', 'TFC104'])
  })

  it('never throws on malformed CSS', () => {
    for (const css of ['', '}', '.a {', '.a { color red; padding: 16px', '@media {', ':::']) {
      expect(() => converter.convertCss(css)).not.toThrow()
    }
    expect(converter.convertCss('.a { padding: 16px').rules[0]?.result.classes).toEqual(['p-4'])
    const failed = converter.convertCss(`.a { padding: 16px } ${'}'.repeat(2000)}`)
    expect(failed.rules).toEqual([])
    expect(failed.diagnostics.map((d) => d.code)).toEqual(['TFC101'])
  })
})

describe('toCss', () => {
  it('prints the rules Tailwind generates, in class order, with @property rules last', () => {
    const css = converter.toCss(['md:p-4', 'border', 'p-4', 'p-4', 'not-a-class'])
    expect(css.indexOf('.border {')).toBeLessThan(css.indexOf('.p-4 {'))
    expect(css.indexOf('.p-4 {')).toBeLessThan(css.indexOf('@media (width >= 48rem)'))
    expect(css.match(/\.p-4 \{/g)).toHaveLength(1)
    expect(css).toContain('@property --tw-border-style {')
    expect(css).not.toContain('not-a-class')
    expect(css.endsWith('\n')).toBe(true)
    expect(converter.toCss([])).toBe('')
  })
})

describe('one-shot helpers (LRU of 4)', () => {
  it('reuses the converter for equal options', async () => {
    const first = await sharedConverter()
    expect(await sharedConverter({})).toBe(first)
    expect(await sharedConverter({ mode: 'exact', relax: [] })).toBe(first)
    expect(await sharedConverter({ tolerance: { lengthPx: 3 } })).not.toBe(first)
  }, 60_000)

  it('keeps the four most recently used converters', async () => {
    const first = await sharedConverter({ tolerance: { lengthPx: 1 } })
    for (const lengthPx of [2.5, 3.5, 4.5]) await sharedConverter({ tolerance: { lengthPx } })
    expect(await sharedConverter({ tolerance: { lengthPx: 1 } })).toBe(first)
    for (const lengthPx of [5.5, 6.5, 7.5, 8.5]) await sharedConverter({ tolerance: { lengthPx } })
    expect(await sharedConverter({ tolerance: { lengthPx: 1 } })).not.toBe(first)
  }, 120_000)

  it('does not keep a converter that failed to load', async () => {
    const options = { tailwind: { css: '@import "./missing.css";' } }
    expect(await rejectionCode(sharedConverter(options))).toBe('TFC903')
    expect(await rejectionCode(sharedConverter(options))).toBe('TFC903')
    expect(await rejectionCode(sharedConverter({ important: 'both' as never }))).toBe('TFC904')
  })

  it('convertCss converts with the same shared converters', async () => {
    const css = '.a { padding: 16px }'
    const result = await convertCss(css)
    expect(result).toEqual((await sharedConverter()).convertCss(css))
    expect(result.rules[0]?.result.classes).toEqual(['p-4'])
    expect(await rejectionCode(convertCss(css, { mode: 'x' as never }))).toBe('TFC904')
  }, 60_000)

  it('convertStyles converts with a shared converter', async () => {
    expect((await convertStyles({ declarations: 'padding: 16px' })).classes).toEqual(['p-4'])
    expect(await rejectionCode(convertStyles({ declarations: '' }, { mode: 'x' as never }))).toBe(
      'TFC904',
    )
  }, 60_000)
})
