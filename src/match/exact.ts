import {
  cssText,
  type NormalDeclaration,
  normalizeBlock,
  normalizeValue,
  normalValuesEqual,
} from '../css/normalize/index.ts'
import { type Dimension, formatNumber, parseDimension } from '../css/normalize/lengths.ts'
import { canonicalProperty } from '../css/normalize/shorthands.ts'
import { redundantVendorDeclarations } from '../css/vendor.ts'
import type { TailwindDesignSystem } from '../tailwind/adapter.ts'
import {
  BASE_CONTEXT,
  type CompiledRule,
  compileCandidates,
  type EffectiveOptions,
  resolveEffective,
} from '../tailwind/effective.ts'
import {
  findByLonghand,
  findBySignature,
  type IndexedUtility,
  type UtilityIndex,
} from '../tailwind/index-builder.ts'
import type { ClassMapping, Declaration } from '../types.ts'
import {
  arbitraryProperty,
  arbitraryValue,
  type CandidateStyle,
  candidateName,
  encodeValue,
  variableValue,
} from './encode.ts'

/** One longhand of a block, ready for matching: its normal value plus CSS text to encode. */
export interface MatchDeclaration extends NormalDeclaration {
  /**
   * CSS that normalizes to `value` on its own, for arbitrary values: the input's own text when
   * the declaration wasn't expanded and has no `em` length, else the normal value as CSS.
   */
  readonly raw: string
  /** Position of the input declaration it comes from. */
  readonly source: number
}

/** How a class was found (SPEC §3.3 `ClassMapping.kind`). */
export type MatchKind = ClassMapping['kind']

/** One class and the declarations it sets. */
export interface Match {
  /** Ready to use: theme prefix and important marker applied. */
  readonly className: string
  readonly kind: MatchKind
  /** Positions in the matched declaration list, ascending. */
  readonly declarations: readonly number[]
}

/** A declaration that gets no class: `TFC105` (redundant vendor copy) or `TFC204` (can't encode). */
export interface SkippedDeclaration {
  /** Position in the matched declaration list. */
  readonly declaration: number
  readonly code: 'TFC105' | 'TFC204'
}

/** Classes for one block, plus the declarations left without one. */
export interface MatchResult {
  readonly matches: readonly Match[]
  /** By position. */
  readonly skipped: readonly SkippedDeclaration[]
}

/** Matching state for one design system: the index, `--spacing`, and compiled candidates. */
export interface Matcher {
  readonly design: TailwindDesignSystem
  readonly index: UtilityIndex
  /** Where the `!` of important classes goes (SPEC §3.4). */
  readonly important: 'suffix' | 'prefix'
  /** `--spacing` as a normal length, for bare spacing multiples. */
  readonly spacing: Dimension | undefined
  /** Candidate → effective declarations in the base context, `null` when unusable. */
  readonly compiled: Map<string, readonly NormalDeclaration[] | null>
}

// `em` depends on the block's font size, so an arbitrary value written with it wouldn't
// normalize alike once it stands alone in a class.
const EM_LENGTH = /\dem(?![\w-])/i
const VARIABLE = /^var\((--[^\s,()]+)\)$/
const RATIO = /^(\d+) \/ (\d+)$/
const TRANSLUCENT_COLOR = /^([a-z-]+\([^()/]*) \/ (0(?:\.\d+)?)\)$/
// Normal values keep 4 decimals, so a percentage equals a fraction within this.
const FRACTION_TOLERANCE = 5e-5
const MAX_DENOMINATOR = 12
const QUARTER_TOLERANCE = 1e-6
const COMPILED_LIMIT = 4096
// Tailwind 4.2/4.3's data types for arbitrary values (`text-[length:…]`), in its own order.
const TYPE_HINTS = [
  'color',
  'length',
  'percentage',
  'ratio',
  'number',
  'integer',
  'url',
  'position',
  'bg-size',
  'line-width',
  'image',
  'family-name',
  'generic-name',
  'absolute-size',
  'relative-size',
  'angle',
  'vector',
] as const
// SPEC §5.4 step 3 order; ties in coverage go to the earlier kind.
const KIND_RANK: Readonly<Record<MatchKind, number>> = {
  named: 0,
  bare: 1,
  variable: 2,
  'arbitrary-value': 3,
  'arbitrary-property': 4,
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const ascending = (a: number, b: number): number => a - b

/**
 * Reads one block's declarations for matching: normalized (SPEC §6), cascaded so each longhand
 * keeps its winning declaration, sorted by property.
 *
 * @example
 * matchInput([{ property: 'margin', value: '0 auto' }], { rootFontSize: 16 })
 * // margin-bottom: 0, margin-left: auto, margin-right: auto, margin-top: 0
 */
export function matchInput(
  declarations: readonly Declaration[],
  options: EffectiveOptions,
): MatchDeclaration[] {
  const winners = new Map<string, MatchDeclaration>()
  normalizeBlock(declarations, options).forEach((group, source) => {
    const declaration = declarations[source] as Declaration
    const [first] = group
    const asWritten =
      group.length === 1 &&
      first?.property === canonicalProperty(declaration.property) &&
      !EM_LENGTH.test(declaration.value)
    for (const longhand of group) {
      const earlier = winners.get(longhand.property)
      if (earlier?.important === true && !longhand.important) continue
      const raw = asWritten ? declaration.value.trim() : cssText(longhand.value)
      winners.set(longhand.property, { ...longhand, raw, source })
    }
  })
  return [...winners.values()].sort((a, b) => compareText(a.property, b.property))
}

/**
 * Prepares matching against a design system and its index.
 *
 * @example
 * const matcher = createMatcher(design, utilityIndex(design, source, options), { important: 'suffix' })
 */
export function createMatcher(
  design: TailwindDesignSystem,
  index: UtilityIndex,
  options: { readonly important: 'suffix' | 'prefix' },
): Matcher {
  const theme = design.themeValue('--spacing')
  const spacing =
    theme === undefined
      ? undefined
      : parseDimension(
          normalizeValue('width', theme, {
            rootFontSize: index.options.rootFontSize,
            emBasis: undefined,
            variables: undefined,
          }),
        )
  return {
    design,
    index,
    important: options.important,
    spacing: spacing !== undefined && spacing.value > 0 ? spacing : undefined,
    compiled: new Map(),
  }
}

/**
 * Finds classes whose effective declarations are exactly `declarations` (SPEC §5.4 steps 1–4, 6
 * and 7, no relaxations): a whole-signature hit, else a greedy cover by indexed utilities (with
 * modifiers), else per longhand a bare value, a variable, an arbitrary value, and finally an
 * arbitrary property. A class never sets a longhand the block doesn't set to the same value.
 * Important declarations get their own classes, marked with `!`.
 *
 * @example
 * matchDeclarations(matcher, matchInput([{ property: 'padding', value: '13px' }], options))
 * // { matches: [{ className: 'p-3.25', kind: 'bare', declarations: [0, 1, 2, 3] }], skipped: [] }
 */
export function matchDeclarations(
  matcher: Matcher,
  declarations: readonly MatchDeclaration[],
): MatchResult {
  const redundant = redundantVendorDeclarations(declarations, matcher.index.options)
  const skipped: SkippedDeclaration[] = [...redundant].map((declaration) => ({
    declaration,
    code: 'TFC105',
  }))
  const matches: Match[] = []
  for (const important of [false, true]) {
    const positions = declarations
      .map((_, position) => position)
      .filter(
        (position) => !redundant.has(position) && declarations[position]?.important === important,
      )
    if (positions.length === 0) continue
    const group = createGroup(matcher, declarations, positions, important)
    matchGroup(group)
    matches.push(...group.matches)
    skipped.push(...group.skipped)
  }
  skipped.sort((a, b) => a.declaration - b.declaration)
  return { matches, skipped }
}

/** Declarations of one importance, matched together. */
interface Group {
  readonly matcher: Matcher
  readonly declarations: readonly MatchDeclaration[]
  readonly important: boolean
  /** Longhand → position, for this group's declarations. */
  readonly positions: ReadonlyMap<string, number>
  readonly uncovered: Set<number>
  readonly matches: Match[]
  readonly skipped: SkippedDeclaration[]
}

/** A class that could cover some uncovered positions. `core` has no prefix or `!`. */
interface Option {
  readonly core: string
  readonly kind: MatchKind
  readonly positions: readonly number[]
}

function createGroup(
  matcher: Matcher,
  declarations: readonly MatchDeclaration[],
  positions: readonly number[],
  important: boolean,
): Group {
  return {
    matcher,
    declarations,
    important,
    positions: new Map(
      positions.map((position) => [
        (declarations[position] as MatchDeclaration).property,
        position,
      ]),
    ),
    uncovered: new Set(positions),
    matches: [],
    skipped: [],
  }
}

function matchGroup(group: Group): void {
  const { index } = group.matcher
  const wanted = [...group.uncovered].map(
    (position) => group.declarations[position] as MatchDeclaration,
  )
  for (const utility of findBySignature(index, wanted)) {
    const positions = covers(group, utility.declarations)
    if (positions?.length === group.uncovered.size) {
      accept(group, { core: unprefixed(group, utility.candidate), kind: utility.kind, positions })
      return
    }
  }
  cover(group, indexedOptions(group))
  for (const tier of [bareOptions, variableOptions, arbitraryValueOptions]) {
    if (group.uncovered.size === 0) return
    cover(
      group,
      uncoveredPositions(group).flatMap((position) => tier(group, position)),
    )
  }
  for (const position of uncoveredPositions(group)) {
    const declaration = group.declarations[position] as MatchDeclaration
    const encoded = encodeValue(declaration.raw)
    const core =
      encoded === undefined ? undefined : arbitraryProperty(declaration.property, encoded)
    const positions = core === undefined ? undefined : attempt(group, core)
    if (core !== undefined && positions?.includes(position)) {
      accept(group, { core, kind: 'arbitrary-property', positions })
    } else {
      group.uncovered.delete(position)
      group.skipped.push({ declaration: position, code: 'TFC204' })
    }
  }
}

const uncoveredPositions = (group: Group): number[] => [...group.uncovered].sort(ascending)

// SPEC §5.4 step 2: greedy by number of covered longhands, then kind, length and name. Families
// are hierarchical (`p` ⊃ `pt`), so greedy is optimal in practice.
function cover(group: Group, options: readonly Option[]): void {
  for (;;) {
    let best: Option | undefined
    for (const option of options) {
      if (!option.positions.every((position) => group.uncovered.has(position))) continue
      if (best === undefined || compareOptions(option, best) < 0) best = option
    }
    if (best === undefined) return
    accept(group, best)
  }
}

function compareOptions(a: Option, b: Option): number {
  return (
    b.positions.length - a.positions.length ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    a.core.length - b.core.length ||
    compareText(a.core, b.core)
  )
}

function accept(group: Group, option: Option): void {
  const style: CandidateStyle = {
    prefix: group.matcher.design.prefix,
    important: group.important ? group.matcher.important : false,
  }
  for (const position of option.positions) group.uncovered.delete(position)
  group.matches.push({
    className: candidateName(option.core, style),
    kind: option.kind,
    declarations: option.positions,
  })
}

/**
 * Positions `declarations` would cover: every one of them must set an uncovered longhand of the
 * group to its value, and none may be important in a normal group. `undefined` otherwise.
 */
function covers(
  group: Group,
  declarations: readonly NormalDeclaration[] | null,
): number[] | undefined {
  if (declarations === null || declarations.length === 0) return undefined
  const positions: number[] = []
  for (const declaration of declarations) {
    const position = group.positions.get(declaration.property)
    if (position === undefined || !group.uncovered.has(position)) return undefined
    if (declaration.important && !group.important) return undefined
    const wanted = group.declarations[position] as MatchDeclaration
    if (!normalValuesEqual(wanted.value, declaration.value)) return undefined
    positions.push(position)
  }
  return positions.sort(ascending)
}

const unprefixed = (group: Group, candidate: string): string => {
  const prefix = group.matcher.design.prefix
  return prefix === null ? candidate : candidate.slice(prefix.length + 1)
}

/** Compiles a candidate (cached) and returns the positions it would cover. */
function attempt(group: Group, core: string): number[] | undefined {
  const candidate = candidateName(core, { prefix: group.matcher.design.prefix, important: false })
  return covers(group, compiledDeclarations(group.matcher, candidate))
}

const isBase = (rule: CompiledRule): boolean =>
  rule.context !== undefined &&
  rule.context.selector === '&' &&
  rule.context.conditions.length === 0

// Like the index (SPEC §5.2 step 3), only candidates whose every rule applies to the element
// itself, unconditionally, can be used: anything else would add declarations to other contexts.
function compiledDeclarations(
  matcher: Matcher,
  candidate: string,
): readonly NormalDeclaration[] | null {
  const cached = matcher.compiled.get(candidate)
  if (cached !== undefined) return cached
  const options = matcher.index.options
  const [compiled] = compileCandidates(matcher.design, [candidate], options)
  const declarations =
    compiled == null || !compiled.rules.every(isBase)
      ? null
      : resolveEffective(matcher.design, [compiled], BASE_CONTEXT, options)
  if (matcher.compiled.size >= COMPILED_LIMIT) matcher.compiled.clear()
  matcher.compiled.set(candidate, declarations)
  return declarations
}

// Step 2's candidates: indexed utilities that set an uncovered longhand to its value, and
// modified forms of those that set more (`text-sm` + line-height → `text-sm/6`) or a translucent
// version of the color (`bg-black` → `bg-black/50`).
function indexedOptions(group: Group): Option[] {
  const { index } = group.matcher
  const options: Option[] = []
  const seen = new Set<string>()
  const add = (utility: IndexedUtility, tokens: (utility: IndexedUtility) => string[]): void => {
    if (seen.has(utility.candidate)) return
    seen.add(utility.candidate)
    const positions = covers(group, utility.declarations)
    if (positions !== undefined) {
      options.push({ core: unprefixed(group, utility.candidate), kind: utility.kind, positions })
    } else if (utility.modifiers.length > 0) {
      options.push(...modifierOptions(group, utility, tokens(utility)))
    }
  }
  for (const position of uncoveredPositions(group)) {
    const declaration = group.declarations[position] as MatchDeclaration
    for (const utility of findByLonghand(index, declaration)) {
      add(utility, () => modifierTokens(group, utility))
    }
    const translucent = TRANSLUCENT_COLOR.exec(declaration.value)
    if (translucent === null) continue
    const opaque = { ...declaration, value: `${translucent[1]} / 1)` }
    const alpha = formatNumber(Number(translucent[2]) * 100)
    for (const utility of findByLonghand(index, opaque)) add(utility, () => [alpha])
  }
  return options
}

// The modifiers Tailwind lists are named ones (`tight`); numbers (`6`) and arbitrary values
// (`[23px]`) are derived from the values the utility would get wrong.
function modifierTokens(group: Group, utility: IndexedUtility): string[] {
  const tokens = [...utility.modifiers]
  for (const declaration of utility.declarations) {
    const position = group.positions.get(declaration.property)
    if (position === undefined) return []
    const wanted = group.declarations[position] as MatchDeclaration
    if (normalValuesEqual(wanted.value, declaration.value)) continue
    tokens.push(...bareTokens(wanted.value, group.matcher.spacing))
    const encoded = encodeValue(wanted.raw)
    if (encoded !== undefined) tokens.push(`[${encoded}]`)
  }
  return [...new Set(tokens)]
}

function modifierOptions(
  group: Group,
  utility: IndexedUtility,
  tokens: readonly string[],
): Option[] {
  const base = unprefixed(group, utility.candidate)
  const options: Option[] = []
  for (const token of tokens) {
    const core = `${base}/${token}`
    const positions = attempt(group, core)
    if (positions === undefined) continue
    options.push({
      core,
      kind: token.startsWith('[') ? 'arbitrary-value' : utility.kind,
      positions,
    })
  }
  return options
}

const rootsOf = (group: Group, position: number): readonly string[] => {
  const declaration = group.declarations[position] as MatchDeclaration
  return (group.matcher.index.roots.get(declaration.property) ?? []).map((root) => root.name)
}

// SPEC §5.4 step 3.2: bare values derived from the value, each compiled and checked.
function bareOptions(group: Group, position: number): Option[] {
  const declaration = group.declarations[position] as MatchDeclaration
  const tokens = bareTokens(declaration.value, group.matcher.spacing)
  const options: Option[] = []
  for (const root of rootsOf(group, position)) {
    for (const token of tokens) {
      const core = `${root}-${token}`
      const positions = attempt(group, core)
      if (positions?.includes(position)) options.push({ core, kind: 'bare', positions })
    }
  }
  return options
}

// SPEC §5.4 step 3.3: `root-(--x)` for a value that is exactly `var(--x)`.
function variableOptions(group: Group, position: number): Option[] {
  const name = VARIABLE.exec((group.declarations[position] as MatchDeclaration).value)?.[1]
  if (name === undefined) return []
  return hintedOptions(group, position, 'variable', (root, hint) => variableValue(root, name, hint))
}

// SPEC §5.4 step 3.4: `root-[value]`.
function arbitraryValueOptions(group: Group, position: number): Option[] {
  const encoded = encodeValue((group.declarations[position] as MatchDeclaration).raw)
  if (encoded === undefined) return []
  return hintedOptions(group, position, 'arbitrary-value', (root, hint) =>
    arbitraryValue(root, encoded, hint),
  )
}

// A type hint is needed when Tailwind reads the value as another type than the longhand's
// (`text-(--x)` is a color, `text-(length:--x)` a font size); each hint is compiled and checked.
function hintedOptions(
  group: Group,
  position: number,
  kind: MatchKind,
  build: (root: string, hint?: string) => string,
): Option[] {
  const property = (group.declarations[position] as MatchDeclaration).property
  const options: Option[] = []
  for (const root of rootsOf(group, position)) {
    const plain = build(root)
    const positions = attempt(group, plain)
    if (positions?.includes(position)) {
      options.push({ core: plain, kind, positions })
      continue
    }
    const compiled = compiledDeclarations(
      group.matcher,
      candidateName(plain, { prefix: group.matcher.design.prefix, important: false }),
    )
    if (compiled?.some((declaration) => declaration.property === property)) continue
    for (const hint of TYPE_HINTS) {
      const core = build(root, hint)
      const hinted = attempt(group, core)
      if (hinted?.includes(position)) {
        options.push({ core, kind, positions: hinted })
        break
      }
    }
  }
  return options
}

/**
 * Bare values a functional root may accept for `value` (SPEC §5.4 step 3.2): a multiple of 0.25
 * of `--spacing`, an integer, a number as a percentage (`0.37` → `37`), a percentage, a fraction
 * with a denominator up to 12 (`33.3333%` → `1/3`), a ratio (`4 / 5` → `4/5`). Signs are dropped:
 * negative roots (`-mt`) carry them.
 */
function bareTokens(value: string, spacing: Dimension | undefined): string[] {
  const tokens: string[] = []
  const ratio = RATIO.exec(value)
  if (ratio !== null) tokens.push(`${ratio[1]}/${ratio[2]}`)
  const dimension = parseDimension(value)
  if (dimension === undefined) return tokens
  const magnitude = Math.abs(dimension.value)
  if (spacing !== undefined && dimension.unit === spacing.unit) {
    const multiple = magnitude / spacing.value
    if (Math.abs(multiple * 4 - Math.round(multiple * 4)) < QUARTER_TOLERANCE) {
      tokens.push(formatNumber(multiple))
    }
  }
  if (dimension.unit === '') {
    if (Number.isInteger(magnitude)) tokens.push(String(magnitude))
    tokens.push(formatNumber(magnitude * 100))
  } else if (dimension.unit === '%') {
    tokens.push(formatNumber(magnitude))
    const fraction = smallestFraction(magnitude)
    if (fraction !== undefined) tokens.push(fraction)
  }
  return [...new Set(tokens)]
}

function smallestFraction(percent: number): string | undefined {
  for (let denominator = 2; denominator <= MAX_DENOMINATOR; denominator++) {
    const numerator = Math.round((percent * denominator) / 100)
    if (numerator > 0 && Math.abs((numerator * 100) / denominator - percent) < FRACTION_TOLERANCE) {
      return `${numerator}/${denominator}`
    }
  }
  return undefined
}
