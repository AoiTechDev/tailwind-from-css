// ADR-0004 / SPEC §4: each relaxation fires only when enabled, respects its tolerance limits,
// and is reported on the class (`relaxation`, `TFC203`, `exact: false`).
import { beforeAll, describe, expect, it } from 'vitest'
import { converterFromDesign } from '../../../src/converter.ts'
import { normalizeColor } from '../../../src/css/normalize/colors.ts'
import {
  logicalProperty,
  nearestSpacingTokens,
  physicalProperty,
  type RelaxSettings,
  relaxedValue,
  relaxSettings,
} from '../../../src/match/relax.ts'
import { resolveOptions } from '../../../src/options.ts'
import type { TailwindDesignSystem } from '../../../src/tailwind/adapter.ts'
import type {
  ConversionResult,
  Converter,
  ConverterOptions,
  RelaxationName,
  StyleInput,
} from '../../../src/types.ts'
import { designSystem, loadEntry, REPO_ROOT } from '../../helpers/design-system.ts'

const RED_500 = 'oklch(0.637 0.237 25.331 / 1)'
const HOVER_CSS = '@import "tailwindcss";\n@custom-variant hover (&:hover);'
const MD = '@media (min-width: 768px)'

let design: TailwindDesignSystem
let hoverDesign: TailwindDesignSystem
const converters = new Map<string, Converter>()

beforeAll(async () => {
  design = await designSystem()
  hoverDesign = await loadEntry(HOVER_CSS)
  // Builds both utility indexes here; converters made later share them.
  converterFor({})
  converterFor({ tailwind: { css: HOVER_CSS } })
}, 60_000)

const settings = (options: ConverterOptions = { mode: 'nearest' }): RelaxSettings =>
  relaxSettings(resolveOptions(options, { base: REPO_ROOT })) as RelaxSettings

const color = (text: string): string => normalizeColor(text) as string

function converterFor(options: ConverterOptions): Converter {
  const key = JSON.stringify(options)
  let converter = converters.get(key)
  if (converter === undefined) {
    const on = options.tailwind?.css === HOVER_CSS ? hoverDesign : design
    converter = converterFromDesign(on, resolveOptions(options, { base: REPO_ROOT }))
    converters.set(key, converter)
  }
  return converter
}

const convert = (options: ConverterOptions, input: StyleInput | StyleInput[]): ConversionResult =>
  converterFor(options).convertStyles(input)

const only = (name: RelaxationName): ConverterOptions => ({ relax: [name] })
const allBut = (name: RelaxationName): ConverterOptions => ({
  mode: 'nearest',
  relax: [`!${name}`],
})

/** `[class, relaxation name, delta]` per mapping that has a relaxation. */
const relaxed = (result: ConversionResult): (string | number | undefined)[][] =>
  result.mappings.flatMap((mapping) =>
    mapping.relaxation === undefined
      ? []
      : [[mapping.className, mapping.relaxation.name, mapping.relaxation.delta]],
  )

const codes = (result: ConversionResult): string[] =>
  result.diagnostics.map((diagnostic) => diagnostic.code)

/** Asserts the relaxation fires only when enabled: exact, enabled alone, `nearest` without it. */
function firesOnlyWhenEnabled(
  name: RelaxationName,
  input: StyleInput | StyleInput[],
  exact: string,
  relaxedClassName: string,
): ConversionResult {
  const plain = convert({}, input)
  expect(plain.className).toBe(exact)
  expect(plain.exact).toBe(true)
  expect(codes(plain)).not.toContain('TFC203')
  expect(convert(allBut(name), input).className).toBe(exact)
  const result = convert(only(name), input)
  expect(result.className).toBe(relaxedClassName)
  expect(result.mappings.some((mapping) => mapping.relaxation?.name === name)).toBe(true)
  expect(codes(result)).toContain('TFC203')
  expect(codes(result)).not.toContain('TFC501')
  expect(result.exact).toBe(false)
  return result
}

describe('relaxedValue', () => {
  it('matches equal values with no relaxation, whatever is enabled', () => {
    expect(relaxedValue(settings({}), 'padding-top', '14px', '14px')).toEqual({ delta: 0 })
    expect(relaxedValue(settings(), 'color', RED_500, RED_500)).toEqual({ delta: 0 })
  })

  it('length-nearest: px within lengthPx and lengthRatio, for the listed families', () => {
    expect(relaxedValue(settings(), 'padding-top', '13.3px', '14px')).toEqual({
      delta: 0.7,
      relaxation: {
        name: 'length-nearest',
        detail: 'padding-top: 13.3px → 14px',
        delta: 0.7,
      },
    })
    for (const property of ['width', 'max-height', 'top', 'gap', 'font-size', 'line-height']) {
      expect(relaxedValue(settings(), property, '30px', '31px')?.relaxation?.name).toBe(
        'length-nearest',
      )
    }
    const tight = settings({ mode: 'nearest', tolerance: { lengthPx: 0.5 } })
    expect(relaxedValue(tight, 'padding-top', '13.3px', '14px')).toBeUndefined()
    expect(relaxedValue(settings(), 'margin-top', '3.1px', '4px')).toBeUndefined()
    const loose = settings({ mode: 'nearest', tolerance: { lengthRatio: 0.5 } })
    expect(relaxedValue(loose, 'margin-top', '3.1px', '4px')?.delta).toBe(0.9)
    expect(relaxedValue(settings(), 'border-top-width', '1.5px', '2px')).toBeUndefined()
    expect(relaxedValue(settings(), 'padding-top', '10%', '11%')).toBeUndefined()
    expect(relaxedValue(settings(), 'padding-top', '0', '1px')).toBeUndefined()
    expect(relaxedValue(settings({ relax: ['color-nearest'] }), 'width', '30px', '31px')).toBe(
      undefined,
    )
  })

  it('pill-radius: 1000px or more on a radius becomes calc(infinity * 1px)', () => {
    const infinite = 'calc(infinity * 1px)'
    expect(relaxedValue(settings(), 'border-top-left-radius', '9999px', infinite)).toEqual({
      delta: 0,
      relaxation: {
        name: 'pill-radius',
        detail: 'border-top-left-radius: 9999px → calc(infinity * 1px)',
      },
    })
    expect(relaxedValue(settings(), 'border-top-left-radius', '999px', infinite)).toBeUndefined()
    expect(relaxedValue(settings(), 'padding-top', '9999px', infinite)).toBeUndefined()
    expect(
      relaxedValue(settings(allBut('pill-radius')), 'border-top-left-radius', '9999px', infinite),
    ).toBeUndefined()
  })

  it('font-weight-nearest: any distance, measured', () => {
    expect(relaxedValue(settings(), 'font-weight', '450', '400')?.delta).toBe(50)
    expect(relaxedValue(settings(), 'font-weight', '450', '900')?.delta).toBe(450)
    expect(relaxedValue(settings(), 'font-weight', 'bolder', '700')).toBeUndefined()
    expect(relaxedValue(settings(allBut('font-weight-nearest')), 'font-weight', '450', '400')).toBe(
      undefined,
    )
  })

  it('color-nearest: ΔE OK within colorDeltaE, across spaces, with equal alpha', () => {
    const near = relaxedValue(settings(), 'color', color('rgb(245, 50, 60)'), RED_500)
    expect(near?.relaxation?.name).toBe('color-nearest')
    expect(near?.delta).toBeCloseTo(0.011, 3)
    expect(relaxedValue(settings(), 'color', color('#ef4444'), RED_500)).toBeUndefined()
    const loose = settings({ mode: 'nearest', tolerance: { colorDeltaE: 0.03 } })
    expect(relaxedValue(loose, 'color', color('#ef4444'), RED_500)?.delta).toBeCloseTo(0.0292, 3)
    const half = color('rgba(245, 50, 60, 0.5)')
    expect(relaxedValue(settings(), 'color', half, RED_500)).toBeUndefined()
    expect(relaxedValue(settings(), 'color', half, 'oklch(0.637 0.237 25.331 / 0.5)')).toBeDefined()
    expect(relaxedValue(settings(), '--brand', color('rgb(245, 50, 60)'), RED_500)).toBe(undefined)
    expect(
      relaxedValue(settings(allBut('color-nearest')), 'color', color('rgb(245, 50, 60)'), RED_500),
    ).toBeUndefined()
  })
})

describe('logical twins', () => {
  it('pairs every physical side and corner with its LTR logical longhand', () => {
    const pairs = [
      ['margin-left', 'margin-inline-start'],
      ['padding-right', 'padding-inline-end'],
      ['scroll-margin-top', 'scroll-margin-block-start'],
      ['bottom', 'inset-block-end'],
      ['border-right-color', 'border-inline-end-color'],
      ['border-top-left-radius', 'border-start-start-radius'],
      ['border-bottom-right-radius', 'border-end-end-radius'],
    ]
    for (const [physical, logical] of pairs) {
      expect(logicalProperty(physical as string)).toBe(logical)
      expect(physicalProperty(logical as string)).toBe(physical)
    }
    expect(logicalProperty('margin')).toBeUndefined()
    expect(physicalProperty('margin-left')).toBeUndefined()
  })
})

describe('nearestSpacingTokens', () => {
  const spacing = { value: 4, unit: 'px' }
  it('gives the multiples of 0.5 of --spacing around a length', () => {
    expect(nearestSpacingTokens('13.3px', spacing)).toEqual(['3', '3.5'])
    expect(nearestSpacingTokens('-13.3px', spacing)).toEqual(['3', '3.5'])
    expect(nearestSpacingTokens('14px', spacing)).toEqual(['3.5'])
    expect(nearestSpacingTokens('1em', spacing)).toEqual([])
    expect(nearestSpacingTokens('auto', spacing)).toEqual([])
    expect(nearestSpacingTokens('14px', undefined)).toEqual([])
  })
})

describe('each relaxation fires only when enabled', () => {
  it('hover-media: :hover → hover: (ADR-0006)', () => {
    const input = { selector: '&:hover', declarations: 'color: #000' }
    const result = firesOnlyWhenEnabled(
      'hover-media',
      input,
      '[&:hover]:text-black',
      'hover:text-black',
    )
    expect(relaxed(result)).toEqual([['hover:text-black', 'hover-media', undefined]])
    expect(result.mappings[0]?.sources[0]?.selector).toBe('&:hover')
    const md = { selector: '&:hover:focus', conditions: [MD], declarations: 'color: #000' }
    expect(convert(only('hover-media'), md).className).toBe('md:hover:focus:text-black')
  })

  it('hover-media: nothing to relax when hover is redefined as plain &:hover', () => {
    const options = { mode: 'nearest', tailwind: { css: HOVER_CSS } } satisfies ConverterOptions
    const result = convert(options, { selector: '&:hover', declarations: 'color: #000' })
    expect(result.className).toBe('hover:text-black')
    expect(result.exact).toBe(true)
  })

  it('hover-media: kept exact when another block already has the relaxed context', () => {
    const result = convert(only('hover-media'), [
      { selector: '&:hover', declarations: 'color: #000' },
      { selector: '&:hover', conditions: ['@media (hover: hover)'], declarations: 'opacity: 0.5' },
    ])
    expect(result.className).toBe('hover:opacity-50 [&:hover]:text-black')
    expect(result.exact).toBe(true)
  })

  it('logical-properties: left/right and top/bottom pairs collapse', () => {
    const result = firesOnlyWhenEnabled(
      'logical-properties',
      { declarations: 'margin: 0 auto' },
      'mt-0 mr-auto mb-0 ml-auto',
      'mx-auto my-0',
    )
    expect(relaxed(result)).toEqual([
      ['mx-auto', 'logical-properties', undefined],
      ['my-0', 'logical-properties', undefined],
    ])
    expect(result.mappings[0]?.relaxation?.detail).toBe(
      'margin-left as margin-inline-start; margin-right as margin-inline-end',
    )
  })

  it('logical-properties: a lone side stays physical', () => {
    const result = convert(only('logical-properties'), { declarations: 'margin-left: 8px' })
    expect(result.className).toBe('ml-2')
    expect(result.exact).toBe(true)
  })

  it('logical-properties: not where another block sets the same side', () => {
    const result = convert(only('logical-properties'), [
      { declarations: 'margin-left: 8px; margin-right: 8px' },
      { conditions: [MD], declarations: 'margin-left: 0' },
    ])
    expect(result.className).toBe('mr-2 ml-2 md:ml-0')
    expect(result.exact).toBe(true)
  })

  it('color-nearest: within colorDeltaE only, keeping alpha', () => {
    const result = firesOnlyWhenEnabled(
      'color-nearest',
      { declarations: 'color: rgb(245, 50, 60)' },
      'text-[rgb(245,50,60)]',
      'text-red-500',
    )
    expect(relaxed(result)[0]?.[2]).toBeCloseTo(0.011, 3)
    expect(
      convert(only('color-nearest'), { declarations: 'background-color: rgba(245, 50, 60, 0.5)' })
        .className,
    ).toBe('bg-red-500/50')
    expect(convert(only('color-nearest'), { declarations: 'color: #ef4444' }).className).toBe(
      'text-[#ef4444]',
    )
    const loose = {
      relax: ['color-nearest'],
      tolerance: { colorDeltaE: 0.03 },
    } satisfies ConverterOptions
    expect(convert(loose, { declarations: 'color: #ef4444' }).exact).toBe(false)
  })

  it('color-nearest: a grey snaps to the achromatic palette, whose hue is missing in 4.3', () => {
    expect(convert(only('color-nearest'), { declarations: 'color: #767676' }).className).toBe(
      'text-neutral-500',
    )
  })

  it('length-nearest: a theme value or a spacing step of 0.5, within both limits', () => {
    const result = firesOnlyWhenEnabled(
      'length-nearest',
      { declarations: 'padding: 13.3px' },
      'p-[13.3px]',
      'p-3.5',
    )
    expect(relaxed(result)).toEqual([['p-3.5', 'length-nearest', 0.7]])
    expect(result.mappings[0]?.sources[0]?.value).toBe('13.3px')
    expect(convert(only('length-nearest'), { declarations: 'max-width: 447.5px' }).className).toBe(
      'max-w-md',
    )
    expect(convert(only('length-nearest'), { declarations: 'margin-top: 3.1px' }).className).toBe(
      'mt-[3.1px]',
    )
    const ratio = {
      relax: ['length-nearest'],
      tolerance: { lengthRatio: 0.5 },
    } satisfies ConverterOptions
    expect(convert(ratio, { declarations: 'margin-top: 3.1px' }).className).toBe('mt-1')
    const px = {
      relax: ['length-nearest'],
      tolerance: { lengthPx: 0.5 },
    } satisfies ConverterOptions
    expect(convert(px, { declarations: 'padding: 13.3px' }).className).toBe('p-[13.3px]')
    expect(convert(only('length-nearest'), { declarations: 'margin-top: -13.3px' }).className).toBe(
      '-mt-3.5',
    )
  })

  it('breakpoint-nearest: width bounds snap to a breakpoint within breakpointPx', () => {
    const black = (conditions: string[]): StyleInput => ({
      conditions,
      declarations: 'color: #000',
    })
    const result = firesOnlyWhenEnabled(
      'breakpoint-nearest',
      black(['@media (max-width: 767px)']),
      '[@media(max-width:767px)]:text-black',
      'max-md:text-black',
    )
    expect(relaxed(result)).toEqual([['max-md:text-black', 'breakpoint-nearest', 1]])
    expect(
      convert(only('breakpoint-nearest'), black(['@media (min-width: 770px)'])).className,
    ).toBe('md:text-black')
    expect(
      convert(only('breakpoint-nearest'), black(['@media (min-width: 800px)'])).className,
    ).toBe('min-[800px]:text-black')
    const wide = {
      relax: ['breakpoint-nearest'],
      tolerance: { breakpointPx: 40 },
    } satisfies ConverterOptions
    expect(convert(wide, black(['@media (min-width: 800px)'])).className).toBe('md:text-black')
    expect(
      convert(only('breakpoint-nearest'), black(['@container (min-width: 450px)'])).className,
    ).toBe('@md:text-black')
  })

  it('font-weight-nearest: the nearest theme weight', () => {
    firesOnlyWhenEnabled(
      'font-weight-nearest',
      { declarations: 'font-weight: 480' },
      'font-[480]',
      'font-medium',
    )
    expect(
      convert(only('font-weight-nearest'), { declarations: 'font-weight: 420' }).className,
    ).toBe('font-normal')
  })

  it('text-line-height: text-<size> alone, adding its line-height', () => {
    const result = firesOnlyWhenEnabled(
      'text-line-height',
      { declarations: 'font-size: 14px' },
      'text-[14px]',
      'text-sm',
    )
    expect(result.mappings[0]?.relaxation?.detail).toBe('adds line-height: 1.4286')
    expect(result.mappings[0]?.sources.map((source) => source.property)).toEqual(['font-size'])
  })

  it('text-line-height: not when any block of the element sets line-height', () => {
    const result = convert(only('text-line-height'), [
      { declarations: 'font-size: 14px' },
      { selector: '&:hover', declarations: 'line-height: 2' },
    ])
    expect(result.className).toBe('text-[14px] [&:hover]:leading-loose')
    expect(convert(only('text-line-height'), { declarations: 'font: 14px/2 serif' }).exact).toBe(
      true,
    )
  })

  it('text-line-height: a pseudo-element setting line-height is another box', () => {
    const result = convert(only('text-line-height'), [
      { declarations: 'font-size: 14px' },
      { selector: '&::before', declarations: 'content: ""; line-height: 2' },
    ])
    expect(result.className).toBe("text-sm before:leading-loose before:content-['']")
  })

  it('a near size takes the modifier for a line-height no class sets exactly', () => {
    const input = { declarations: 'font-size: 18.2px; line-height: 1.45' }
    expect(convert({}, input).className).toBe('text-[18.2px]/[1.45]')
    const result = convert(only('length-nearest'), input)
    expect(result.className).toBe('text-lg/[1.45]')
    expect(relaxed(result)).toEqual([['text-lg/[1.45]', 'length-nearest', 0.2]])
  })

  it('pill-radius: a huge radius becomes rounded-full', () => {
    firesOnlyWhenEnabled(
      'pill-radius',
      { declarations: 'border-radius: 9999px' },
      'rounded-[9999px]',
      'rounded-full',
    )
  })
})

describe('nearest mode', () => {
  it('combines relaxations on one class and reports each with TFC203', () => {
    const result = convert({ mode: 'nearest' }, [
      { selector: '&:hover', declarations: 'color: rgb(245, 50, 60); font-size: 14.2px' },
    ])
    expect(result.className).toBe('hover:text-sm hover:text-red-500')
    expect(relaxed(result)).toEqual([
      ['hover:text-sm', 'hover-media', undefined],
      ['hover:text-red-500', 'hover-media', undefined],
    ])
    expect(codes(result).filter((code) => code === 'TFC203')).toHaveLength(5)
    expect(result.exact).toBe(false)
  })

  it('an arbitrary size takes the exact line-height as its modifier instead of a near one', () => {
    const input = { declarations: 'font-size: 44px; line-height: 50.6px' }
    expect(convert({}, input).className).toBe('text-[44px]/[50.6px]')
    const result = convert({ mode: 'nearest' }, input)
    expect(result.className).toBe('text-[44px]/[50.6px]')
    expect(relaxed(result)).toEqual([])
    expect(result.exact).toBe(true)
  })

  it('verifies against the relaxed target: no fallback, every class compiles', () => {
    const result = convert({ mode: 'nearest' }, [
      { declarations: 'padding: 13.3px; margin: 0 auto; border-radius: 9999px; font-size: 14px' },
      { conditions: ['@media (min-width: 770px)'], declarations: 'padding: 17.9px' },
    ])
    expect(result.className).toBe('mx-auto my-0 rounded-full p-3.5 text-sm md:p-4.5')
    expect(codes(result)).not.toContain('TFC501')
    expect(result.unconverted).toEqual([])
  })
})

describe('redundant relaxed layers', () => {
  const LG = '@media (min-width: 1280px)'
  const layers = (base: string, md: string, lg: string): StyleInput[] => [
    { declarations: base },
    { conditions: [MD], declarations: md },
    { conditions: [LG], declarations: lg },
  ]
  const sourcesOf = (result: ConversionResult, className: string): string[] =>
    (result.mappings.find((mapping) => mapping.className === className)?.sources ?? []).map(
      (source) => [...source.conditions, `${source.property}: ${source.value}`].join(' | '),
    )

  it('drops a relaxed layer that repeats the base', () => {
    const input = layers('font-size: 23.05px', 'font-size: 25.4px', 'font-size: 28px')
    expect(convert({}, input).className).toBe('text-[23.05px] md:text-[25.4px] xl:text-[28px]')
    const result = convert({ mode: 'nearest' }, input)
    expect(result.className).toBe('text-2xl xl:text-3xl')
    expect(codes(result)).not.toContain('TFC501')
    expect(codes(result)).not.toContain('TFC401')
    expect(result.unconverted).toEqual([])
  })

  it('drops a relaxed layer that repeats a narrower layer', () => {
    const input = layers('margin-top: 16px', 'margin-top: 17.9px', 'margin-top: 18.2px')
    expect(convert(only('length-nearest'), input).className).toBe('mt-4 md:mt-4.5')
  })

  it('keeps it when a layer in between sets another value', () => {
    const input = layers('margin-top: 16px', 'margin-top: 20px', 'margin-top: 16.4px')
    expect(convert(only('length-nearest'), input).className).toBe('mt-4 md:mt-5 xl:mt-4')
  })

  it('drops a chain of repeats down to the base', () => {
    const input = layers('margin-top: 16.3px', 'margin-top: 15.8px', 'margin-top: 16.2px')
    expect(convert(only('length-nearest'), input).className).toBe('mt-4')
  })

  it('drops each class whose longhands all repeat, and keeps the others', () => {
    const repeated = layers('padding: 16px', 'padding: 17.9px', 'padding: 18.2px')
    expect(convert(only('length-nearest'), repeated).className).toBe('p-4 md:p-4.5')
    const split = layers('padding: 16px', 'padding: 17.9px', 'padding: 18.2px 20px')
    expect(convert(only('length-nearest'), split).className).toBe('p-4 md:p-4.5 xl:pr-5 xl:pl-5')
  })

  it('reports the dropped declaration on the class that shows it, and stays inexact', () => {
    const result = convert(only('length-nearest'), [
      { declarations: 'margin-top: 18px' },
      { conditions: [MD], declarations: 'margin-top: 18.3px' },
    ])
    expect(result.className).toBe('mt-4.5')
    expect(sourcesOf(result, 'mt-4.5')).toEqual(['margin-top: 18px', `${MD} | margin-top: 18.3px`])
    expect(relaxed(result)).toEqual([['mt-4.5', 'length-nearest', 0.3]])
    expect(codes(result).filter((code) => code === 'TFC203')).toHaveLength(1)
    expect(result.exact).toBe(false)
  })

  it('carries the layer’s context relaxations', () => {
    const result = convert({ mode: 'nearest' }, [
      { declarations: 'margin-top: 18px' },
      { conditions: ['@media (min-width: 770px)'], declarations: 'margin-top: 18.3px' },
    ])
    expect(result.className).toBe('mt-4.5')
    const mapping = result.mappings.find((item) => item.className === 'mt-4.5')
    expect(mapping?.relaxation?.name).toBe('length-nearest')
    expect(codes(result).filter((code) => code === 'TFC203')).toHaveLength(2)
  })

  it('keeps it when the class that would show its value needs a stacked class', () => {
    const result = convert(only('length-nearest'), [
      { declarations: 'margin-top: 10px' },
      { conditions: ['@media print'], declarations: 'margin-top: 30px' },
      { conditions: [MD], declarations: 'margin-top: 18px' },
      { conditions: [LG], declarations: 'margin-top: 18.2px' },
    ])
    expect(result.className).toBe(
      'mt-2.5 md:mt-4.5 xl:mt-4.5 print:mt-7.5 print:md:mt-4.5 print:xl:mt-4.5',
    )
    expect(codes(result)).toContain('TFC401')
  })

  it('never drops in exact mode, nor an exact repeat', () => {
    const input = [
      { declarations: 'margin-top: 16px' },
      { conditions: [MD], declarations: 'margin-top: 16px' },
    ]
    expect(convert({}, input).className).toBe('mt-4 md:mt-4')
    expect(convert({ mode: 'nearest' }, input).className).toBe('mt-4 md:mt-4')
  })

  it('only drops layers under a width condition', () => {
    const result = convert(only('length-nearest'), [
      { declarations: 'margin-top: 16px' },
      { selector: '&:hover', declarations: 'margin-top: 16.4px' },
    ])
    expect(result.className).toBe('mt-4 [&:hover]:mt-4')
  })

  it('keeps it when the other block differs in importance', () => {
    const result = convert(only('length-nearest'), [
      { declarations: 'margin-top: 16px' },
      { conditions: [MD], declarations: 'margin-top: 16.4px !important' },
    ])
    expect(result.className).toBe('mt-4 md:mt-4!')
  })
})
