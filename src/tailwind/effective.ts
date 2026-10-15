import { normalizeConditions } from '../css/conditions.ts'
import {
  coveredByImportant,
  dropCovered,
  type NormalDeclaration,
  normalizeDeclarations,
  normalValuesEqual,
} from '../css/normalize/index.ts'
import {
  compareSpecificity,
  normalizeSelector,
  relativeSelector,
  type Specificity,
  selectorRelation,
  specificity,
} from '../css/selector.ts'
import { redundantVendorDeclarations } from '../css/vendor.ts'
import type { Declaration } from '../types.ts'
import type { CandidateDeclaration, PropertyRule, TailwindDesignSystem } from './adapter.ts'

/** Where declarations apply: a selector relative to the element and at-rule conditions. */
export interface Context {
  /** Selector with `&` for the element, e.g. `&:hover`. */
  readonly selector: string
  /** At-rule preludes, outermost first, e.g. `['@media (hover: hover)']`. */
  readonly conditions: readonly string[]
}

/** Inputs of the effective-declaration step besides the candidates. */
export interface EffectiveOptions {
  /** px per rem, or `false` to keep rem apart from px (SPEC §3.4). */
  readonly rootFontSize: number | false
}

/** A compiled rule, placed relative to the element. */
export interface CompiledRule {
  /** Normalized context, or `undefined` when the selector doesn't contain the candidate's class. */
  readonly context: Context | undefined
  /** Specificity of the rule's real selector. */
  readonly specificity: Specificity
  readonly declarations: readonly CandidateDeclaration[]
}

/** A candidate with its rules placed relative to the element, and its sort key. */
export interface CompiledCandidate {
  readonly candidate: string
  /** Tailwind's `getClassOrder` key, comparable only with candidates compiled in the same call. */
  readonly order: bigint
  readonly rules: readonly CompiledRule[]
  readonly properties: readonly PropertyRule[]
}

/** The element itself, with no conditions. */
export const BASE_CONTEXT: Context = Object.freeze({ selector: '&', conditions: Object.freeze([]) })

const contexts = new Map<string, Context>()

/** Normal form of a context: N50 for the selector, N30–N33 for the conditions. */
export function normalizeContext(context: Context, options: EffectiveOptions): Context {
  const cacheKey = [options.rootFontSize, context.selector, ...context.conditions].join('\n')
  let normal = contexts.get(cacheKey)
  if (normal === undefined) {
    normal = Object.freeze({
      selector: normalizeSelector(context.selector),
      conditions: Object.freeze(normalizeConditions(context.conditions, options)),
    })
    if (contexts.size >= CACHE_LIMIT) contexts.clear()
    contexts.set(cacheKey, normal)
  }
  return normal
}

/** A string that is equal for two normalized contexts exactly when they are equal. */
export const contextKey = (context: Context): string =>
  [context.selector, ...context.conditions].join('\n')

const BASE_KEY = contextKey(BASE_CONTEXT)

const CLASS_SPECIFICITY: Specificity = [0, 1, 0]

/**
 * Compiles each candidate on its own and places its rules relative to the element: the
 * candidate's class becomes `&`, and selector and conditions are normalized. `null` for a
 * candidate that doesn't compile.
 */
export function compileCandidates(
  design: TailwindDesignSystem,
  candidates: readonly string[],
  options: EffectiveOptions,
): (CompiledCandidate | null)[] {
  const asts = design.toAst(candidates)
  const orders = design.classOrder(candidates)
  // Few distinct condition lists occur (breakpoints, `@supports` fallbacks), so each is
  // normalized once.
  const conditionsCache = new Map<string, readonly string[]>()
  const conditionsOf = (conditions: readonly string[]): readonly string[] => {
    if (conditions.length === 0) return BASE_CONTEXT.conditions
    const key = conditions.join('\n')
    let normal = conditionsCache.get(key)
    if (normal === undefined) {
      normal = normalizeConditions(conditions, options)
      conditionsCache.set(key, normal)
    }
    return normal
  }
  return candidates.map((candidate, index) => {
    const ast = asts[index]
    const order = orders[index]
    if (ast === null || ast === undefined || order === null || order === undefined) return null
    const plainClass = `.${escapeClassName(candidate)}`
    return {
      candidate,
      order,
      properties: ast.properties,
      rules: ast.rules.map((rule) => {
        // Most rules are the bare class; skip parsing those.
        if (rule.selector === plainClass) {
          return {
            context:
              rule.conditions.length === 0
                ? BASE_CONTEXT
                : { selector: '&', conditions: conditionsOf(rule.conditions) },
            specificity: CLASS_SPECIFICITY,
            declarations: rule.declarations,
          }
        }
        const selector = relativeSelector(rule.selector, candidate)
        return {
          context:
            selector === undefined
              ? undefined
              : { selector, conditions: conditionsOf(rule.conditions) },
          specificity: specificity(rule.selector),
          declarations: rule.declarations,
        }
      }),
    }
  })
}

// CSSOM `CSS.escape`, which Tailwind uses for class selectors.
function escapeClassName(value: string): string {
  let escaped = ''
  for (let index = 0; index < value.length; index++) {
    const char = value[index] as string
    const code = value.charCodeAt(index)
    const digit = code >= 0x30 && code <= 0x39
    if (code === 0) escaped += '\uFFFD'
    else if (
      code <= 0x1f ||
      code === 0x7f ||
      (index === 0 && digit) ||
      (index === 1 && digit && value.charCodeAt(0) === 0x2d)
    ) {
      escaped += `\\${code.toString(16)} `
    } else if (index === 0 && value.length === 1 && code === 0x2d) escaped += `\\${char}`
    else if (
      code >= 0x80 ||
      code === 0x2d ||
      code === 0x5f ||
      digit ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      escaped += char
    } else escaped += `\\${char}`
  }
  return escaped
}

/** What resolving declarations needs from the design system. */
type ResolveDesign = Pick<TailwindDesignSystem, 'prefix' | 'themeValue' | 'classOrder'>

/** A rule of the compiled set, with what the cascade needs. */
interface PlacedRule {
  readonly context: Context
  readonly key: string
  readonly specificity: Specificity
  readonly order: bigint
  readonly declarations: readonly CandidateDeclaration[]
}

interface PlacedDeclaration {
  readonly declaration: CandidateDeclaration
  readonly rule: PlacedRule
  readonly position: number
}

function comparePlaced(a: PlacedDeclaration, b: PlacedDeclaration): number {
  return (
    compareSpecificity(a.rule.specificity, b.rule.specificity) ||
    (a.rule.order < b.rule.order ? -1 : a.rule.order > b.rule.order ? 1 : 0) ||
    a.position - b.position
  )
}

// A later declaration wins unless the earlier one is important and the later one isn't.
const overrides = (later: { important: boolean }, earlier: { important: boolean }): boolean =>
  later.important || !earlier.important

/** Declarations of `rules` in cascade order (rules are in candidate, then source order). */
function place(rules: readonly PlacedRule[]): PlacedDeclaration[] {
  const placed: PlacedDeclaration[] = []
  for (const rule of rules) {
    for (const declaration of rule.declarations) {
      placed.push({ declaration, rule, position: placed.length })
    }
  }
  return placed.sort(comparePlaced)
}

/** Everything one `resolveEffective` call shares. */
interface Resolution {
  readonly design: ResolveDesign
  readonly options: EffectiveOptions
  readonly rules: readonly PlacedRule[]
  readonly registrations: ReadonlyMap<string, PropertyRule>
  readonly sources: Map<string, Sources>
}

const rankCache = new WeakMap<readonly CompiledCandidate[], ReadonlyMap<string, bigint>>()

// `getClassOrder` numbers the candidates of one call, so keys of candidates compiled in
// different calls (one cached from an earlier conversion) don't compare: the candidates that
// cascade together are ranked again in one call.
function ranksOf(
  design: Pick<TailwindDesignSystem, 'classOrder'>,
  compiled: readonly CompiledCandidate[],
): ReadonlyMap<string, bigint> | undefined {
  if (compiled.length < 2) return undefined
  let ranks = rankCache.get(compiled)
  if (ranks === undefined) {
    const names = [...new Set(compiled.map((candidate) => candidate.candidate))]
    const orders = design.classOrder(names)
    ranks = new Map(names.map((name, index) => [name, orders[index] ?? 0n]))
    rankCache.set(compiled, ranks)
  }
  return ranks
}

function resolutionOf(
  design: ResolveDesign,
  compiled: readonly CompiledCandidate[],
  options: EffectiveOptions,
): Resolution {
  const rules: PlacedRule[] = []
  const registrations = new Map<string, PropertyRule>()
  const ranks = ranksOf(design, compiled)
  for (const candidate of compiled) {
    for (const rule of candidate.rules) {
      if (rule.context === undefined) continue
      rules.push({
        context: rule.context,
        key: contextKey(rule.context),
        specificity: rule.specificity,
        order: ranks?.get(candidate.candidate) ?? candidate.order,
        declarations: rule.declarations,
      })
    }
    for (const registration of candidate.properties) {
      if (!registrations.has(registration.name)) registrations.set(registration.name, registration)
    }
  }
  return { design, options, rules, registrations, sources: new Map() }
}

function sortedWinners(
  winners: ReadonlyMap<string, NormalDeclaration>,
  options: EffectiveOptions,
): NormalDeclaration[] {
  const sorted = [...winners.values()].sort((a, b) =>
    a.property < b.property ? -1 : a.property > b.property ? 1 : 0,
  )
  // Input blocks drop these too (SPEC §5.4 step 6), so `select-none`, which also sets
  // `-webkit-user-select`, still equals `user-select: none`.
  const redundant = redundantVendorDeclarations(sorted, options)
  return redundant.size === 0 ? sorted : sorted.filter((_, position) => !redundant.has(position))
}

/**
 * Effective declarations of compiled candidates in one normalized context (SPEC §5.6): rules
 * of the context in cascade order, `var()` resolved, `--tw-*` declarations dropped, shorthands
 * expanded and values normalized, vendor-prefixed copies of unprefixed declarations dropped.
 * Variables come from every rule that applies whenever the context does, and a declaration of a
 * broader context that the context's variables change counts as the context's own (ADR-0013).
 * Sorted by property.
 */
export function resolveEffective(
  design: ResolveDesign,
  compiled: readonly CompiledCandidate[],
  context: Context,
  options: EffectiveOptions,
): NormalDeclaration[] {
  const resolution = resolutionOf(design, compiled, options)
  const key = contextKey(context)
  const sources = sourcesFor(resolution, context, key)
  const winners = declarationsOf(
    place(resolution.rules.filter((rule) => rule.key === key)),
    () => sources,
    options,
  )
  if (key !== BASE_KEY) addChangedBroader(resolution, context, key, sources, winners)
  return sortedWinners(winners, options)
}

/**
 * What the element shows where a normalized context applies (SPEC §5.8): the declarations of
 * every rule that applies whenever the context does, its own and broader ones (`&` and
 * `@media (width >= 768px)` for `&:hover` within that query), cascaded together the way the
 * browser does, with `var()` resolved as in {@link resolveEffective}. Sorted by property.
 */
export function resolveApplied(
  design: ResolveDesign,
  compiled: readonly CompiledCandidate[],
  context: Context,
  options: EffectiveOptions,
): NormalDeclaration[] {
  const resolution = resolutionOf(design, compiled, options)
  const key = contextKey(context)
  const sources = sourcesFor(resolution, context, key)
  const applying = resolution.rules.filter(
    (rule) => rule.key === key || appliesWithin(rule.context, context, options),
  )
  return sortedWinners(
    declarationsOf(place(applying), () => sources, options),
    options,
  )
}

/** Resolves, normalizes and cascades declarations; `--tw-*` ones only feed variables. */
function declarationsOf(
  placed: readonly PlacedDeclaration[],
  sourcesOf: (rule: PlacedRule) => Sources,
  options: EffectiveOptions,
): Map<string, NormalDeclaration> {
  const resolved: Declaration[] = []
  for (const { declaration, rule } of placed) {
    if (declaration.property.startsWith(INTERNAL)) continue
    const value = resolveValue(sourcesOf(rule), declaration.value, [], 0)
    if (value === undefined || (value.trim() === '' && !declaration.property.startsWith('--'))) {
      continue
    }
    resolved.push({ property: declaration.property, value, important: declaration.important })
  }
  const winners = new Map<string, NormalDeclaration>()
  for (const declaration of normalizeDeclarations(resolved, options)) {
    const earlier = winners.get(declaration.property)
    if (
      (earlier === undefined || overrides(declaration, earlier)) &&
      !coveredByImportant(winners, declaration)
    ) {
      dropCovered(winners, declaration)
      winners.set(declaration.property, declaration)
    }
  }
  return winners
}

/**
 * Whether a rule of the normalized context `outer` applies wherever `inner` does (ADR-0013): its
 * conditions add nothing to `inner`'s (N33) and its selector matches the same subject (`&` and
 * `&:hover` within `&:hover:focus`).
 *
 * @example
 * appliesWithin(BASE_CONTEXT, { selector: '&:hover', conditions: [] }, options) // true
 */
export function appliesWithin(outer: Context, inner: Context, options: EffectiveOptions): boolean {
  return relation(outer, inner) === 'same' && implied(outer.conditions, inner, options)
}

function implied(
  conditions: readonly string[],
  context: Context,
  options: EffectiveOptions,
): boolean {
  if (conditions.length === 0) return true
  const wanted = context.conditions.join('\n')
  const cacheKey = `${wanted}\u0000${conditions.join('\n')}`
  let result = impliedCache.get(cacheKey)
  if (result === undefined) {
    const merged = normalizeConditions([...context.conditions, ...conditions], options)
    result = merged.join('\n') === wanted
    if (impliedCache.size >= CACHE_LIMIT) impliedCache.clear()
    impliedCache.set(cacheKey, result)
  }
  return result
}

const impliedCache = new Map<string, boolean>()
const CACHE_LIMIT = 4096

const relationCache = new Map<string, 'same' | 'element' | undefined>()

function relation(rule: Context, context: Context): 'same' | 'element' | undefined {
  const cacheKey = `${rule.selector}\u0000${context.selector}`
  if (relationCache.has(cacheKey)) return relationCache.get(cacheKey)
  const result = selectorRelation(rule.selector, context.selector)
  if (relationCache.size >= CACHE_LIMIT) relationCache.clear()
  relationCache.set(cacheKey, result)
  return result
}

/** Where `var()` values come from in a context, memoized per call. */
function sourcesFor(resolution: Resolution, context: Context, key: string): Sources {
  const cached = resolution.sources.get(key)
  if (cached !== undefined) return cached
  const own: PlacedRule[] = []
  const element: PlacedRule[] = []
  for (const rule of resolution.rules) {
    const kind = rule.key === key ? 'same' : relation(rule.context, context)
    if (kind === undefined || !implied(rule.context.conditions, context, resolution.options)) {
      continue
    }
    if (kind === 'same') own.push(rule)
    else element.push(rule)
  }
  // A pseudo-element inherits only variables that inherit: unregistered, or `inherits: true`.
  const inheritable = (name: string): boolean =>
    resolution.registrations.get(name)?.inherits !== false
  const sources: Sources = {
    prefix: resolution.design.prefix,
    themeValue: cachedThemeValue(resolution.design),
    internal: internalWinners(place(own), () => true),
    inherited: internalWinners(place(element), inheritable),
    registered: resolution.registrations,
  }
  resolution.sources.set(key, sources)
  return sources
}

function internalWinners(
  placed: readonly PlacedDeclaration[],
  accept: (name: string) => boolean,
): Map<string, CandidateDeclaration> {
  const internal = new Map<string, CandidateDeclaration>()
  for (const { declaration } of placed) {
    if (!declaration.property.startsWith(INTERNAL) || !accept(declaration.property)) continue
    const earlier = internal.get(declaration.property)
    if (earlier === undefined || overrides(declaration, earlier)) {
      internal.set(declaration.property, declaration)
    }
  }
  return internal
}

// ADR-0013: declarations of broader contexts that the context doesn't redeclare, but whose
// value its variables change (`hover:` setting `--tw-ring-shadow` under a base `box-shadow`).
function addChangedBroader(
  resolution: Resolution,
  context: Context,
  key: string,
  sources: Sources,
  winners: Map<string, NormalDeclaration>,
): void {
  const broader = resolution.rules.filter(
    (rule) => rule.key !== key && appliesWithin(rule.context, context, resolution.options),
  )
  if (broader.length === 0) return
  const placed = place(broader)
  const here = declarationsOf(placed, () => sources, resolution.options)
  const there = declarationsOf(
    placed,
    (rule) => sourcesFor(resolution, rule.context, rule.key),
    resolution.options,
  )
  for (const [property, declaration] of here) {
    const reference = there.get(property)
    if (winners.has(property)) continue
    if (reference !== undefined && normalValuesEqual(reference.value, declaration.value)) continue
    winners.set(property, declaration)
  }
}

/**
 * Effective declarations of a candidate set in one context (SPEC §5.6). Candidates that don't
 * compile contribute nothing.
 *
 * @example
 * effectiveDeclarations(design, ['border'], BASE_CONTEXT, { rootFontSize: 16 })
 * // border-*-style: solid, border-*-width: 1px
 */
export function effectiveDeclarations(
  design: TailwindDesignSystem,
  candidates: readonly string[],
  context: Context,
  options: EffectiveOptions,
): NormalDeclaration[] {
  const unique = [...new Set(candidates)]
  const compiled = compileCandidates(design, unique, options).filter(
    (candidate): candidate is CompiledCandidate => candidate !== null,
  )
  return resolveEffective(design, compiled, normalizeContext(context, options), options)
}

const INTERNAL = '--tw-'
const MAX_DEPTH = 32
const NAME = /^\s*(--[\w-]+)\s*(?:,|$)/
const IDENT_CHAR = /[\w-]/

/** Where `var()` values come from while resolving one effective set. */
interface Sources {
  readonly prefix: string | null
  readonly themeValue: (name: string) => string | undefined
  /** Winning `--tw-*` declarations of the rules that apply whenever the context does. */
  readonly internal: ReadonlyMap<string, CandidateDeclaration>
  /** Inheritable `--tw-*` values of the element, for a pseudo-element context. */
  readonly inherited: ReadonlyMap<string, CandidateDeclaration>
  /** `@property` registrations of the set. */
  readonly registered: ReadonlyMap<string, PropertyRule>
}

const themeCache = new WeakMap<object, Map<string, string | undefined>>()

function cachedThemeValue(
  design: Pick<TailwindDesignSystem, 'themeValue'>,
): (name: string) => string | undefined {
  let cache = themeCache.get(design)
  if (cache === undefined) {
    cache = new Map()
    themeCache.set(design, cache)
  }
  const values = cache
  return (name) => {
    if (!values.has(name)) values.set(name, design.themeValue(name))
    return values.get(name)
  }
}

/**
 * Substitutes `var()` like the browser would on the element. `undefined` when the value is
 * guaranteed-invalid. `active` holds the variables being substituted, to detect cycles.
 */
function resolveValue(
  sources: Sources,
  value: string,
  active: string[],
  depth: number,
): string | undefined {
  if (depth > MAX_DEPTH) return undefined
  if (!value.includes('var(') && !value.includes('--theme(')) return value
  let output = ''
  let index = 0
  for (let start = nextReference(value, 0); start !== -1; start = nextReference(value, index)) {
    const open = value.indexOf('(', start)
    const close = matchingParen(value, open)
    if (close === -1) break
    const inner = value.slice(open + 1, close)
    const name = NAME.exec(inner)?.[1]
    output += value.slice(index, start)
    index = close + 1
    if (name === undefined) {
      output += value.slice(start, index)
      continue
    }
    const comma = inner.indexOf(',')
    const fallback = comma === -1 ? undefined : inner.slice(comma + 1)
    const substituted = lookup(sources, name, fallback, active, depth)
    if (substituted === undefined) return undefined
    output += substituted ?? `var(${inner})`
  }
  return output + value.slice(index)
}

/** The substitution for `var(name, fallback)`: `null` keeps it as written, `undefined` is invalid. */
function lookup(
  sources: Sources,
  name: string,
  fallback: string | undefined,
  active: string[],
  depth: number,
): string | null | undefined {
  if (active.includes(name)) return undefined
  const value = variableValue(sources, name)
  if (value === null) return null
  if (value !== undefined) {
    active.push(name)
    const resolved = resolveValue(sources, value, active, depth + 1)
    active.pop()
    // A variable whose own value is invalid (a cycle, an unset reference) is guaranteed-invalid,
    // so the fallback applies.
    if (resolved !== undefined) return resolved
  }
  return fallback === undefined ? undefined : resolveValue(sources, fallback, active, depth + 1)
}

// SPEC §5.6: a `--tw-*` value the set declares wins; then the theme (under `prefix(tw)` theme
// variables are `--tw-color-…`, colliding with Tailwind's own `--tw-*`, so the theme is asked
// with the prefix stripped before a variable counts as internal); then the `@property` initial
// value. Other variables belong to the user and stay as written (`null`).
function variableValue(sources: Sources, name: string): string | null | undefined {
  const declared = sources.internal.get(name) ?? sources.inherited.get(name)
  if (declared !== undefined) return declared.value
  const prefix = sources.prefix
  const themeName =
    prefix === null
      ? name
      : name.startsWith(`--${prefix}-`)
        ? `--${name.slice(prefix.length + 3)}`
        : undefined
  const theme = themeName === undefined ? undefined : sources.themeValue(themeName)
  if (theme !== undefined) return theme
  return name.startsWith(INTERNAL) ? sources.registered.get(name)?.initialValue : null
}

/**
 * Index of the next `var(` outside strings, or -1. Theme values may use `--theme(--x, …)`,
 * which reads like `var()`.
 */
function nextReference(value: string, from: number): number {
  let quote: string | null = null
  for (let index = from; index < value.length; index++) {
    const char = value[index] as string
    if (char === '\\') index++
    else if (quote !== null) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") quote = char
    else if (
      (value.startsWith('var(', index) || value.startsWith('--theme(', index)) &&
      (index === 0 || !IDENT_CHAR.test(value[index - 1] as string))
    ) {
      return index
    }
  }
  return -1
}

/** Index of the `)` closing the `(` at `open`, skipping strings, or -1. */
function matchingParen(value: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let index = open; index < value.length; index++) {
    const char = value[index]
    if (char === '\\') index++
    else if (quote !== null) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") quote = char
    else if (char === '(') depth++
    else if (char === ')' && --depth === 0) return index
  }
  return -1
}
