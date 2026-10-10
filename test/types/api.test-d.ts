import { describe, expectTypeOf, it } from 'vitest'
import type {
  ConversionResult,
  Converter,
  ConverterOptions,
  CssConversionResult,
  DeclarationsInput,
  RelaxationName,
  StyleInput,
} from '../../src/index.ts'
import { TfcError } from '../../src/index.ts'

describe('Converter', () => {
  it('converts synchronously', () => {
    expectTypeOf<Converter['convertStyles']>().returns.toEqualTypeOf<ConversionResult>()
    expectTypeOf<Converter['convertCss']>().returns.toEqualTypeOf<CssConversionResult>()
    expectTypeOf<Converter['toCss']>().returns.toEqualTypeOf<string>()
  })

  it('accepts one style input or many', () => {
    expectTypeOf<Converter['convertStyles']>()
      .parameter(0)
      .toEqualTypeOf<StyleInput | StyleInput[]>()
  })
})

describe('ConverterOptions', () => {
  it('accepts relaxations and their negations', () => {
    expectTypeOf<{ relax: ['hover-media', '!pill-radius'] }>().toExtend<ConverterOptions>()
  })

  it('rejects unknown relaxations and modes', () => {
    expectTypeOf<{ relax: ['hover'] }>().not.toExtend<ConverterOptions>()
    expectTypeOf<{ relax: ['!nope'] }>().not.toExtend<ConverterOptions>()
    expectTypeOf<{ mode: 'fast' }>().not.toExtend<ConverterOptions>()
  })

  it('names every relaxation of the spec', () => {
    expectTypeOf<RelaxationName>().toEqualTypeOf<
      | 'hover-media'
      | 'logical-properties'
      | 'color-nearest'
      | 'length-nearest'
      | 'breakpoint-nearest'
      | 'font-weight-nearest'
      | 'text-line-height'
      | 'pill-radius'
    >()
  })
})

describe('DeclarationsInput', () => {
  it('accepts a string, a record and a declaration list', () => {
    expectTypeOf<'color: red'>().toExtend<DeclarationsInput>()
    expectTypeOf<{ backgroundColor: '#fff'; padding: 8 }>().toExtend<DeclarationsInput>()
    expectTypeOf<
      [{ property: 'color'; value: 'red'; important: true }]
    >().toExtend<DeclarationsInput>()
    expectTypeOf<{ padding: true }>().not.toExtend<DeclarationsInput>()
  })
})

describe('TfcError', () => {
  it('is constructible with fatal codes only', () => {
    expectTypeOf(TfcError).toBeConstructibleWith('TFC904', 'message')
    // @ts-expect-error TFC1xx–5xx are diagnostics, never thrown
    new TfcError('TFC101', 'message')
  })
})
