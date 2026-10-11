import { toDeclarations } from './css/declarations.ts'
import { canonicalProperty } from './css/normalize/shorthands.ts'
import {
  createMatcher,
  type MatchDeclaration,
  type Matcher,
  matchDeclarations,
  matchInput,
  overriddenDeclarations,
} from './match/exact.ts'
import { createVariantResolver, type VariantResolver, variantChain } from './match/variants.ts'
import { type VerifyBlock, verify } from './match/verify.ts'
import { resolveOptions } from './options.ts'
import {
  type NoteCode,
  type ReportClass,
  type ReportEntry,
  report,
  type UnconvertedCode,
} from './report.ts'
import {
  type CandidateRule,
  loadDesignSystem,
  type PropertyRule,
  type TailwindDesignSystem,
} from './tailwind/adapter.ts'
import {
  type Context,
  contextKey,
  type EffectiveOptions,
  normalizeContext,
} from './tailwind/effective.ts'
import { utilityIndex } from './tailwind/index-builder.ts'
import { currentDirectory, loadModule, loadStylesheet } from './tailwind/loader.ts'
import type {
  ConversionResult,
  Converter,
  ConverterOptions,
  Declaration,
  ResolvedOptions,
  SourceRef,
  StyleInput,
} from './types.ts'

/** What a converter works with: the design system, its index, and matching state. */
interface Engine {
  readonly design: TailwindDesignSystem
  readonly options: EffectiveOptions
  readonly matcher: Matcher
  readonly resolver: VariantResolver
}

/** The input declarations of one context, merged in array order. */
interface Block {
  readonly context: Context
  readonly declarations: Declaration[]
  /** Position of each declaration in the element's source list. */
  readonly sources: number[]
}

/** What the steps before the report collect for one element. */
interface Collected {
  readonly sources: SourceRef[]
  readonly classes: ReportClass[]
  readonly unconverted: ReportEntry<UnconvertedCode>[]
  readonly notes: ReportEntry<NoteCode>[]
}

/** A block that got a variant chain, with its matched longhands. */
interface Matched {
  readonly block: Block
  readonly declarations: readonly MatchDeclaration[]
}

const SHARED_LIMIT = 4
const shared = new Map<string, Promise<Converter>>()

/**
 * Loads your Tailwind setup and builds the index of its utilities and variants (SPEC §3.1). The
 * converter it resolves to converts synchronously and can be reused for any number of elements.
 * The index is built once per Tailwind version, entry CSS, base directory and root font size in
 * a process.
 *
 * @param options - Mode, relaxations, the Tailwind entry CSS and its base directory, the root
 * font size, tolerances and the important style. Every field is optional.
 * @throws {TfcError} `TFC904` for invalid options, `TFC901` when `tailwindcss` can't be
 * imported, `TFC902` when its version isn't supported, `TFC903` when the entry CSS fails to load.
 * @example
 * ```ts
 * const converter = await createConverter({ tailwind: { css: '@import "./app.css";' } })
 * converter.convertStyles({ declarations: 'padding: 16px; color: #ef4444' }).className
 * // 'p-4 text-[#ef4444]'
 * ```
 */
export async function createConverter(options?: ConverterOptions): Promise<Converter> {
  return converterFor(resolveOptions(options, { base: currentDirectory() }))
}

/**
 * Converts the styles of one element with a converter shared by every call with equal options
 * (the four most recently used ones are kept). Use {@link createConverter} to convert many
 * elements without the `await`.
 *
 * @param input - The element's declarations, one context per entry (`selector`, `conditions`).
 * @param options - As for {@link createConverter}.
 * @throws {TfcError} As {@link createConverter} does.
 * @example
 * ```ts
 * const result = await convertStyles([
 *   { declarations: { padding: 16, color: '#fff' } },
 *   { selector: '&:hover', declarations: 'color: #000' },
 * ])
 * result.className // 'p-4 text-white [&:hover]:text-black'
 * ```
 */
export async function convertStyles(
  input: StyleInput | StyleInput[],
  options?: ConverterOptions,
): Promise<ConversionResult> {
  return (await sharedConverter(options)).convertStyles(input)
}

/** The converter for `options` from the one-shot helpers' cache (SPEC §3: LRU, size 4). */
export function sharedConverter(options?: ConverterOptions): Promise<Converter> {
  let resolved: ResolvedOptions
  try {
    resolved = resolveOptions(options, { base: currentDirectory() })
  } catch (error) {
    return Promise.reject(error)
  }
  const key = JSON.stringify(resolved)
  const cached = shared.get(key)
  if (cached !== undefined) {
    shared.delete(key)
    shared.set(key, cached)
    return cached
  }
  const created = converterFor(resolved)
  shared.set(key, created)
  created.catch(() => {
    if (shared.get(key) === created) shared.delete(key)
  })
  for (const oldest of shared.keys()) {
    if (shared.size <= SHARED_LIMIT) break
    shared.delete(oldest)
  }
  return created
}

async function converterFor(options: ResolvedOptions): Promise<Converter> {
  const design = await loadDesignSystem(options.tailwind.css, {
    base: options.tailwind.base,
    loadStylesheet,
    loadModule,
  })
  return converterFromDesign(design, options)
}

/** A converter for a design system that is already loaded. */
export function converterFromDesign(
  design: TailwindDesignSystem,
  options: ResolvedOptions,
): Converter {
  const effective: EffectiveOptions = { rootFontSize: options.rootFontSize }
  const index = utilityIndex(design, options.tailwind, effective)
  const engine: Engine = {
    design,
    options: effective,
    matcher: createMatcher(design, index, { important: options.important }),
    resolver: createVariantResolver(design, index),
  }
  return Object.freeze({
    tailwindVersion: design.version,
    options,
    convertStyles: (input: StyleInput | StyleInput[]) => convert(engine, input),
    convertCss: (): never => {
      throw new Error('convertCss is not available in this version yet.')
    },
    toCss: (classes: string[]) => toCss(design, classes),
  })
}

function sourceRef(declaration: Declaration, selector: string, conditions: string[]): SourceRef {
  return {
    property: declaration.property,
    value: declaration.value,
    important: declaration.important === true,
    selector,
    conditions: [...conditions],
  }
}

// SPEC §3.2: inputs with equal contexts are one block, declarations in array order.
function collectBlocks(
  engine: Engine,
  input: readonly StyleInput[],
  collected: Collected,
): Block[] {
  const blocks = new Map<string, Block>()
  for (const style of input) {
    const selector = style.selector ?? '&'
    const conditions = [...(style.conditions ?? [])]
    const context = { selector, conditions }
    const key = contextKey(normalizeContext(context, engine.options))
    let block = blocks.get(key)
    if (block === undefined) {
      block = { context, declarations: [], sources: [] }
      blocks.set(key, block)
    }
    const { declarations, invalid } = toDeclarations(style.declarations)
    for (const declaration of declarations) {
      block.declarations.push(declaration)
      block.sources.push(collected.sources.length)
      collected.sources.push(sourceRef(declaration, selector, conditions))
    }
    for (const declaration of invalid) {
      collected.unconverted.push({ source: collected.sources.length, code: 'TFC102' })
      collected.sources.push(sourceRef(declaration, selector, conditions))
    }
  }
  return [...blocks.values()].filter((block) => block.declarations.length > 0)
}

/**
 * The entry for a longhand without a class: the input declaration as written, or the longhand
 * itself when the declaration was expanded (so what's reported can be kept as CSS without
 * overriding the longhands that did get classes).
 */
function lost<Code extends UnconvertedCode | NoteCode>(
  matched: Matched,
  position: number,
  code: Code,
): ReportEntry<Code> {
  const longhand = matched.declarations[position] as MatchDeclaration
  const declaration = matched.block.declarations[longhand.source] as Declaration
  const source = matched.block.sources[longhand.source] as number
  return canonicalProperty(declaration.property) === longhand.property
    ? { source, code }
    : { source, code, longhand: { property: longhand.property, value: longhand.raw } }
}

function convert(engine: Engine, input: StyleInput | StyleInput[]): ConversionResult {
  const collected: Collected = { sources: [], classes: [], unconverted: [], notes: [] }
  const matchedBlocks: Matched[] = []
  const verifyBlocks: VerifyBlock[] = []
  for (const block of collectBlocks(engine, Array.isArray(input) ? input : [input], collected)) {
    const declarations = matchInput(block.declarations, engine.options)
    for (const overridden of overriddenDeclarations(block.declarations.length, declarations)) {
      collected.notes.push({ source: block.sources[overridden] as number, code: 'TFC106' })
    }
    const winners = [...new Set(declarations.map((declaration) => declaration.source))].sort(
      (a, b) => a - b,
    )
    const properties = new Set(declarations.map((declaration) => declaration.property))
    const chain = variantChain(engine.resolver, block.context, properties)
    if ('code' in chain) {
      for (const winner of winners) {
        collected.unconverted.push({ source: block.sources[winner] as number, code: chain.code })
      }
      continue
    }
    const first = block.sources[winners[0] as number] as number
    for (const code of chain.codes) collected.notes.push({ source: first, code })
    const matched: Matched = { block, declarations }
    const result = matchDeclarations(engine.matcher, declarations, chain.variants)
    for (const skipped of result.skipped) {
      const entry = lost(matched, skipped.declaration, skipped.code)
      if (skipped.code === 'TFC105') collected.notes.push({ source: entry.source, code: 'TFC105' })
      else collected.unconverted.push({ ...entry, code: skipped.code })
    }
    matchedBlocks.push(matched)
    verifyBlocks.push({
      context: block.context,
      variants: chain.variants,
      declarations,
      matches: result.matches,
    })
  }
  const verified = verify(engine.matcher, verifyBlocks)
  for (const issue of verified.issues) {
    const entry = lost(matchedBlocks[issue.block] as Matched, issue.declaration, issue.code)
    if (issue.code === 'TFC501') collected.notes.push({ source: entry.source, code: 'TFC501' })
    else collected.unconverted.push({ ...entry, code: issue.code })
  }
  verified.matches.forEach((matches, position) => {
    const { block, declarations } = matchedBlocks[position] as Matched
    for (const match of matches) {
      const sources = match.declarations.map(
        (at) => block.sources[(declarations[at] as MatchDeclaration).source] as number,
      )
      collected.classes.push({ className: match.className, kind: match.kind, sources })
    }
  })
  return report(collected, (classes) => engine.design.classOrder(classes))
}

const INDENT = '  '

function printRule(rule: CandidateRule): string {
  const body = rule.declarations.map(
    (declaration) =>
      `${declaration.property}: ${declaration.value}${declaration.important ? ' !important' : ''};`,
  )
  let lines = [`${rule.selector} {`, ...body.map((line) => INDENT + line), '}']
  for (const condition of [...rule.conditions].reverse()) {
    lines = [`${condition} {`, ...lines.map((line) => INDENT + line), '}']
  }
  return lines.join('\n')
}

function printProperty(property: PropertyRule): string {
  const descriptors = [
    property.syntax === undefined ? undefined : `syntax: ${property.syntax};`,
    property.inherits === undefined ? undefined : `inherits: ${String(property.inherits)};`,
    property.initialValue === undefined ? undefined : `initial-value: ${property.initialValue};`,
  ].flatMap((line) => (line === undefined ? [] : [INDENT + line]))
  return [`@property ${property.name} {`, ...descriptors, '}'].join('\n')
}

/** The rules of the classes in Tailwind's order, then their `@property` registrations by name. */
function toCss(design: TailwindDesignSystem, classes: readonly string[]): string {
  const names = [...new Set(classes)]
  const asts = design.toAst(names)
  const orders = design.classOrder(names)
  const compiled = names
    .map((name, position) => ({ name, ast: asts[position], order: orders[position] }))
    .flatMap((entry) =>
      entry.ast === null ||
      entry.ast === undefined ||
      entry.order === null ||
      entry.order === undefined
        ? []
        : [{ name: entry.name, ast: entry.ast, order: entry.order }],
    )
    .sort((a, b) => (a.order === b.order ? (a.name < b.name ? -1 : 1) : a.order < b.order ? -1 : 1))
  const properties = new Map<string, PropertyRule>()
  for (const { ast } of compiled) {
    for (const property of ast.properties) {
      if (!properties.has(property.name)) properties.set(property.name, property)
    }
  }
  const blocks = [
    ...compiled.flatMap(({ ast }) => ast.rules.map(printRule)),
    ...[...properties.keys()]
      .sort()
      .map((name) => printProperty(properties.get(name) as PropertyRule)),
  ]
  return blocks.length === 0 ? '' : `${blocks.join('\n\n')}\n`
}
