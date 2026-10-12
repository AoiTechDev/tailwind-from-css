import { quantizedKey, toleranceKeys } from '../css/normalize/colors.ts'
import { type NormalDeclaration, normalValuesEqual } from '../css/normalize/index.ts'
import type { TailwindDesignSystem } from './adapter.ts'
import {
  BASE_CONTEXT,
  type Context,
  compileCandidates,
  contextKey,
  type EffectiveOptions,
  normalizeContext,
  resolveEffective,
} from './effective.ts'

/** A candidate of the class list with its effective declarations in the base context. */
export interface IndexedUtility {
  readonly candidate: string
  /** `bare` when the value is a number or a fraction (`p-4`, `w-1/2`), otherwise `named`. */
  readonly kind: 'named' | 'bare'
  /** Tailwind's `getClassOrder` key. */
  readonly order: bigint
  /** Normal declarations, one per longhand, sorted by property. */
  readonly declarations: readonly NormalDeclaration[]
  /** Modifiers Tailwind lists for the candidate (`text-sm` → `6`, `tight` …). */
  readonly modifiers: readonly string[]
}

/** A functional utility root and the longhands its listed candidates set. */
export interface FunctionalRoot {
  /** Root without the prefix, e.g. `p`, `-mt`, `text`. */
  readonly name: string
  /** Sorted. */
  readonly longhands: readonly string[]
  /** Whether a listed candidate of the root takes modifiers (`text-sm/6`, `bg-black/50`). */
  readonly modifiers: boolean
}

/** The reverse index from normalized CSS to candidates and variants (SPEC §5.2). */
export interface UtilityIndex {
  readonly options: EffectiveOptions
  /** Signature (sorted `longhand:value` list, sRGB channels quantized) → candidates by preference. */
  readonly bySignature: ReadonlyMap<string, readonly IndexedUtility[]>
  /** `longhand:value` (sRGB channels quantized) → candidates that set it, by preference. */
  readonly byLonghand: ReadonlyMap<string, readonly IndexedUtility[]>
  /** Longhand → functional roots that set it, fewest longhands first. */
  readonly roots: ReadonlyMap<string, readonly FunctionalRoot[]>
  /** {@link contextKey} of a normalized context → variant names, shortest first. */
  readonly variants: ReadonlyMap<string, readonly string[]>
}

// A negative candidate, after the theme prefix if there is one (`-mt-2`, `tw:-mt-2`).
const NEGATIVE = /^(?:[^:]+:)?-/
const BARE_VALUE = /-\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/
// A variant applied to an arbitrary custom property shows the variant's context and nothing else.
const PROBE_PROPERTY = '--tfc-probe'
const PROBE = `[${PROBE_PROPERTY}:0]`
// Lookups try every quantized key a value within the sRGB tolerance can have, up to this many.
const KEY_LIMIT = 64
const MEMO_SIZE = 8
const CACHE_LIMIT = 4096
const CHUNK_SIZE = 1024

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

// SPEC §5.2: named over bare, positive over negative (`tracking-tight`, not `-tracking-wide`),
// then fewer characters, then by code unit.
function comparePreference(a: IndexedUtility, b: IndexedUtility): number {
  return (
    (a.kind === b.kind ? 0 : a.kind === 'named' ? -1 : 1) ||
    Number(NEGATIVE.test(a.candidate)) - Number(NEGATIVE.test(b.candidate)) ||
    a.candidate.length - b.candidate.length ||
    compareText(a.candidate, b.candidate)
  )
}

const isBase = (context: Context | undefined): boolean =>
  context !== undefined && context.selector === '&' && context.conditions.length === 0

const declarationKey = (declaration: NormalDeclaration): string =>
  `${declaration.property}:${quantizedKey(declaration.value)}`

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list === undefined) map.set(key, [value])
  else list.push(value)
}

function sortedBy<K, V>(map: Map<K, V[]>, compare: (a: V, b: V) => number): Map<K, V[]> {
  for (const list of map.values()) list.sort(compare)
  return map
}

/**
 * Builds the utility and variant index of a design system (SPEC §5.2). Only candidates whose
 * every rule applies to the element itself, unconditionally, are indexed by declaration.
 */
export function buildUtilityIndex(
  design: TailwindDesignSystem,
  options: EffectiveOptions,
): UtilityIndex {
  const entries = design.classList()
  const bySignature = new Map<string, IndexedUtility[]>()
  const byLonghand = new Map<string, IndexedUtility[]>()
  const utilities: IndexedUtility[] = []
  // Compiling in chunks keeps Tailwind's ASTs short-lived, which lowers peak memory.
  for (let start = 0; start < entries.length; start += CHUNK_SIZE) {
    const chunk = entries.slice(start, start + CHUNK_SIZE)
    const compiled = compileCandidates(
      design,
      chunk.map((entry) => entry.name),
      options,
    )
    compiled.forEach((candidate, index) => {
      if (candidate === null || !candidate.rules.every((rule) => isBase(rule.context))) return
      const declarations = resolveEffective(design, [candidate], BASE_CONTEXT, options)
      if (declarations.length === 0) return
      const utility: IndexedUtility = {
        candidate: candidate.candidate,
        kind: BARE_VALUE.test(candidate.candidate) ? 'bare' : 'named',
        order: candidate.order,
        declarations,
        modifiers: chunk[index]?.modifiers ?? [],
      }
      utilities.push(utility)
      const keys = declarations.map(declarationKey)
      push(bySignature, keys.join(';'), utility)
      for (const key of keys) push(byLonghand, key, utility)
    })
  }
  return {
    options,
    bySignature: sortedBy(bySignature, comparePreference),
    byLonghand: sortedBy(byLonghand, comparePreference),
    roots: buildRoots(design, utilities, options),
    variants: buildVariants(design, options),
  }
}

// Each listed candidate counts for the longest root it starts with (`grid-cols-3` → `grid-cols`,
// not `grid`). A root no listed candidate belongs to (`bg-size`, `filter`) is compiled once with a
// variable, which every type accepts; what it sets in the base context are its longhands.
function buildRoots(
  design: TailwindDesignSystem,
  utilities: readonly IndexedUtility[],
  options: EffectiveOptions,
): Map<string, FunctionalRoot[]> {
  const names = new Set(design.functionalRoots())
  const prefix = design.prefix === null ? '' : `${design.prefix}:`
  const longhandsOf = new Map<string, Set<string>>()
  const modifiers = new Set<string>()
  for (const utility of utilities) {
    const name = utility.candidate.slice(prefix.length)
    let root: string | undefined
    for (let dash = name.lastIndexOf('-'); dash > 0; dash = name.lastIndexOf('-', dash - 1)) {
      if (names.has(name.slice(0, dash))) {
        root = name.slice(0, dash)
        break
      }
    }
    if (root === undefined) continue
    let longhands = longhandsOf.get(root)
    if (longhands === undefined) {
      longhands = new Set()
      longhandsOf.set(root, longhands)
    }
    for (const declaration of utility.declarations) longhands.add(declaration.property)
    if (utility.modifiers.length > 0) modifiers.add(root)
  }
  const unlisted = [...names].filter((name) => !longhandsOf.has(name)).sort(compareText)
  const probes = compileCandidates(
    design,
    unlisted.map((name) => `${prefix}${name}-(${PROBE_PROPERTY})`),
    options,
  )
  probes.forEach((candidate, index) => {
    if (candidate === null || !candidate.rules.every((rule) => isBase(rule.context))) return
    const longhands = resolveEffective(design, [candidate], BASE_CONTEXT, options)
      .map((declaration) => declaration.property)
      .filter((property) => !property.startsWith('--'))
    if (longhands.length > 0) longhandsOf.set(unlisted[index] as string, new Set(longhands))
  })
  const roots = new Map<string, FunctionalRoot[]>()
  for (const [name, longhands] of longhandsOf) {
    const root: FunctionalRoot = {
      name,
      longhands: [...longhands].sort(compareText),
      modifiers: modifiers.has(name),
    }
    for (const longhand of root.longhands) push(roots, longhand, root)
  }
  return sortedBy(
    roots,
    (a, b) => a.longhands.length - b.longhands.length || compareText(a.name, b.name),
  )
}

// SPEC §5.2 step 5: every static variant and every listed value of a functional one is applied to
// a probe; the probe rule's normalized context is what the variant means. Variants that split the
// probe into several rules (`not-hover:`) have no single context and are left out.
function buildVariants(
  design: TailwindDesignSystem,
  options: EffectiveOptions,
): Map<string, string[]> {
  const names = new Set<string>()
  for (const variant of design.variants()) {
    if (!variant.isArbitrary) names.add(variant.name)
    for (const value of variant.values) {
      names.add(variant.hasDash ? `${variant.name}-${value}` : `${variant.name}${value}`)
    }
  }
  const prefix = design.prefix === null ? '' : `${design.prefix}:`
  const ordered = [...names].sort(compareText)
  const probes = compileCandidates(
    design,
    ordered.map((name) => `${prefix}${name}:${PROBE}`),
    options,
  )
  const variants = new Map<string, string[]>()
  probes.forEach((probe, index) => {
    const rules = (probe?.rules ?? []).filter((rule) =>
      rule.declarations.some((declaration) => declaration.property === PROBE_PROPERTY),
    )
    const [rule] = rules
    if (rules.length !== 1 || rule?.context === undefined) return
    push(variants, contextKey(rule.context), ordered[index] as string)
  })
  return sortedBy(variants, (a, b) => a.length - b.length || compareText(a, b))
}

const valueKeys = new Map<string, readonly string[]>()

function toleranceKeysOf(value: string): readonly string[] {
  let keys = valueKeys.get(value)
  if (keys === undefined) {
    keys = toleranceKeys(value, KEY_LIMIT)
    if (valueKeys.size >= CACHE_LIMIT) valueKeys.clear()
    valueKeys.set(value, keys)
  }
  return keys
}

/** Lookup keys of a declaration list: every combination of its values' tolerance keys. */
function lookupKeys(declarations: readonly NormalDeclaration[]): string[] {
  const options = declarations.map((declaration) =>
    toleranceKeysOf(declaration.value).map((key) => `${declaration.property}:${key}`),
  )
  const count = options.reduce((product, keys) => product * keys.length, 1)
  if (count > KEY_LIMIT) return [declarations.map(declarationKey).join(';')]
  let keys = ['']
  options.forEach((choices, index) => {
    const separator = index === 0 ? '' : ';'
    keys = keys.flatMap((key) => choices.map((choice) => `${key}${separator}${choice}`))
  })
  return keys
}

function collect(
  map: ReadonlyMap<string, readonly IndexedUtility[]>,
  keys: readonly string[],
  accept: (utility: IndexedUtility) => boolean,
): IndexedUtility[] {
  const found = new Set<IndexedUtility>()
  for (const key of keys) {
    for (const utility of map.get(key) ?? []) if (accept(utility)) found.add(utility)
  }
  return [...found].sort(comparePreference)
}

/**
 * Candidates whose effective declarations are exactly `declarations` (one per longhand, normal
 * values, `important` ignored), by preference. sRGB colors match within the N20 tolerance.
 */
export function findBySignature(
  index: UtilityIndex,
  declarations: readonly NormalDeclaration[],
): IndexedUtility[] {
  if (declarations.length === 0) return []
  const sorted = [...declarations].sort((a, b) => compareText(a.property, b.property))
  return collect(index.bySignature, lookupKeys(sorted), (utility) =>
    utility.declarations.every((declaration, position) => {
      const wanted = sorted[position]
      return (
        wanted !== undefined &&
        declaration.property === wanted.property &&
        normalValuesEqual(declaration.value, wanted.value)
      )
    }),
  )
}

/** Candidates that set `declaration`'s longhand to its value (among others), by preference. */
export function findByLonghand(
  index: UtilityIndex,
  declaration: NormalDeclaration,
): IndexedUtility[] {
  return collect(index.byLonghand, lookupKeys([declaration]), (utility) =>
    utility.declarations.some(
      (own) =>
        own.property === declaration.property && normalValuesEqual(own.value, declaration.value),
    ),
  )
}

/** Variant names whose context is `context` (normalized here), shortest first. */
export function findVariants(index: UtilityIndex, context: Context): readonly string[] {
  return index.variants.get(contextKey(normalizeContext(context, index.options))) ?? []
}

const memo = new Map<string, UtilityIndex>()

/**
 * The index of a design system, built once per Tailwind version, entry CSS, base directory and
 * root font size in this process (SPEC §5.2).
 *
 * @example
 * const index = utilityIndex(design, { css: '@import "tailwindcss";', base }, { rootFontSize: 16 })
 * findBySignature(index, declarations)
 */
export function utilityIndex(
  design: TailwindDesignSystem,
  source: { readonly css: string; readonly base: string },
  options: EffectiveOptions,
): UtilityIndex {
  const key = [design.version, String(options.rootFontSize), source.base, source.css].join('\0')
  const cached = memo.get(key)
  if (cached !== undefined) return cached
  const index = buildUtilityIndex(design, options)
  memo.set(key, index)
  for (const oldest of memo.keys()) {
    if (memo.size <= MEMO_SIZE) break
    memo.delete(oldest)
  }
  return index
}
