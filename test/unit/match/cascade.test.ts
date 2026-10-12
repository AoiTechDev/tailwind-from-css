// ADR-0008 / SPEC §5.8: the classes must win where the source rules win, in every context where
// two of them apply together. "What the element shows" is computed the browser's way: every rule
// that applies in a context, cascaded together (`resolveApplied`).
import { beforeAll, describe, expect, it } from 'vitest'
import { converterFromDesign } from '../../../src/converter.ts'
import { conditionsDisjoint } from '../../../src/css/conditions.ts'
import { intersectSelectors } from '../../../src/css/selector.ts'
import { contextIntersection } from '../../../src/match/cascade.ts'
import { resolveOptions } from '../../../src/options.ts'
import type { TailwindDesignSystem } from '../../../src/tailwind/adapter.ts'
import {
  type CompiledCandidate,
  type Context,
  compileCandidates,
  normalizeContext,
  resolveApplied,
} from '../../../src/tailwind/effective.ts'
import type { ConversionResult, Converter, CssConversionResult } from '../../../src/types.ts'
import { designSystem, loadEntry, REPO_ROOT } from '../../helpers/design-system.ts'

const OPTIONS = { rootFontSize: 16 } as const
const MD = '@media (min-width: 768px)'
// What the `hover-media` relaxation produces: `:hover` written as `hover:`.
const HOVER_CSS = '@import "tailwindcss";\n@custom-variant hover (&:hover);'

let design: TailwindDesignSystem
let converter: Converter
let hoverDesign: TailwindDesignSystem
let hoverConverter: Converter

beforeAll(async () => {
  design = await designSystem()
  converter = converterFromDesign(design, resolveOptions(undefined, { base: REPO_ROOT }))
  hoverDesign = await loadEntry(HOVER_CSS)
  hoverConverter = converterFromDesign(
    hoverDesign,
    resolveOptions({ tailwind: { css: HOVER_CSS } }, { base: REPO_ROOT }),
  )
}, 60_000)

const codes = (result: ConversionResult): string[] => result.diagnostics.map((d) => d.code)

const only = (sheet: CssConversionResult): ConversionResult => {
  expect(sheet.rules).toHaveLength(1)
  return (sheet.rules[0] as CssConversionResult['rules'][number]).result
}

/** `property: value` of every longhand the classes give the element where `context` applies. */
function shown(
  classes: readonly string[],
  context: Partial<Context>,
  on: TailwindDesignSystem = design,
): Record<string, string> {
  const compiled = compileCandidates(on, classes, OPTIONS).filter(
    (candidate): candidate is CompiledCandidate => candidate !== null,
  )
  const normal = normalizeContext(
    { selector: context.selector ?? '&', conditions: context.conditions ?? [] },
    OPTIONS,
  )
  return Object.fromEntries(
    resolveApplied(on, compiled, normal, OPTIONS).map((d) => [d.property, d.value]),
  )
}

describe('ADR-0008 example: md + :hover', () => {
  const input = [
    { conditions: [MD], declarations: 'color: red' },
    { selector: '&:hover', declarations: 'color: blue' },
  ]
  const css = '@media (min-width: 768px) { .a { color: red } }\n.a:hover { color: blue }'

  it('exact mode: [&:hover]: is more specific than md:, so no class is added', () => {
    const result = converter.convertStyles(input)
    expect(result.className).toBe('md:text-[red] [&:hover]:text-[blue]')
    expect(codes(result)).not.toContain('TFC401')
    expect(only(converter.convertCss(css)).className).toBe(result.className)
    expect(shown(result.classes, { selector: '&:hover', conditions: [MD] }).color).toBe(
      shown(['text-[blue]'], {}).color,
    )
  })

  it('hover: (the hover-media output) sorts before md: but is more specific, so nothing is added', () => {
    const result = hoverConverter.convertStyles(input)
    expect(result.className).toBe('hover:text-[blue] md:text-[red]')
    expect(codes(result)).not.toContain('TFC401')
    expect(only(hoverConverter.convertCss(css)).className).toBe(result.className)
    expect(
      shown(result.classes, { selector: '&:hover', conditions: [MD] }, hoverDesign).color,
    ).toBe(shown(['text-[blue]'], {}).color)
  })

  it('a later :hover rule overrides an earlier :hover rule within md everywhere: TFC106', () => {
    const sheet = converter.convertCss(
      '@media (min-width: 768px) { .a:hover { color: red } }\n.a:hover { color: blue }',
    )
    const result = only(sheet)
    expect(result.className).toBe('[&:hover]:text-[blue]')
    expect(codes(result)).toEqual(['TFC106', 'TFC201', 'TFC301'])
    expect(result.diagnostics[0]?.source?.conditions).toEqual([MD])
    expect(result.exact).toBe(true)
  })

  it('a later :hover rule within md wins in both outputs', () => {
    const result = only(
      converter.convertCss(
        '.a:hover { color: blue }\n@media (min-width: 768px) { .a:hover { color: red } }',
      ),
    )
    expect(result.className).toBe('[&:hover]:text-[blue] md:[&:hover]:text-[red]')
    expect(codes(result)).not.toContain('TFC401')
  })
})

describe('disjoint contexts', () => {
  it('max-md after md: the width ranges never overlap, so no class is added', () => {
    const result = converter.convertStyles([
      { conditions: [MD], declarations: 'color: red' },
      { conditions: ['@media (width < 48rem)'], declarations: 'color: blue' },
    ])
    expect(result.className).toBe('max-md:text-[blue] md:text-[red]')
    expect(codes(result)).not.toContain('TFC401')
  })

  it('max-lg after md overlaps between 768px and 1024px: a stacked class fixes it', () => {
    const result = converter.convertStyles([
      { conditions: [MD], declarations: 'color: red' },
      { conditions: ['@media (width < 64rem)'], declarations: 'color: blue' },
    ])
    expect(result.classes).toEqual(expect.arrayContaining(['max-lg:text-[blue]', 'md:text-[red]']))
    expect(result.classes).toHaveLength(3)
    expect(codes(result)).toContain('TFC401')
    expect(result.exact).toBe(true)
    const blue = shown(['text-[blue]'], {}).color
    expect(shown(result.classes, { conditions: [MD, '@media (width < 64rem)'] }).color).toBe(blue)
    expect(shown(result.classes, { conditions: [MD] }).color).toBe(shown(['text-[red]'], {}).color)
  })

  it.each([
    ['print', 'screen'],
    ['(orientation: portrait)', '(orientation: landscape)'],
    ['(prefers-color-scheme: dark)', '(prefers-color-scheme: light)'],
  ])('%s and %s never apply together', (first, second) => {
    const result = converter.convertStyles([
      { conditions: [`@media ${second}`], declarations: 'color: red' },
      { conditions: [`@media ${first}`], declarations: 'color: blue' },
    ])
    expect(codes(result)).not.toContain('TFC401')
    expect(result.classes).toHaveLength(2)
  })

  it('a pseudo-element and its element are different boxes', () => {
    const result = converter.convertStyles([
      { selector: '&::before', declarations: 'color: red; content: ""' },
      { declarations: 'color: blue' },
    ])
    expect(codes(result)).not.toContain('TFC401')
    expect(codes(result)).not.toContain('TFC106')
  })
})

describe('specificity beats order', () => {
  it('an earlier, more specific :focus rule wins over a later base rule, as in Tailwind', () => {
    const sheet = converter.convertCss('.a:focus { color: red }\n.a { color: blue }')
    const result = only(sheet)
    expect(result.className).toBe('text-[blue] focus:text-[red]')
    expect(codes(result)).not.toContain('TFC401')
    expect(codes(result)).not.toContain('TFC106')
  })

  it('md + :focus beats a later lg rule where both apply', () => {
    const result = only(
      converter.convertCss(
        '@media (min-width: 768px) { .a:focus { color: red } }\n' +
          '@media (min-width: 1024px) { .a { color: blue } }',
      ),
    )
    expect(codes(result)).not.toContain('TFC401')
    expect(result.classes).toHaveLength(2)
    expect(
      shown(result.classes, {
        selector: '&:focus',
        conditions: [MD, '@media (min-width: 1024px)'],
      }).color,
    ).toBe(shown(['text-[red]'], {}).color)
  })

  it('equal specificity: array order decides, and a stacked class fixes Tailwind order', () => {
    const agrees = converter.convertStyles([
      { selector: '&:focus', declarations: 'color: red' },
      { selector: '.dark &', declarations: 'color: blue' },
    ])
    expect(codes(agrees)).not.toContain('TFC401')
    expect(agrees.classes).toHaveLength(2)

    const fixed = converter.convertStyles([
      { selector: '.dark &', declarations: 'color: blue' },
      { selector: '&:focus', declarations: 'color: red' },
    ])
    expect(codes(fixed)).toContain('TFC401')
    expect(fixed.classes).toHaveLength(3)
    expect(shown(fixed.classes, { selector: '.dark &:focus' }).color).toBe(
      shown(['text-[red]'], {}).color,
    )
  })

  it('an important declaration wins regardless of order', () => {
    const result = converter.convertStyles([
      { conditions: [MD], declarations: 'color: red !important' },
      { declarations: 'color: blue' },
    ])
    expect(result.classes).toHaveLength(2)
    expect(codes(result)).not.toContain('TFC106')
    expect(codes(result)).not.toContain('TFC401')
  })
})

describe('min-[1000px] after md (RESEARCH §3.4: getClassOrder ranks min-[…] before md)', () => {
  const both = [MD, '@media (min-width: 1000px)']

  it('adds one stacked class for the intersection, covering all four paddings', () => {
    const result = only(
      converter.convertCss(
        '@media (min-width: 768px) { .a { padding: 16px } }\n' +
          '@media (min-width: 1000px) { .a { padding: 24px } }',
      ),
    )
    expect(result.classes).toEqual(expect.arrayContaining(['md:p-4', 'min-[1000px]:p-6']))
    expect(result.classes).toHaveLength(3)
    expect(codes(result)).toContain('TFC401')
    expect(result.exact).toBe(true)
    const stacked = result.mappings.find(
      (mapping) => !['md:p-4', 'min-[1000px]:p-6'].includes(mapping.className),
    )
    expect(stacked?.sources.map((source) => source.value)).toEqual(['24px'])
    expect(shown(result.classes, { conditions: both })).toMatchObject({
      'padding-top': '24px',
      'padding-right': '24px',
      'padding-bottom': '24px',
      'padding-left': '24px',
    })
  })

  it('adds nothing when the source order already agrees with Tailwind', () => {
    const result = only(
      converter.convertCss(
        '@media (min-width: 1000px) { .a { padding: 24px } }\n' +
          '@media (min-width: 768px) { .a { padding: 16px } }',
      ),
    )
    expect(result.className).toBe('min-[1000px]:p-6 md:p-4')
    expect(codes(result)).not.toContain('TFC401')
  })
})

describe('@container and @starting-style placed before the base rule', () => {
  it('a later base rule overrides an earlier @starting-style rule everywhere: TFC106', () => {
    const result = only(
      converter.convertCss('@starting-style { .a { opacity: 0 } }\n.a { opacity: 1 }'),
    )
    expect(result.className).toBe('opacity-100')
    expect(codes(result)).toEqual(['TFC106'])
    expect(result.exact).toBe(true)
  })

  it('in the other order both classes stay', () => {
    const result = only(
      converter.convertCss('.a { opacity: 1 }\n@starting-style { .a { opacity: 0 } }'),
    )
    expect(result.className).toBe('opacity-100 starting:opacity-0')
    expect(codes(result)).toEqual([])
  })

  it('a later base rule overrides an earlier @container rule everywhere: TFC106', () => {
    const result = only(
      converter.convertCss(
        '@container (min-width: 400px) { .a { padding: 8px } }\n.a { padding: 4px }',
      ),
    )
    expect(result.className).toBe('p-1')
    expect(new Set(codes(result))).toEqual(new Set(['TFC106']))
  })
})

// A shorthand with `var()` stays whole (N01), but it still sets each longhand it covers: found by
// the canonicalize oracle on Pico CSS (`[type=file]`, `padding: 0` then `padding: calc(…) 0`).
describe('shorthands kept whole', () => {
  it('a later whole shorthand overrides the longhands of an earlier rule: TFC106', () => {
    const result = only(
      converter.convertCss(
        '.a { padding: 0 }\n.a { padding: calc(var(--x) * 0.5) 0; padding-left: var(--y) }',
      ),
    )
    expect(result.className).toBe('[padding:calc(var(--x)_*_0.5)_0] pl-(--y)')
    expect(codes(result)).toContain('TFC106')
    expect(shown(result.classes, {})).toEqual({
      padding: 'calc(var(--x) * 0.5) 0',
      'padding-left': 'var(--y)',
    })
  })

  it('a later longhand whose class Tailwind sorts before the whole shorthand: TFC402', () => {
    for (const [css, longhand, className] of [
      ['.a { border: var(--a); border-top-color: red }', 'border-top-color', '[border:var(--a)]'],
      [
        '.a { background: var(--a); background-color: red }',
        'background-color',
        '[background:var(--a)]',
      ],
      ['.a { font: var(--f); line-height: 2 }', 'line-height', '[font:var(--f)]'],
    ] as const) {
      const result = only(converter.convertCss(css))
      expect(result.className, css).toBe(className)
      expect(
        result.unconverted.map((entry) => [entry.code, entry.property]),
        css,
      ).toEqual([['TFC402', longhand]])
      expect(codes(result), css).not.toContain('TFC501')
    }
  })

  it('a later longhand under an important whole shorthand is overridden: TFC106', () => {
    const result = only(converter.convertCss('.a { padding: var(--p) !important; padding-top: 0 }'))
    expect(result.className).toBe('[padding:var(--p)]!')
    expect(codes(result)).toContain('TFC106')
    const important = only(
      converter.convertCss('.a { border: var(--a); border-top-color: red !important }'),
    )
    expect(important.className).toBe('border-t-[red]! [border:var(--a)]')
    expect(important.unconverted).toEqual([])
  })

  it('a later base longhand over an earlier @media whole shorthand gets a stacked class', () => {
    const result = only(
      converter.convertCss(
        '@media (min-width: 768px) { .a { padding: var(--p) } }\n.a { padding-top: 4px }',
      ),
    )
    expect(result.className).toBe('pt-1 md:[padding:var(--p)] md:pt-1')
    expect(codes(result)).toContain('TFC401')
    expect(shown(result.classes, { conditions: [MD] })).toEqual({
      padding: 'var(--p)',
      'padding-top': '4px',
    })
  })

  it('in the other order, or with a later @media longhand, nothing is stacked', () => {
    const before = only(
      converter.convertCss(
        '.a { padding-top: 4px }\n@media (min-width: 768px) { .a { padding: var(--p) } }',
      ),
    )
    expect(before.className).toBe('pt-1 md:[padding:var(--p)]')
    expect(codes(before)).not.toContain('TFC401')
    expect(shown(before.classes, { conditions: [MD] })).toEqual({ padding: 'var(--p)' })
    const after = only(
      converter.convertCss(
        '.a { padding: var(--p) }\n@media (min-width: 768px) { .a { padding-top: 8px } }',
      ),
    )
    expect(after.className).toBe('[padding:var(--p)] md:pt-2')
    expect(codes(after)).not.toContain('TFC401')
  })

  it('a later base whole shorthand shadows an earlier @media longhand: TFC106', () => {
    const result = only(
      converter.convertCss(
        '@media (min-width: 768px) { .a { padding-top: 4px } }\n.a { padding: var(--p) }',
      ),
    )
    expect(result.className).toBe('[padding:var(--p)]')
    expect(codes(result)).toContain('TFC106')
  })
})

describe('TFC402', () => {
  it('more than four conflicting contexts: the declarations Tailwind would wrongly show', () => {
    const widths = ['1280px', '1024px', '768px', '1000px', '900px']
    const result = converter.convertStyles(
      widths.map((width, index) => ({
        conditions: [`@media (min-width: ${width})`],
        declarations: `color: rgb(${index} 0 0)`,
      })),
    )
    expect(result.className).toBe('min-[900px]:text-[rgb(4_0_0)]')
    expect(result.unconverted.map((entry) => [entry.code, entry.conditions[0]])).toEqual(
      widths.slice(0, 4).map((width) => ['TFC402', `@media (min-width: ${width})`]),
    )
    expect(result.exact).toBe(false)
  })

  it('four conflicting contexts are fixed with stacked classes for their intersections', () => {
    const widths = ['1024px', '768px', '1000px', '900px']
    const result = converter.convertStyles(
      widths.map((width, index) => ({
        conditions: [`@media (min-width: ${width})`],
        declarations: `color: rgb(${index} 0 0)`,
      })),
    )
    expect(codes(result)).not.toContain('TFC402')
    expect(codes(result)).toContain('TFC401')
    const conditions = widths.map((width) => `@media (min-width: ${width})`)
    for (let first = 0; first < widths.length; first++) {
      for (let second = first + 1; second < widths.length; second++) {
        const at = conditions.slice(first, second + 1)
        expect(shown(result.classes, { conditions: at }).color, at.join(' ')).toBe(
          shown([`text-[rgb(${second}_0_0)]`], {}).color,
        )
      }
    }
  })

  it('two different ancestors have no intersection selector to stack on', () => {
    const result = converter.convertStyles([
      { selector: '.y &', declarations: 'color: blue' },
      { selector: '.x &', declarations: 'color: red' },
    ])
    expect(result.className).toBe('[.x_&]:text-[red]')
    expect(result.unconverted.map((entry) => [entry.code, entry.selector])).toEqual([
      ['TFC402', '.y &'],
    ])
  })
})

describe('TFC402 after removing a class', () => {
  it('a stacked intersection that meets another ancestor can not be checked', () => {
    const result = converter.convertStyles([
      { selector: '.dark &', declarations: 'color: blue' },
      { selector: '&:focus', declarations: 'color: red' },
      { selector: '.y &', declarations: 'color: green' },
    ])
    expect(result.className).toBe('focus:text-[red] [.y_&]:text-[green]')
    expect(result.unconverted.map((entry) => [entry.code, entry.selector])).toEqual([
      ['TFC402', '.dark &'],
    ])
  })

  it("a loser's class keeps its other longhands as arbitrary properties", () => {
    const result = converter.convertStyles([
      { conditions: ['@media (min-width: 1280px)'], declarations: 'padding: 4px' },
      ...['1024px', '768px', '1000px', '900px'].map((width, index) => ({
        conditions: [`@media (min-width: ${width})`],
        declarations: `padding-top: ${index + 1}px`,
      })),
    ])
    expect(result.classes).toEqual([
      'min-[900px]:pt-1',
      'xl:[padding-right:4px]',
      'xl:[padding-bottom:4px]',
      'xl:[padding-left:4px]',
    ])
    expect(result.unconverted.map((entry) => `${entry.property}: ${entry.value}`)).toEqual([
      'padding-top: 4px',
      'padding-top: 1px',
      'padding-top: 2px',
      'padding-top: 3px',
    ])
    expect(new Set(result.unconverted.map((entry) => entry.code))).toEqual(new Set(['TFC402']))
    expect(codes(result)).not.toContain('TFC501')
  })
})

describe('no conflict, nothing to do', () => {
  it('different longhands per context add nothing', () => {
    const result = converter.convertStyles([
      { conditions: [MD], declarations: 'padding: 16px' },
      { selector: '&:hover', declarations: 'color: red' },
      { declarations: 'margin: 4px' },
    ])
    expect(result.className).toBe('m-1 md:p-4 [&:hover]:text-[red]')
    expect(codes(result)).toEqual(['TFC201', 'TFC301'])
  })

  it('a vendor copy in a broader context next to an important longhand (property-test seed)', () => {
    const result = converter.convertStyles([
      { declarations: '-webkit-user-select: none' },
      { conditions: [MD], declarations: 'user-select: none !important' },
    ])
    expect(codes(result)).not.toContain('TFC401')
    expect(codes(result)).not.toContain('TFC402')
    expect(shown(result.classes, { conditions: [MD] })['user-select']).toBe('none')
  })

  it('equal values in conflicting order add nothing', () => {
    const result = converter.convertStyles([
      { conditions: [MD], declarations: 'color: red' },
      { conditions: ['@media (min-width: 1000px)'], declarations: 'color: red' },
    ])
    expect(result.classes).toHaveLength(2)
    expect(codes(result)).not.toContain('TFC401')
  })
})

describe('context helpers', () => {
  it.each([
    [['@media (width >= 768px)'], ['@media (width < 768px)'], true],
    [['@media (width >= 768px)'], ['@media (width <= 768px)'], false],
    [['@media (width > 768px)'], ['@media (width <= 768px)'], true],
    [['@media (width = 500px)'], ['@media (width >= 768px)'], true],
    [['@media (width < 1024px) and (width >= 768px)'], ['@media (width >= 1024px)'], true],
    [['@media print'], ['@media screen'], true],
    [['@media print and (width >= 768px)'], ['@media (width >= 768px)'], false],
    [['@media (orientation: portrait)'], ['@media (orientation: landscape)'], true],
    [['@media (prefers-color-scheme: dark)'], ['@media (prefers-color-scheme: light)'], true],
    [['@media (prefers-color-scheme: dark)'], ['@media (hover: hover)'], false],
    [['@media not print'], ['@media print'], false],
    [['@media (width >= 768px), print'], ['@media (width < 768px)'], false],
    [['@supports (display: grid)'], ['@supports not (display: grid)'], false],
    [['@container (width >= 400px)'], ['@container (width < 400px)'], false],
  ])('conditionsDisjoint(%j, %j) is %s', (a, b, expected) => {
    expect(conditionsDisjoint(a, b)).toBe(expected)
    expect(conditionsDisjoint(b, a)).toBe(expected)
  })

  it.each([
    ['&:hover', '&:focus', '&:hover:focus'],
    ['&', '&:hover', '&:hover'],
    ['.dark &', '&:hover', '.dark &:hover'],
    ['&:hover::before', '&::before', '&:hover::before'],
    ['&::before', '&', 'disjoint'],
    ['&::before', '&::after', 'disjoint'],
    ['& > p', '&', 'disjoint'],
    ['& > p', '& > p', '& > p'],
    ['& > p', '& > span', undefined],
    ['.x &', '.y &', undefined],
    [':where(&)', '&', undefined],
  ])('intersectSelectors(%s, %s) is %s', (a, b, expected) => {
    expect(intersectSelectors(a, b)).toBe(expected)
    expect(intersectSelectors(b, a) === undefined).toBe(expected === undefined)
  })

  it('contextIntersection merges conditions and selectors, or says why it can not', () => {
    const md = { selector: '&', conditions: ['@media (width >= 768px)'] }
    expect(contextIntersection(md, { selector: '&:hover', conditions: [] }, OPTIONS)).toEqual({
      selector: '&:hover',
      conditions: ['@media (width >= 768px)'],
    })
    expect(
      contextIntersection(md, { selector: '&', conditions: ['@media (width < 768px)'] }, OPTIONS),
    ).toBe('disjoint')
    expect(contextIntersection(md, { selector: '&::after', conditions: [] }, OPTIONS)).toBe(
      'disjoint',
    )
    expect(
      contextIntersection(
        { selector: '.x &', conditions: [] },
        { selector: '.y &', conditions: [] },
        OPTIONS,
      ),
    ).toBeUndefined()
  })
})
