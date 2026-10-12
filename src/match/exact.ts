import {
  coveredByImportant,
  cssText,
  dropCovered,
  longhandsOf,
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
  type CompiledCandidate,
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
import {
  lineHeightRelaxation,
  logicalProperty,
  logicalRelaxation,
  nearestSpacingTokens,
  type Relaxation,
  type RelaxSettings,
  relaxedValue,
  utilitiesSetting,
  type ValueMatch,
} from './relax.ts'

/** One longhand of a block, ready for matching: its normal value plus CSS text to encode. */
export interface MatchDeclaration extends NormalDeclaration {
  /**
   * CSS that normalizes to `value` on its own, for arbitrary values: the input's own text when
   * the declaration wasn't expanded and has no `em` length, else the normal value as CSS.
   */
  readonly raw: string
  /** Position of the input declaration it comes from. */
  readonly source: number
  /**
   * Set when a relaxation (SPEC §4) made this the target instead of the input: the relaxations,
   * and the input longhand it replaces (absent for a longhand a class adds, `text-line-height`).
   */
  readonly relaxed?: {
    readonly relaxations: readonly Relaxation[]
    readonly original?: MatchDeclaration
  }
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
  /**
   * What the classes set, by position: the input, with relaxed longhands replaced and longhands
   * a relaxed class adds appended (SPEC §5.7 compares against this). The input itself when
   * nothing was relaxed.
   */
  readonly target: readonly MatchDeclaration[]
}

/** What lets the matcher relax a block's values (SPEC §4, §5.4 step 5). */
export interface BlockRelax {
  readonly settings: RelaxSettings
  /**
   * Longhands the element's other blocks set (shorthands' longhands included). A class may only
   * rename a longhand (`logical-properties`) or add one (`text-line-height`) that none of them
   * sets, since the cascade check compares longhands by name.
   */
  readonly occupied: ReadonlySet<string>
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
  /** Candidate → its rules placed relative to the element, `null` when it doesn't compile. */
  readonly candidates: Map<string, CompiledCandidate | null>
}

// `em` depends on the block's font size, so an arbitrary value written with it wouldn't
// normalize alike once it stands alone in a class.
const EM_LENGTH = /\dem(?![\w-])/i
const VARIABLE = /^var\((--[^\s,()]+)\)$/
const RATIO = /^(\d+) \/ (\d+)$/
const TRANSLUCENT_COLOR = /^([a-z-]+\([^()/]*) \/ (0(?:\.\d+)?)\)$/
const EXACT: ValueMatch = { delta: 0 }
const FONT_SIZE = 'font-size'
const LINE_HEIGHT = 'line-height'
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
      if (coveredByImportant(winners, longhand)) continue
      dropCovered(winners, longhand)
      const raw = asWritten ? declaration.value.trim() : cssText(longhand.value)
      winners.set(longhand.property, { ...longhand, raw, source })
    }
  })
  // A shorthand kept whole whose longhands are all written later never shows.
  for (const [property, winner] of winners) {
    const longhands = longhandsOf(property)
    if (
      longhands.length > 1 &&
      longhands.every((longhand) => (winners.get(longhand)?.source ?? -1) > winner.source)
    ) {
      winners.delete(property)
    }
  }
  return [...winners.values()].sort((a, b) => compareText(a.property, b.property))
}

/**
 * Input declarations that won no longhand of {@link matchInput}'s result: later declarations of
 * the same block override them completely (`TFC106`). Ascending.
 *
 * @example
 * overriddenDeclarations(2, matchInput([{ property: 'color', value: 'red' }, { property: 'color', value: 'blue' }], options))
 * // [0]
 */
export function overriddenDeclarations(
  count: number,
  input: readonly MatchDeclaration[],
): number[] {
  const winning = new Set(input.map((declaration) => declaration.source))
  return Array.from({ length: count }, (_, source) => source).filter(
    (source) => !winning.has(source),
  )
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
    candidates: new Map(),
  }
}

/**
 * Finds classes whose effective declarations are exactly `declarations` (SPEC §5.4 steps 1–4, 6
 * and 7, no relaxations): a whole-signature hit, else a greedy cover by indexed utilities (with
 * modifiers), else per longhand a bare value, a variable, an arbitrary value, and finally an
 * arbitrary property. A class never sets a longhand the block doesn't set to the same value.
 * Important declarations get their own classes, marked with `!`. Every class gets the block's
 * variant chain.
 *
 * @example
 * matchDeclarations(matcher, matchInput([{ property: 'padding', value: '13px' }], options))
 * // { matches: [{ className: 'p-3.25', kind: 'bare', declarations: [0, 1, 2, 3] }], skipped: [] }
 */
export function matchDeclarations(
  matcher: Matcher,
  declarations: readonly MatchDeclaration[],
  variants: readonly string[] = [],
  relax?: BlockRelax,
): MatchResult {
  const redundant = redundantVendorDeclarations(declarations, matcher.index.options)
  const skipped: SkippedDeclaration[] = [...redundant].map((declaration) => ({
    declaration,
    code: 'TFC105',
  }))
  const matches: Match[] = []
  const relaxed = new Map<Match, readonly RelaxedTarget[]>()
  const allowed = groupRelax(relax, declarations)
  for (const important of [false, true]) {
    const positions = declarations
      .map((_, position) => position)
      .filter(
        (position) => !redundant.has(position) && declarations[position]?.important === important,
      )
    if (positions.length === 0) continue
    const group = createGroup(matcher, declarations, positions, important, variants, allowed)
    matchGroup(group)
    matches.push(...group.matches)
    skipped.push(...group.skipped)
    for (const [match, targets] of group.relaxed) relaxed.set(match, targets)
  }
  skipped.sort((a, b) => a.declaration - b.declaration)
  return relaxed.size === 0
    ? { matches, skipped, target: declarations }
    : { skipped, ...relaxedTarget(declarations, matches, relaxed) }
}

/** A longhand a relaxed class sets instead of the block's (at `position`), or adds to it. */
interface RelaxedTarget {
  readonly position: number | undefined
  readonly declaration: NormalDeclaration
  readonly relaxations: readonly Relaxation[]
}

// SPEC §5.7: verification compares against what the relaxed classes set, so the block's target
// takes their longhands; a longhand a class adds comes last, with the source of its font size.
function relaxedTarget(
  declarations: readonly MatchDeclaration[],
  matches: readonly Match[],
  relaxed: ReadonlyMap<Match, readonly RelaxedTarget[]>,
): { matches: Match[]; target: MatchDeclaration[] } {
  const target = [...declarations]
  const updated = matches.map((match) => {
    const targets = relaxed.get(match)
    if (targets === undefined) return match
    const positions = [...match.declarations]
    for (const { position, declaration, relaxations } of targets) {
      if (position !== undefined) {
        const original = declarations[position] as MatchDeclaration
        const same = normalValuesEqual(original.value, declaration.value)
        target[position] = {
          property: declaration.property,
          value: same ? original.value : declaration.value,
          important: original.important,
          raw: same ? original.raw : cssText(declaration.value),
          source: original.source,
          relaxed: { relaxations, original },
        }
        continue
      }
      const anchor = (declarations.find(
        (other, at) => match.declarations.includes(at) && other.property === FONT_SIZE,
      ) ?? declarations[match.declarations[0] as number]) as MatchDeclaration
      target.push({
        property: declaration.property,
        value: declaration.value,
        important: anchor.important,
        raw: cssText(declaration.value),
        source: anchor.source,
        relaxed: { relaxations },
      })
      positions.push(target.length - 1)
    }
    return { ...match, declarations: positions }
  })
  return { matches: updated, target }
}

/** What a block may relax, worked out once for both importance groups. */
interface GroupRelax {
  readonly settings: RelaxSettings
  /** `logical-properties`: a physical longhand of the block → the logical twin a class may set. */
  readonly logical: ReadonlyMap<string, string>
  /** The same pairs, logical → physical. */
  readonly physical: ReadonlyMap<string, string>
  /** `text-line-height`: a class may add `line-height`. */
  readonly lineHeight: boolean
}

/** Declarations of one importance, matched together. */
interface Group {
  readonly matcher: Matcher
  readonly declarations: readonly MatchDeclaration[]
  readonly important: boolean
  readonly variants: readonly string[]
  /** Longhand → position, for this group's declarations. */
  readonly positions: ReadonlyMap<string, number>
  readonly uncovered: Set<number>
  readonly matches: Match[]
  readonly skipped: SkippedDeclaration[]
  readonly relax: GroupRelax | undefined
  readonly relaxed: Map<Match, readonly RelaxedTarget[]>
}

/** What a class covers: positions, the longhands it relaxes or adds, and its largest delta. */
interface Cover {
  readonly positions: readonly number[]
  readonly relaxed: readonly RelaxedTarget[]
  readonly delta: number
}

/** A class that could cover some uncovered positions. `core` has no prefix or `!`. */
interface Option extends Cover {
  readonly core: string
  readonly kind: MatchKind
}

const optionOf = (core: string, kind: MatchKind, cover: Cover): Option => ({
  ...cover,
  core,
  kind,
})

function groupRelax(
  relax: BlockRelax | undefined,
  declarations: readonly MatchDeclaration[],
): GroupRelax | undefined {
  if (relax === undefined) return undefined
  const { relaxations } = relax.settings
  const own = new Set(declarations.flatMap((declaration) => longhandsOf(declaration.property)))
  const logical = new Map<string, string>()
  if (relaxations.has('logical-properties')) {
    for (const { property } of declarations) {
      const twin = logicalProperty(property)
      if (twin === undefined || own.has(twin)) continue
      if (relax.occupied.has(property) || relax.occupied.has(twin)) continue
      logical.set(property, twin)
    }
  }
  return {
    settings: relax.settings,
    logical,
    physical: new Map([...logical].map(([physical, twin]) => [twin, physical])),
    lineHeight:
      relaxations.has('text-line-height') &&
      !own.has(LINE_HEIGHT) &&
      !relax.occupied.has(LINE_HEIGHT),
  }
}

function createGroup(
  matcher: Matcher,
  declarations: readonly MatchDeclaration[],
  positions: readonly number[],
  important: boolean,
  variants: readonly string[],
  relax: GroupRelax | undefined,
): Group {
  return {
    matcher,
    declarations,
    important,
    variants,
    positions: new Map(
      positions.map((position) => [
        (declarations[position] as MatchDeclaration).property,
        position,
      ]),
    ),
    uncovered: new Set(positions),
    matches: [],
    skipped: [],
    relax,
    relaxed: new Map(),
  }
}

function matchGroup(group: Group): void {
  const { index } = group.matcher
  const wanted = [...group.uncovered].map(
    (position) => group.declarations[position] as MatchDeclaration,
  )
  for (const utility of findBySignature(index, wanted)) {
    const found = covers(group, utility.declarations)
    if (found?.positions.length === group.uncovered.size) {
      accept(group, optionOf(unprefixed(group, utility.candidate), utility.kind, found))
      return
    }
  }
  cover(group, indexedOptions(group))
  // SPEC §5.4 step 5: value relaxations only for longhands that would otherwise get a variable
  // or an arbitrary value.
  for (const tier of [bareOptions, relaxedOptions, variableOptions, arbitraryValueOptions]) {
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
    const found = core === undefined ? undefined : attempt(group, core)
    if (core !== undefined && found?.positions.includes(position)) {
      accept(group, optionOf(core, 'arbitrary-property', found))
    } else {
      group.uncovered.delete(position)
      group.skipped.push({ declaration: position, code: 'TFC204' })
    }
  }
}

const uncoveredPositions = (group: Group): number[] => [...group.uncovered].sort(ascending)

// SPEC §5.4 step 2: greedy by number of covered longhands, then kind, length and name. Families
// are hierarchical (`p` ⊃ `pt`), so greedy is optimal in practice. Among equal covers the class
// with fewer relaxations wins (an exact one first), then the one with the smaller delta.
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

const relaxationCount = (option: Option): number =>
  option.relaxed.reduce((count, target) => count + target.relaxations.length, 0)

function compareOptions(a: Option, b: Option): number {
  return (
    b.positions.length - a.positions.length ||
    relaxationCount(a) - relaxationCount(b) ||
    a.delta - b.delta ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    Number(a.core.startsWith('-')) - Number(b.core.startsWith('-')) ||
    a.core.length - b.core.length ||
    compareText(a.core, b.core)
  )
}

function accept(group: Group, option: Option): void {
  const style: CandidateStyle = {
    prefix: group.matcher.design.prefix,
    important: group.important ? group.matcher.important : false,
    variants: group.variants,
  }
  for (const position of option.positions) group.uncovered.delete(position)
  const match: Match = {
    className: candidateName(option.core, style),
    kind: option.kind,
    declarations: option.positions,
  }
  group.matches.push(match)
  if (option.relaxed.length > 0) group.relaxed.set(match, option.relaxed)
}

/**
 * What `declarations` would cover: every one of them must set an uncovered longhand of the group
 * (or its allowed logical twin) to its value, and none may be important in a normal group. With
 * `values`, a value may also be a relaxed one, and `line-height` may come with a `font-size`
 * (SPEC §4). `undefined` otherwise.
 */
function covers(
  group: Group,
  declarations: readonly NormalDeclaration[] | null,
  values = false,
): Cover | undefined {
  if (declarations === null || declarations.length === 0) return undefined
  const { relax } = group
  const positions: number[] = []
  const relaxed: RelaxedTarget[] = []
  let delta = 0
  let adds = false
  for (const declaration of declarations) {
    const twin = relax?.physical.get(declaration.property)
    const position =
      group.positions.get(declaration.property) ??
      (twin === undefined ? undefined : group.positions.get(twin))
    if (position === undefined) {
      if (!values || declaration.property !== LINE_HEIGHT || relax?.lineHeight !== true) {
        return undefined
      }
      const added = { ...declaration, important: group.important }
      relaxed.push({
        position,
        declaration: added,
        relaxations: [lineHeightRelaxation(added.value)],
      })
      adds = true
      continue
    }
    if (!group.uncovered.has(position) || positions.includes(position)) return undefined
    if (declaration.important && !group.important) return undefined
    const wanted = group.declarations[position] as MatchDeclaration
    const value =
      values && relax !== undefined
        ? relaxedValue(relax.settings, wanted.property, wanted.value, declaration.value)
        : normalValuesEqual(wanted.value, declaration.value)
          ? EXACT
          : undefined
    if (value === undefined) return undefined
    const relaxations = [
      ...(twin === undefined ? [] : [logicalRelaxation(wanted.property, declaration.property)]),
      ...(value.relaxation === undefined ? [] : [value.relaxation]),
    ]
    if (relaxations.length > 0) {
      const target = { ...declaration, important: wanted.important }
      relaxed.push({ position, declaration: target, relaxations })
    }
    delta = Math.max(delta, value.delta)
    positions.push(position)
  }
  if (adds && !positions.some((at) => group.declarations[at]?.property === FONT_SIZE)) {
    return undefined
  }
  return { positions: positions.sort(ascending), relaxed, delta }
}

const unprefixed = (group: Group, candidate: string): string => {
  const prefix = group.matcher.design.prefix
  return prefix === null ? candidate : candidate.slice(prefix.length + 1)
}

/** Compiles a candidate (cached) and returns what it would cover. */
function attempt(group: Group, core: string, values = false): Cover | undefined {
  const candidate = candidateName(core, { prefix: group.matcher.design.prefix, important: false })
  return covers(group, compiledDeclarations(group.matcher, candidate), values)
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
    const found = covers(group, utility.declarations)
    if (found !== undefined) {
      options.push(optionOf(unprefixed(group, utility.candidate), utility.kind, found))
    } else if (utility.modifiers.length > 0) {
      options.push(...modifierOptions(group, utility, tokens(utility)))
    }
  }
  for (const position of uncoveredPositions(group)) {
    const declaration = group.declarations[position] as MatchDeclaration
    for (const property of propertiesOf(group, position)) {
      const wanted = { ...declaration, property }
      for (const utility of findByLonghand(index, wanted)) {
        add(utility, () => modifierTokens(group, utility))
      }
      const translucent = TRANSLUCENT_COLOR.exec(declaration.value)
      if (translucent === null) continue
      const opaque = { ...wanted, value: `${translucent[1]} / 1)` }
      const alpha = formatNumber(Number(translucent[2]) * 100)
      for (const utility of findByLonghand(index, opaque)) add(utility, () => [alpha])
    }
  }
  return options
}

/** The longhand at `position`, then its logical twin when a class may set that instead. */
function propertiesOf(group: Group, position: number): string[] {
  const { property } = group.declarations[position] as MatchDeclaration
  const twin = group.relax?.logical.get(property)
  return twin === undefined ? [property] : [property, twin]
}

// The modifiers Tailwind lists are named ones (`tight`); numbers (`6`) and arbitrary values
// (`[23px]`) are derived from the values the utility would get wrong.
function modifierTokens(group: Group, utility: IndexedUtility): string[] {
  const tokens = [...utility.modifiers]
  for (const declaration of utility.declarations) {
    const twin = group.relax?.physical.get(declaration.property)
    const position =
      group.positions.get(declaration.property) ??
      (twin === undefined ? undefined : group.positions.get(twin))
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
    const found = attempt(group, core)
    if (found === undefined) continue
    options.push(optionOf(core, token.startsWith('[') ? 'arbitrary-value' : utility.kind, found))
  }
  return options
}

const rootsOf = (group: Group, position: number): readonly string[] => [
  ...new Set(
    propertiesOf(group, position).flatMap((property) =>
      (group.matcher.index.roots.get(property) ?? []).map((root) => root.name),
    ),
  ),
]

// SPEC §5.4 step 3.2: bare values derived from the value, each compiled and checked.
function bareOptions(group: Group, position: number): Option[] {
  const declaration = group.declarations[position] as MatchDeclaration
  const tokens = bareTokens(declaration.value, group.matcher.spacing)
  const options: Option[] = []
  for (const root of rootsOf(group, position)) {
    for (const token of tokens) {
      const core = `${root}-${token}`
      const found = attempt(group, core)
      if (found?.positions.includes(position)) options.push(optionOf(core, 'bare', found))
    }
  }
  return options
}

// SPEC §4 value relaxations: indexed utilities whose value is close enough (with the opacity
// modifier for a translucent color), `text-*` sizes that bring their line-height, and spacing
// multiples of 0.5 near a length. Each is checked like any class, against relaxed values.
function relaxedOptions(group: Group, position: number): Option[] {
  const { relax, matcher } = group
  if (relax === undefined) return []
  const declaration = group.declarations[position] as MatchDeclaration
  const options: Option[] = []
  const tried = new Set<string>()
  const consider = (core: string, kind: MatchKind, found: Cover | undefined): void => {
    tried.add(core)
    if (found?.positions.includes(position)) options.push(optionOf(core, kind, found))
  }
  const translucent = TRANSLUCENT_COLOR.exec(declaration.value)
  const opaque = translucent === null ? undefined : `${translucent[1]} / 1)`
  const alpha = translucent === null ? '' : formatNumber(Number(translucent[2]) * 100)
  const near = (wanted: string, got: string): boolean =>
    relaxedValue(relax.settings, declaration.property, wanted, got) !== undefined
  for (const property of propertiesOf(group, position)) {
    for (const { utility, declaration: own } of utilitiesSetting(matcher.index, property)) {
      const core = unprefixed(group, utility.candidate)
      if (near(declaration.value, own.value)) {
        if (tried.has(core)) continue
        const found = covers(group, utility.declarations, true)
        consider(core, utility.kind, found)
        if (found !== undefined || utility.modifiers.length === 0) continue
        // `text-lg/7`: the size is near and the modifier sets the line-height the block wants.
        for (const token of modifierTokens(group, utility)) {
          const modified = `${core}/${token}`
          const kind = token.startsWith('[') ? 'arbitrary-value' : utility.kind
          if (!tried.has(modified)) consider(modified, kind, attempt(group, modified, true))
        }
      } else if (opaque !== undefined && utility.modifiers.length > 0 && near(opaque, own.value)) {
        const modified = `${core}/${alpha}`
        if (!tried.has(modified)) consider(modified, utility.kind, attempt(group, modified, true))
      }
    }
  }
  if (relax.settings.relaxations.has('length-nearest')) {
    for (const root of rootsOf(group, position)) {
      for (const token of nearestSpacingTokens(declaration.value, matcher.spacing)) {
        const core = `${root}-${token}`
        if (!tried.has(core)) consider(core, 'bare', attempt(group, core, true))
      }
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
    const found = attempt(group, plain)
    if (found?.positions.includes(position)) {
      options.push(optionOf(plain, kind, found))
      continue
    }
    const compiled = compiledDeclarations(
      group.matcher,
      candidateName(plain, { prefix: group.matcher.design.prefix, important: false }),
    )
    const sets = (own: string): boolean =>
      own === property || group.relax?.physical.get(own) === property
    if (compiled?.some((declaration) => sets(declaration.property))) continue
    for (const hint of TYPE_HINTS) {
      const core = build(root, hint)
      const hinted = attempt(group, core)
      if (hinted?.positions.includes(position)) {
        options.push(optionOf(core, kind, hinted))
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
