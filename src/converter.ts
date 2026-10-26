import { toDeclarations } from './css/declarations.ts'
import { canonicalProperty, longhandsOf } from './css/normalize/shorthands.ts'
import { parseStylesheet } from './css/parse.ts'
import { type Specificity, specificity } from './css/selector.ts'
import { TfcError } from './errors.ts'
import {
  type BlockDeclaration,
  type CascadeBlock,
  type CascadeIssue,
  type CascadeResult,
  checkCascade,
  contextIntersection,
  type RedundantClass,
  redundantClasses,
  type SourceRank,
  shadowedDeclarations,
  shorthandOrderConflicts,
} from './match/cascade.ts'
import {
  type BlockRelax,
  createMatcher,
  type MatchDeclaration,
  type Matcher,
  matchDeclarations,
  matchInput,
  overriddenDeclarations,
} from './match/exact.ts'
import {
  logicalProperty,
  physicalProperty,
  type Relaxation,
  type RelaxSettings,
  relaxContext,
  relaxSettings,
} from './match/relax.ts'
import { createVariantResolver, type VariantResolver, variantChain } from './match/variants.ts'
import { verify } from './match/verify.ts'
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
import {
  currentDirectory,
  loadModule,
  loadStylesheet,
  loadStylesheetOrOwn,
} from './tailwind/loader.ts'
import type {
  ConversionResult,
  Converter,
  ConverterOptions,
  CssConversionResult,
  Declaration,
  DeclarationsInput,
  ResolvedOptions,
  RuleResult,
  SourceRef,
  StyleInput,
} from './types.ts'

/** What a converter works with: the design system, its index, and matching state. */
interface Engine {
  readonly design: TailwindDesignSystem
  readonly options: EffectiveOptions
  readonly matcher: Matcher
  readonly resolver: VariantResolver
  /** The relaxations of SPEC §4 to apply; `undefined` in `exact` mode. */
  readonly relax: RelaxSettings | undefined
}

/** Declarations of one element in one context, as given or read from a stylesheet. */
interface Entry {
  readonly selector: string
  readonly conditions: readonly string[]
  readonly declarations: DeclarationsInput
  /** Specificity of the original selector, for the cascade check (SPEC §5.8). */
  readonly specificity: Specificity
  /** Where a stylesheet declaration starts (then `declarations` holds just that one). */
  readonly position?: { readonly line: number; readonly column: number }
}

/** The input declarations of one context, merged in array order. */
interface Block {
  readonly context: Context
  readonly declarations: Declaration[]
  /** Position of each declaration in the element's source list. */
  readonly sources: number[]
  /** Relaxations that changed the context (`hover-media`, `breakpoint-nearest`). */
  readonly relaxations: readonly Relaxation[]
}

/** What the steps before the report collect for one element. */
interface Collected {
  readonly sources: SourceRef[]
  /** The source rank of each of {@link sources}: its selector's specificity and position. */
  readonly ranks: SourceRank[]
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
  return converterFor(
    resolveOptions(options, { base: currentDirectory() }),
    options?.tailwind?.base === undefined,
  )
}

/**
 * Converts every rule of a stylesheet with a converter shared by every call with equal options
 * (the same four converters {@link convertStyles} uses). Rules are grouped by the element they
 * style; at-rules and rules without such an element come back as `passthroughCss`.
 *
 * @param css - The stylesheet. Syntax errors are recovered from or reported, never thrown.
 * @param options - As for {@link createConverter}.
 * @throws {TfcError} As {@link createConverter} does, and `TFC905` when `css` isn't a string.
 * @example
 * ```ts
 * const { rules } = await convertCss('.btn { padding: 16px } .btn:hover { color: #000 }')
 * rules[0].subject          // '.btn'
 * rules[0].result.className // 'p-4 [&:hover]:text-black'
 * ```
 */
export async function convertCss(
  css: string,
  options?: ConverterOptions,
): Promise<CssConversionResult> {
  return (await sharedConverter(options)).convertCss(css)
}

/**
 * Converts the styles of one element with a converter shared by every call with equal options
 * (the four most recently used ones are kept). Use {@link createConverter} to convert many
 * elements without the `await`.
 *
 * @param input - The element's declarations, one context per entry (`selector`, `conditions`).
 * @param options - As for {@link createConverter}.
 * @throws {TfcError} As {@link createConverter} does, and `TFC905` when `input` isn't a
 * {@link StyleInput} or an array of them.
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
  const defaultBase = options?.tailwind?.base === undefined
  const key = JSON.stringify([resolved, defaultBase])
  const cached = shared.get(key)
  if (cached !== undefined) {
    shared.delete(key)
    shared.set(key, cached)
    return cached
  }
  const created = converterFor(resolved, defaultBase)
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

// SPEC §3.4: only the default base falls back to the tailwindcss this package imports.
async function converterFor(options: ResolvedOptions, defaultBase: boolean): Promise<Converter> {
  const design = await loadDesignSystem(options.tailwind.css, {
    base: options.tailwind.base,
    loadStylesheet: defaultBase ? loadStylesheetOrOwn : loadStylesheet,
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
    relax: relaxSettings(options),
  }
  return Object.freeze({
    tailwindVersion: design.version,
    options,
    convertStyles: (input: StyleInput | StyleInput[]) =>
      convert(engine, checkStyleInputs(input).map(entryOf)),
    convertCss: (css: string) => {
      if (typeof css !== 'string') throw invalidInput(`convertCss takes a string, got ${kind(css)}`)
      return convertStylesheet(engine, css)
    },
    toCss: (classes: string[]) => toCss(design, classes),
  })
}

const invalidInput = (message: string): TfcError => new TfcError('TFC905', message)

const kind = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// SPEC §3.2: JavaScript callers can pass any shape; a wrong one is TFC905, never a TypeError.
function checkStyleInputs(input: StyleInput | StyleInput[]): StyleInput[] {
  const inputs: unknown[] = Array.isArray(input) ? input : [input]
  inputs.forEach((entry, position) => {
    const at = Array.isArray(input) ? `convertStyles input[${position}]` : 'convertStyles input'
    if (!isRecord(entry))
      throw invalidInput(`${at} must be a StyleInput object, got ${kind(entry)}`)
    const { declarations, selector, conditions } = entry
    if (declarations === undefined) {
      throw invalidInput(
        `${at} has no \`declarations\`: pass { declarations: … }, not the declarations themselves`,
      )
    }
    if (
      typeof declarations !== 'string' &&
      !Array.isArray(declarations) &&
      !isRecord(declarations)
    ) {
      throw invalidInput(
        `${at}.declarations must be a string, an array or an object, got ${kind(declarations)}`,
      )
    }
    if (selector !== undefined && typeof selector !== 'string') {
      throw invalidInput(`${at}.selector must be a string, got ${kind(selector)}`)
    }
    if (
      conditions !== undefined &&
      !(Array.isArray(conditions) && conditions.every((c) => typeof c === 'string'))
    ) {
      throw invalidInput(`${at}.conditions must be an array of strings`)
    }
  })
  return inputs as StyleInput[]
}

// The element's own selector is the same in every entry, so `&` counts for nothing.
const entryOf = (style: StyleInput): Entry => ({
  selector: style.selector ?? '&',
  conditions: style.conditions ?? [],
  declarations: style.declarations,
  specificity: specificity(style.selector ?? '&'),
})

function sourceRef(declaration: Declaration, entry: Entry): SourceRef {
  const source: SourceRef = {
    property: declaration.property,
    value: declaration.value,
    important: declaration.important === true,
    selector: entry.selector,
    conditions: [...entry.conditions],
  }
  return entry.position === undefined ? source : { ...source, ...entry.position }
}

// SPEC §3.2: inputs with equal contexts are one block, declarations in array order.
function collectBlocks(engine: Engine, entries: readonly Entry[], collected: Collected): Block[] {
  const blocks = new Map<string, Block>()
  // A stylesheet gives one entry per declaration, so contexts repeat as written.
  const keys = new Map<string, string>()
  for (const entry of entries) {
    const context = { selector: entry.selector, conditions: [...entry.conditions] }
    const written = [entry.selector, ...entry.conditions].join('\u0000')
    let key = keys.get(written)
    if (key === undefined) {
      key = contextKey(normalizeContext(context, engine.options))
      keys.set(written, key)
    }
    let block = blocks.get(key)
    if (block === undefined) {
      block = { context, declarations: [], sources: [], relaxations: [] }
      blocks.set(key, block)
    }
    const { declarations, invalid } = toDeclarations(entry.declarations)
    const add = (declaration: Declaration): void => {
      collected.ranks.push({ specificity: entry.specificity, order: collected.sources.length })
      collected.sources.push(sourceRef(declaration, entry))
    }
    for (const declaration of declarations) {
      block.declarations.push(declaration)
      block.sources.push(collected.sources.length)
      add(declaration)
    }
    for (const declaration of invalid) {
      collected.unconverted.push({ source: collected.sources.length, code: 'TFC102' })
      add(declaration)
    }
  }
  return [...blocks.values()].filter((block) => block.declarations.length > 0)
}

// A longhand a relaxed class adds (`text-line-height`) was never written, so nothing reports it.
const isAdded = (declaration: MatchDeclaration): boolean =>
  declaration.relaxed !== undefined && declaration.relaxed.original === undefined

/**
 * The entry for a longhand without a class: the input declaration as written, or the longhand
 * itself when the declaration was expanded (so what's reported can be kept as CSS without
 * overriding the longhands that did get classes). A relaxed longhand reports its input.
 */
function lost<Code extends UnconvertedCode | NoteCode>(
  matched: Matched,
  position: number,
  code: Code,
): ReportEntry<Code> {
  const target = matched.declarations[position] as MatchDeclaration
  const longhand = target.relaxed?.original ?? target
  const declaration = matched.block.declarations[longhand.source] as Declaration
  const source = matched.block.sources[longhand.source] as number
  return canonicalProperty(declaration.property) === longhand.property
    ? { source, code }
    : { source, code, longhand: { property: longhand.property, value: longhand.raw } }
}

/**
 * Entries for longhands of one block that share a code: one per input declaration as written
 * when every longhand it was expanded into is concerned, else one per longhand.
 */
function lostTogether<Code extends UnconvertedCode | NoteCode>(
  matched: Matched,
  positions: readonly number[],
  code: Code,
): ReportEntry<Code>[] {
  const written = (position: number): boolean =>
    !isAdded(matched.declarations[position] as MatchDeclaration)
  const concerned = new Set(positions.filter(written))
  const whole = new Set<number>()
  for (const position of concerned) {
    const { source } = matched.declarations[position] as MatchDeclaration
    const all = matched.declarations.every(
      (declaration, other) =>
        isAdded(declaration) || declaration.source !== source || concerned.has(other),
    )
    if (all) whole.add(source)
  }
  return [...concerned]
    .sort((a, b) => a - b)
    .flatMap((position) => {
      const { source } = matched.declarations[position] as MatchDeclaration
      if (!whole.has(source)) return [lost(matched, position, code)]
      const first = matched.declarations.findIndex((declaration) => declaration.source === source)
      return first === position ? [{ source: matched.block.sources[source] as number, code }] : []
    })
}

/** Positions per block, for `lostTogether`. */
function byBlock<Item extends BlockDeclaration>(items: readonly Item[]): Map<number, Item[]> {
  const grouped = new Map<number, Item[]>()
  for (const item of items) grouped.set(item.block, [...(grouped.get(item.block) ?? []), item])
  return grouped
}

/**
 * SPEC §4: blocks whose context reads better relaxed (`hover-media`, `breakpoint-nearest`) take
 * the relaxed context, unless another block already has it (blocks keep distinct contexts).
 */
function relaxContexts(engine: Engine, inputs: readonly Matched[]): Matched[] {
  const { relax } = engine
  if (relax === undefined) return [...inputs]
  const keys = inputs.map((input) =>
    contextKey(normalizeContext(input.block.context, engine.options)),
  )
  return inputs.map((input, index) => {
    const properties = new Set(input.declarations.map((declaration) => declaration.property))
    const relaxed = relaxContext(engine.resolver, relax, input.block.context, properties)
    if (relaxed === undefined) return input
    const key = contextKey(relaxed.context)
    if (keys.some((other, at) => at !== index && other === key)) return input
    keys[index] = key
    const { context, relaxations } = relaxed
    return { ...input, block: { ...input.block, context, relaxations } }
  })
}

/**
 * What the matcher may relax in each block: the longhands of the other blocks that can apply
 * together with it (§5.8) are occupied. A physical side with a logical twin isn't, unless it is
 * in `physicalSides`: {@link mixedLogicalSides} finds the sides that must stay physical.
 */
function blockRelaxes(
  engine: Engine,
  inputs: readonly Matched[],
  physicalSides: ReadonlySet<string>,
): (BlockRelax | undefined)[] {
  const { relax, options } = engine
  if (relax === undefined) return inputs.map(() => undefined)
  const contexts = inputs.map((input) => normalizeContext(input.block.context, options))
  const longhands = inputs.map((input) =>
    input.declarations
      .flatMap((declaration) => longhandsOf(declaration.property))
      .filter((longhand) => logicalProperty(longhand) === undefined || physicalSides.has(longhand)),
  )
  return contexts.map((context, index) => ({
    settings: relax,
    occupied: new Set(
      longhands.flatMap((list, at) =>
        at === index ||
        contextIntersection(context, contexts[at] as Context, options) === 'disjoint'
          ? []
          : list,
      ),
    ),
  }))
}

interface Checked {
  readonly cascade: CascadeResult
  readonly issues: readonly { block: number; declaration: number; code: CascadeIssue['code'] }[]
}

// SPEC §5.7, then §5.8 on the classes that passed.
function check(engine: Engine, blocks: readonly CascadeBlock[]): Checked {
  const verified = verify(engine.matcher, blocks)
  const cascade = checkCascade(
    engine.matcher,
    engine.resolver,
    blocks.map((block, position) => ({ ...block, matches: verified.matches[position] ?? [] })),
  )
  return { cascade, issues: [...verified.issues, ...cascade.issues] }
}

/**
 * SPEC §4: verifies and checks the blocks without their redundant relaxed classes.
 * If a declaration that now shows a dropped class's value got an issue or a stacked class, the
 * drop isn't taken.
 */
function checkWithout(
  engine: Engine,
  blocks: readonly CascadeBlock[],
): { checked: Checked; redundant: readonly RedundantClass[] } {
  const redundant = engine.relax === undefined ? [] : redundantClasses(blocks, engine.options)
  if (redundant.length === 0) return { checked: check(engine, blocks), redundant }
  const reduced = blocks.map((block, index) => ({
    ...block,
    matches: block.matches.filter(
      (_, at) => !redundant.some((item) => item.block === index && item.match === at),
    ),
  }))
  const checked = check(engine, reduced)
  const showing = new Set(
    redundant.flatMap((item) => item.shownBy.map(({ by }) => `${by.block}:${by.declaration}`)),
  )
  const touched = [
    ...checked.issues,
    ...checked.cascade.stacked.flatMap((stacked) => stacked.sources),
  ].some((at) => showing.has(`${at.block}:${at.declaration}`))
  return touched ? { checked: check(engine, blocks), redundant: [] } : { checked, redundant }
}

/** The blocks matched under `relaxes`, with what matching reported, ready for §5.7 and §5.8. */
interface MatchedAttempt {
  readonly matchedBlocks: Matched[]
  readonly cascadeBlocks: CascadeBlock[]
  readonly unconverted: ReportEntry<UnconvertedCode>[]
  readonly notes: ReportEntry<NoteCode>[]
}

function matchBlocks(
  engine: Engine,
  inputs: readonly Matched[],
  relaxes: readonly (BlockRelax | undefined)[],
  shadowed: ReadonlyMap<number, readonly { declaration: number }[]>,
  ranksOf: (matched: Matched) => SourceRank[],
): MatchedAttempt {
  const matchedBlocks: Matched[] = []
  const cascadeBlocks: CascadeBlock[] = []
  const unconverted: ReportEntry<UnconvertedCode>[] = []
  const notes: ReportEntry<NoteCode>[] = []
  for (const [index, input] of inputs.entries()) {
    const { block } = input
    const gone = new Set((shadowed.get(index) ?? []).map((item) => item.declaration))
    notes.push(...lostTogether(input, [...gone], 'TFC106'))
    const declarations = input.declarations.filter((_, position) => !gone.has(position))
    if (declarations.length === 0) continue
    const winners = [...new Set(declarations.map((declaration) => declaration.source))].sort(
      (a, b) => a - b,
    )
    const properties = new Set(declarations.map((declaration) => declaration.property))
    const chain = variantChain(engine.resolver, block.context, properties)
    if ('code' in chain) {
      for (const winner of winners) {
        unconverted.push({ source: block.sources[winner] as number, code: chain.code })
      }
      continue
    }
    const first = block.sources[winners[0] as number] as number
    for (const code of chain.codes) notes.push({ source: first, code })
    const relax = relaxes[index]
    let result = matchDeclarations(engine.matcher, declarations, chain.variants, relax)
    let matched: Matched = { block, declarations: result.target }
    const hidden = shorthandOrderConflicts(engine.matcher, result.target, result.matches)
    if (hidden.length > 0) {
      unconverted.push(...lostTogether(matched, hidden, 'TFC402'))
      const kept = declarations.filter((_, position) => !hidden.includes(position))
      result = matchDeclarations(engine.matcher, kept, chain.variants, relax)
      matched = { block, declarations: result.target }
    }
    for (const skipped of result.skipped) {
      const entry = lost(matched, skipped.declaration, skipped.code)
      if (skipped.code === 'TFC105') notes.push({ source: entry.source, code: 'TFC105' })
      else unconverted.push({ ...entry, code: skipped.code })
    }
    matchedBlocks.push(matched)
    cascadeBlocks.push({
      context: block.context,
      variants: chain.variants,
      declarations: matched.declarations,
      ranks: ranksOf(matched),
      matches: result.matches,
    })
  }
  return { matchedBlocks, cascadeBlocks, unconverted, notes }
}

/**
 * ADR-0019: the cascade check compares longhands by name, so a physical side (`padding-top`) may
 * be set through its logical twin in one block only if no block that can apply together with it
 * keeps the side physical. Returns the sides where they mix.
 */
function mixedLogicalSides(engine: Engine, blocks: readonly CascadeBlock[]): string[] {
  if (engine.relax?.relaxations.has('logical-properties') !== true) return []
  const renamed = blocks.map(
    (block) => new Set(block.declarations.flatMap((declaration) => renamedSide(declaration) ?? [])),
  )
  if (renamed.every((sides) => sides.size === 0)) return []
  const physical = blocks.map(
    (block) =>
      new Set(
        block.declarations.flatMap((declaration) =>
          renamedSide(declaration) === undefined ? longhandsOf(declaration.property) : [],
        ),
      ),
  )
  const contexts = blocks.map((block) => normalizeContext(block.context, engine.options))
  const mixed = new Set<string>()
  renamed.forEach((sides, index) => {
    physical.forEach((others, at) => {
      if (at === index) return
      const together = contextIntersection(
        contexts[index] as Context,
        contexts[at] as Context,
        engine.options,
      )
      if (together === 'disjoint') return
      for (const side of sides) if (others.has(side)) mixed.add(side)
    })
  })
  return [...mixed].sort()
}

// The physical side a `logical-properties` class sets through its twin.
function renamedSide(declaration: MatchDeclaration): string | undefined {
  const original = declaration.relaxed?.original?.property
  return original !== undefined && physicalProperty(declaration.property) === original
    ? original
    : undefined
}

function convert(engine: Engine, entries: readonly Entry[]): ConversionResult {
  const collected: Collected = { sources: [], ranks: [], classes: [], unconverted: [], notes: [] }
  const written: Matched[] = collectBlocks(engine, entries, collected).map((block) => {
    const declarations = matchInput(block.declarations, engine.options)
    for (const overridden of overriddenDeclarations(block.declarations.length, declarations)) {
      collected.notes.push({ source: block.sources[overridden] as number, code: 'TFC106' })
    }
    return { block, declarations }
  })
  const inputs = relaxContexts(engine, written)
  const ranksOf = ({ block, declarations }: Matched): SourceRank[] =>
    declarations.map(
      (declaration) => collected.ranks[block.sources[declaration.source] as number] as SourceRank,
    )
  // SPEC §5.8: a declaration that another context always overrides never shows.
  const shadowed = byBlock(
    shadowedDeclarations(
      inputs.map((input) => ({
        context: input.block.context,
        declarations: input.declarations,
        ranks: ranksOf(input),
      })),
      engine.options,
    ),
  )
  const physicalSides = new Set<string>()
  let attempt = matchBlocks(
    engine,
    inputs,
    blockRelaxes(engine, inputs, physicalSides),
    shadowed,
    ranksOf,
  )
  for (;;) {
    // Each round marks a new side (a marked side is occupied wherever it could mix).
    const mixed = mixedLogicalSides(engine, attempt.cascadeBlocks).filter(
      (side) => !physicalSides.has(side),
    )
    if (mixed.length === 0) break
    for (const side of mixed) physicalSides.add(side)
    attempt = matchBlocks(
      engine,
      inputs,
      blockRelaxes(engine, inputs, physicalSides),
      shadowed,
      ranksOf,
    )
  }
  const { matchedBlocks, cascadeBlocks } = attempt
  collected.unconverted.push(...attempt.unconverted)
  collected.notes.push(...attempt.notes)
  const { checked, redundant } = checkWithout(engine, cascadeBlocks)
  const { cascade } = checked
  // A dropped class's declarations are reported with the class that shows their value.
  const carried = new Map<string, BlockDeclaration[]>()
  for (const item of redundant) {
    for (const { declaration, by } of item.shownBy) {
      const key = `${by.block}:${by.declaration}`
      carried.set(key, [...(carried.get(key) ?? []), { block: item.block, declaration }])
    }
  }
  for (const [index, items] of byBlock(checked.issues)) {
    const matched = matchedBlocks[index] as Matched
    const positions = (code: CascadeIssue['code']): number[] =>
      items.filter((item) => item.code === code).map((item) => item.declaration)
    for (const code of ['TFC401', 'TFC501'] as const) {
      collected.notes.push(...lostTogether(matched, positions(code), code))
    }
    for (const code of ['TFC402', 'TFC502'] as const) {
      collected.unconverted.push(...lostTogether(matched, positions(code), code))
    }
  }
  const sourceOf = (block: number, at: number): number => {
    const matched = matchedBlocks[block] as Matched
    return matched.block.sources[(matched.declarations[at] as MatchDeclaration).source] as number
  }
  const relaxationsOf = (block: number, at: number): readonly Relaxation[] => {
    const matched = matchedBlocks[block] as Matched
    const own = (matched.declarations[at] as MatchDeclaration).relaxed?.relaxations ?? []
    return [...matched.block.relaxations, ...own]
  }
  cascade.matches.forEach((matches, block) => {
    for (const match of matches) {
      const shown = match.declarations.flatMap((declaration) => [
        { block, declaration },
        ...(carried.get(`${block}:${declaration}`) ?? []),
      ])
      collected.classes.push({
        className: match.className,
        kind: match.kind,
        sources: shown.map((at) => sourceOf(at.block, at.declaration)),
        relaxations: shown.flatMap((at) => relaxationsOf(at.block, at.declaration)),
      })
    }
  })
  for (const stacked of cascade.stacked) {
    collected.classes.push({
      className: stacked.className,
      kind: stacked.kind,
      sources: stacked.sources.map((source) => sourceOf(source.block, source.declaration)),
      relaxations: stacked.sources.flatMap((source) =>
        relaxationsOf(source.block, source.declaration),
      ),
    })
  }
  return report(collected, (classes) => engine.design.classOrder(classes))
}

/**
 * SPEC §5.1 (ADR-0007): a stylesheet's rules grouped by subject in order of first appearance,
 * each subject converted as one element whose contexts come in source order and rank by their
 * original selector's specificity (§5.8).
 */
function convertStylesheet(engine: Engine, css: string): CssConversionResult {
  const parsed = parseStylesheet(css)
  const subjects = new Map<string, { selectors: Set<string>; entries: Entry[] }>()
  for (const rule of parsed.rules) {
    let subject = subjects.get(rule.subject)
    if (subject === undefined) {
      subject = { selectors: new Set(), entries: [] }
      subjects.set(rule.subject, subject)
    }
    subject.selectors.add(rule.selector)
    const ruleSpecificity = specificity(rule.selector)
    for (const { line, column, ...declaration } of rule.declarations) {
      subject.entries.push({
        selector: rule.transform,
        conditions: rule.conditions,
        declarations: [declaration],
        specificity: ruleSpecificity,
        position: { line, column },
      })
    }
  }
  const rules = [...subjects].map(
    ([subject, { selectors, entries }]): RuleResult => ({
      subject,
      selectors: [...selectors],
      result: convert(engine, entries),
    }),
  )
  return { rules, passthroughCss: parsed.passthroughCss, diagnostics: [...parsed.diagnostics] }
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
