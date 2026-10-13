import { describe, expectTypeOf, it } from 'vitest'
import type {
  ConversionResult,
  Converter,
  ConverterOptions,
  CssConversionResult,
  Declaration,
  DeclarationsInput,
  PruneOptions,
  RelaxationName,
  ResolvedOptions,
  StyleInput,
} from '../../src/index.ts'
import {
  convertCss,
  convertStyles,
  createConverter,
  pruneStyles,
  TfcError,
} from '../../src/index.ts'

describe('createConverter', () => {
  it('is async and resolves to a Converter', () => {
    expectTypeOf(createConverter).returns.toEqualTypeOf<Promise<Converter>>()
    expectTypeOf(createConverter).parameter(0).toEqualTypeOf<ConverterOptions | undefined>()
  })
})

describe('convertStyles (one-shot)', () => {
  it('is async and takes the same input as the converter method', () => {
    expectTypeOf(convertStyles).returns.toEqualTypeOf<Promise<ConversionResult>>()
    expectTypeOf(convertStyles).parameter(0).toEqualTypeOf<StyleInput | StyleInput[]>()
    expectTypeOf(convertStyles).parameter(1).toEqualTypeOf<ConverterOptions | undefined>()
  })
})

describe('convertCss (one-shot)', () => {
  it('is async and takes the same input as the converter method', () => {
    expectTypeOf(convertCss).returns.toEqualTypeOf<Promise<CssConversionResult>>()
    expectTypeOf(convertCss).parameter(0).toEqualTypeOf<string>()
    expectTypeOf(convertCss).parameter(1).toEqualTypeOf<ConverterOptions | undefined>()
  })
})

describe('pruneStyles', () => {
  it('is synchronous and returns declarations a StyleInput accepts', () => {
    expectTypeOf(pruneStyles).returns.toEqualTypeOf<Declaration[]>()
    expectTypeOf(pruneStyles).parameter(0).toEqualTypeOf<DeclarationsInput>()
    expectTypeOf(pruneStyles).parameter(1).toEqualTypeOf<PruneOptions>()
    expectTypeOf<Declaration[]>().toExtend<StyleInput['declarations']>()
  })
})

describe('ResolvedOptions', () => {
  it('is what a converter exposes, with every field readonly', () => {
    expectTypeOf<Converter['options']>().toEqualTypeOf<ResolvedOptions>()
    expectTypeOf<ResolvedOptions['relaxations']>().toEqualTypeOf<readonly RelaxationName[]>()
    expectTypeOf<ResolvedOptions>().toEqualTypeOf<Readonly<ResolvedOptions>>()
    expectTypeOf<ResolvedOptions['tailwind']>().toEqualTypeOf<
      Readonly<ResolvedOptions['tailwind']>
    >()
  })
})

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
