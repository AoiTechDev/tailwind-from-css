import { normalizeDeclaration } from '../css/normalize/index.ts'
import { subjectParts } from '../css/selector.ts'
import type { TailwindDesignSystem } from '../tailwind/adapter.ts'
import {
  BASE_CONTEXT,
  type Context,
  compileCandidates,
  contextKey,
  type EffectiveOptions,
  normalizeContext,
} from '../tailwind/effective.ts'
import { findVariants, type UtilityIndex } from '../tailwind/index-builder.ts'
import { candidateName, encodeValue } from './encode.ts'

/** A variant chain for a context, with `TFC301`/`TFC302` when it uses arbitrary variants. */
export interface VariantChain {
  /** Applied left to right: conditions first, then the selector. */
  readonly variants: readonly string[]
  readonly codes: readonly ('TFC301' | 'TFC302')[]
}

/** A chain, or `TFC303` when the context can't be written as a class. */
export type VariantResult = VariantChain | { readonly code: 'TFC303' }

/** A functional variant that takes an arbitrary value, read off its compiled output. */
interface VariantTemplate {
  /** The variant with placeholders, e.g. `nth-[tfcslot]`. */
  readonly variant: string
  /** Matches the context key the variant produces; its groups are the placeholders' values. */
  readonly pattern: RegExp
}

interface ProbeInfo {
  /** Context keys of the rules that carry the probe declaration. */
  readonly keys: readonly string[]
  /** Declarations the variant adds itself (`before:` → `content`), as longhands by context key. */
  readonly extras: readonly { readonly key: string; readonly property: string }[]
}

/** Variant lookup for one design system: the index, templates, and checked chains. */
export interface VariantResolver {
  readonly design: TailwindDesignSystem
  readonly index: UtilityIndex
  readonly options: EffectiveOptions
  readonly templates: readonly VariantTemplate[]
  readonly probes: Map<string, ProbeInfo | null>
  readonly chains: Map<string, VariantResult>
}

// A variant applied to an arbitrary custom property shows the variant's context and nothing else.
const PROBE_PROPERTY = '--tfc-probe'
const PROBE = `[${PROBE_PROPERTY}:0]`
const SLOT = 'tfcslot'
const SLOT_VALUE = 'tfcvalue'
const SLOTS = new RegExp(`${SLOT}|${SLOT_VALUE}`, 'g')
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g
const BASE_KEY = contextKey(BASE_CONTEXT)
const AT_RULE = /^@(media|supports|container)\s+(.*)$/s
const CONTAINER_NAME = /^([\w-]+)\s+(?=\()/
const NOT_A_CONJUNCTION = /^(?:not|only)\b|,|\bor\b/
const RANGE = /\(([a-z-]+) ([<>])= ([^()]+)\)/g
const AT_RULE_NAME_SPACE = /^(@[\w-]+) \(/
const FEATURE_COLON = /: /g
const QUOTED_IDENT_ATTRIBUTE = /^([\w-]+)="([\w-]+)"$/
const MAX_SUBSET_TERMS = 6
const CACHE_LIMIT = 4096

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Prepares variant lookup: functional variants that take an arbitrary value are compiled once
 * with placeholder values, so their output becomes a pattern (`nth-[…]` ↔ `&:nth-child(…)`).
 *
 * @example
 * const resolver = createVariantResolver(design, utilityIndex(design, source, options))
 */
export function createVariantResolver(
  design: TailwindDesignSystem,
  index: UtilityIndex,
): VariantResolver {
  const resolver: VariantResolver = {
    design,
    index,
    options: index.options,
    templates: [],
    probes: new Map(),
    chains: new Map(),
  }
  const names = [
    ...new Set(design.variants().flatMap((entry) => (entry.isArbitrary ? [entry.name] : []))),
  ].sort(compareText)
  const variants = names.flatMap((name) =>
    [SLOT, `${SLOT}:${SLOT_VALUE}`].flatMap((value) => [`${name}-[${value}]`, `${name}[${value}]`]),
  )
  const templates: VariantTemplate[] = []
  const seen = new Set<string>()
  for (const variant of variants) {
    const [key] = probe(resolver, [variant])?.keys ?? []
    if (key === undefined || !key.includes(SLOT) || seen.has(key)) continue
    seen.add(key)
    const source = key.replace(REGEX_SPECIAL, '\\$&').replace(SLOTS, '(.+)')
    templates.push({ variant, pattern: new RegExp(`^${source}$`, 's') })
  }
  return { ...resolver, templates }
}

/**
 * The variant chain that puts a class into `context` (SPEC §5.3): a variant of the index for the
 * whole context, or variants for parts of it (condition terms, selector parts, each by name, by a
 * functional variant with an arbitrary value, or as an arbitrary variant). Every chain is
 * compiled on a probe and used only if Tailwind puts the probe exactly into `context`. A variant
 * that adds declarations of its own (`before:` → `content`) is used only when the block sets
 * those longhands itself (`properties`).
 *
 * @example
 * variantChain(resolver, { selector: '&:hover', conditions: ['@media (min-width: 768px)'] })
 * // { variants: ['md', '[&:hover]'], codes: ['TFC301'] }
 */
export function variantChain(
  resolver: VariantResolver,
  context: Context,
  properties: ReadonlySet<string> = new Set(),
): VariantResult {
  const target = normalizeContext(context, resolver.options)
  const key = contextKey(target)
  if (key === BASE_KEY) return { variants: [], codes: [] }
  const cacheKey = `${key}\u0000${[...properties].sort().join(',')}`
  const cached = resolver.chains.get(cacheKey)
  if (cached !== undefined) return cached
  let result: VariantResult = { code: 'TFC303' }
  for (const variants of candidateChains(resolver, target)) {
    if (accepts(resolver, variants, key, properties)) {
      result = { variants, codes: codesOf(variants) }
      break
    }
  }
  if (resolver.chains.size >= CACHE_LIMIT) resolver.chains.clear()
  resolver.chains.set(cacheKey, result)
  return result
}

function codesOf(variants: readonly string[]): ('TFC301' | 'TFC302')[] {
  const codes: ('TFC301' | 'TFC302')[] = []
  if (variants.some((variant) => variant.startsWith('[') && !variant.startsWith('[@'))) {
    codes.push('TFC301')
  }
  if (variants.some((variant) => variant.startsWith('[@'))) codes.push('TFC302')
  return codes
}

/** A chain whose parts may be missing (`undefined`) when a part has no encodable variant. */
type Draft = readonly (string | undefined)[]

// Chains in order of preference. Cheap to list: each is only compiled when tried.
function* candidateChains(resolver: VariantResolver, target: Context): Generator<string[]> {
  for (const name of findVariants(resolver.index, target)) yield [name]
  const terms = conditionTerms(target.conditions)
  const tried = new Set<string>()
  for (const plan of selectorPlans(resolver, target.selector, terms)) {
    for (const cover of termCovers(resolver, terms, plan.absorbed)) {
      const chain = [...cover, ...plan.variants]
      if (chain.some((variant) => variant === undefined)) continue
      const complete = chain as string[]
      const id = complete.join(':')
      if (tried.has(id)) continue
      tried.add(id)
      yield complete
    }
  }
}

interface SelectorPlan {
  readonly variants: Draft
  /** Condition terms the selector's variants already produce (`hover` brings its media query). */
  readonly absorbed: ReadonlySet<number>
}

function* selectorPlans(
  resolver: VariantResolver,
  selector: string,
  terms: readonly string[],
): Generator<SelectorPlan> {
  if (selector === '&') {
    yield { variants: [], absorbed: new Set() }
    return
  }
  for (const subset of subsets(terms.length)) {
    const conditions = subset.map((term) => terms[term] as string)
    const [name] = findVariants(resolver.index, { selector, conditions })
    if (name !== undefined) yield { variants: [name], absorbed: new Set(subset) }
  }
  const parts = subjectParts(selector)
  if (parts !== undefined && parts.parts.length > 0) yield piecesPlan(resolver, parts, terms)
  for (const variant of templateVariants(resolver, { selector, conditions: [] })) {
    yield { variants: [variant], absorbed: new Set() }
  }
  yield { variants: [arbitrarySelector(selector)], absorbed: new Set() }
}

// One variant per simple selector after `&`, left to right; a part may bring condition terms
// along (`:hover` with `(hover: hover)` is `hover:`). Adjacent arbitrary parts are merged.
function piecesPlan(
  resolver: VariantResolver,
  parts: { readonly ancestor: string; readonly parts: readonly string[] },
  terms: readonly string[],
): SelectorPlan {
  const absorbed = new Set<number>()
  const variants: (string | undefined)[] = []
  if (parts.ancestor !== '') {
    const ancestor = `${parts.ancestor}&`
    const [name] = findVariants(resolver.index, { selector: ancestor, conditions: [] })
    variants.push(name ?? arbitrarySelector(ancestor))
  }
  let arbitrary = ''
  const flush = (): void => {
    if (arbitrary === '') return
    variants.push(arbitrarySelector(`&${arbitrary}`))
    arbitrary = ''
  }
  for (const part of parts.parts) {
    const selector = `&${part}`
    const free = terms.map((_, term) => term).filter((term) => !absorbed.has(term))
    let named: string | undefined
    for (const subset of subsets(free.length)) {
      const chosen = subset.map((position) => free[position] as number)
      const conditions = chosen.map((term) => terms[term] as string)
      named = findVariants(resolver.index, { selector, conditions })[0]
      if (named === undefined) continue
      for (const term of chosen) absorbed.add(term)
      break
    }
    const variant = named ?? templateVariants(resolver, { selector, conditions: [] })[0]
    if (variant === undefined) {
      arbitrary += part
      continue
    }
    flush()
    variants.push(variant)
  }
  flush()
  return { variants, absorbed }
}

// Each condition term by name, else by a functional variant, else as an arbitrary at-rule; then
// once more with every term arbitrary.
function* termCovers(
  resolver: VariantResolver,
  terms: readonly string[],
  absorbed: ReadonlySet<number>,
): Generator<Draft> {
  const free = terms.filter((_, term) => !absorbed.has(term))
  const best = free.map((term) => {
    const context = { selector: '&', conditions: [term] }
    return (
      findVariants(resolver.index, context)[0] ??
      templateVariants(resolver, context)[0] ??
      arbitraryAtRule(term)
    )
  })
  // Conditions commute; named variants read better first.
  yield [...best].sort((a, b) => Number(isArbitrary(a)) - Number(isArbitrary(b)))
  yield free.map(arbitraryAtRule)
}

const isArbitrary = (variant: string | undefined): boolean => variant?.startsWith('[') !== false

/** Subsets of `0 … count - 1`, largest first, the empty one last. */
function subsets(count: number): number[][] {
  if (count > MAX_SUBSET_TERMS) return [[...Array(count).keys()], []]
  const all: number[][] = []
  for (let mask = (1 << count) - 1; mask >= 0; mask--) {
    all.push([...Array(count).keys()].filter((bit) => (mask & (1 << bit)) !== 0))
  }
  return all.sort((a, b) => b.length - a.length)
}

/**
 * Splits normalized conditions into terms that can each be one variant: a conjunction
 * `@media (a) and (b)` becomes `@media (a)` and `@media (b)`. Negations, lists and `or` stay whole.
 */
function conditionTerms(conditions: readonly string[]): string[] {
  return conditions.flatMap((condition) => {
    const match = AT_RULE.exec(condition)
    if (match === null) return [condition]
    const [, kind, body = ''] = match
    const name = kind === 'container' ? CONTAINER_NAME.exec(body) : null
    const head = `@${kind} ${name === null ? '' : `${name[1]} `}`
    const features = topLevelAnd(name === null ? body : body.slice(name[0].length))
    if (features.length < 2 || features.some((feature) => NOT_A_CONJUNCTION.test(feature))) {
      return [condition]
    }
    return features.map((feature) => `${head}${feature}`)
  })
}

function topLevelAnd(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (depth === 0 && text.startsWith(' and ', index)) {
      parts.push(text.slice(start, index))
      start = index + ' and '.length
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim())
}

/** Functional variants whose template produces `context`, with the values filled in. */
function templateVariants(resolver: VariantResolver, context: Context): string[] {
  const key = contextKey(normalizeContext(context, resolver.options))
  const variants: string[] = []
  for (const template of resolver.templates) {
    const match = template.pattern.exec(key)
    if (match === null) continue
    const values = match.slice(1).map((value) => encodeValue(simplifyAttribute(value)))
    if (values.some((value) => value === undefined)) continue
    let next = 0
    variants.push(template.variant.replace(SLOTS, () => values[next++] as string))
  }
  return variants
}

// N50: an attribute value that is an identifier needs no quotes (`state="open"` ≡ `state=open`).
const simplifyAttribute = (value: string): string => value.replace(QUOTED_IDENT_ATTRIBUTE, '$1=$2')

function arbitrarySelector(selector: string): string | undefined {
  const encoded = encodeValue(selector.replace(/ ([>+~]) /g, '$1'))
  return encoded === undefined ? undefined : `[${encoded}]`
}

// Range syntax is written the classic way, `(width <= 767px)` as `(max-width:767px)`; both
// normalize the same (N30).
function arbitraryAtRule(term: string): string | undefined {
  const written = term
    .replace(
      RANGE,
      (_, feature: string, sign: string, value: string) =>
        `(${sign === '<' ? 'max' : 'min'}-${feature}: ${value})`,
    )
    .replace(AT_RULE_NAME_SPACE, '$1(')
    .replace(FEATURE_COLON, ':')
  const encoded = encodeValue(written)
  return encoded === undefined ? undefined : `[${encoded}]`
}

function accepts(
  resolver: VariantResolver,
  variants: readonly string[],
  key: string,
  properties: ReadonlySet<string>,
): boolean {
  const info = probe(resolver, variants)
  if (info === null || info.keys.length !== 1 || info.keys[0] !== key) return false
  return info.extras.every((extra) => extra.key === key && properties.has(extra.property))
}

/** Compiles the probe under `variants` (cached): where it lands, and what the variant adds. */
function probe(resolver: VariantResolver, variants: readonly string[]): ProbeInfo | null {
  const { design, options } = resolver
  const candidate = candidateName(PROBE, { prefix: design.prefix, important: false, variants })
  const cached = resolver.probes.get(candidate)
  if (cached !== undefined) return cached
  const [compiled] = compileCandidates(design, [candidate], options)
  let info: ProbeInfo | null = null
  if (compiled?.rules.every((rule) => rule.context !== undefined)) {
    const keys: string[] = []
    const extras: { key: string; property: string }[] = []
    for (const rule of compiled.rules) {
      const ruleKey = contextKey(rule.context as Context)
      for (const declaration of rule.declarations) {
        if (declaration.property === PROBE_PROPERTY) {
          keys.push(ruleKey)
          continue
        }
        for (const longhand of normalizeDeclaration(declaration, options)) {
          extras.push({ key: ruleKey, property: longhand.property })
        }
      }
    }
    info = { keys, extras }
  }
  if (resolver.probes.size >= CACHE_LIMIT) resolver.probes.clear()
  resolver.probes.set(candidate, info)
  return info
}
