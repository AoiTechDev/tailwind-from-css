import { normalizeConditions } from '../css/conditions.ts'
import { type NormalDeclaration, normalizeDeclarations } from '../css/normalize/index.ts'
import {
  compareSpecificity,
  normalizeSelector,
  relativeSelector,
  type Specificity,
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
  /** Tailwind's `getClassOrder` key. */
  readonly order: bigint
  readonly rules: readonly CompiledRule[]
  readonly properties: readonly PropertyRule[]
}

/** The element itself, with no conditions. */
export const BASE_CONTEXT: Context = Object.freeze({ selector: '&', conditions: Object.freeze([]) })

/** Normal form of a context: N50 for the selector, N30–N33 for the conditions. */
export function normalizeContext(context: Context, options: EffectiveOptions): Context {
  return {
    selector: normalizeSelector(context.selector),
    conditions: normalizeConditions(context.conditions, options),
  }
}

/** A string that is equal for two normalized contexts exactly when they are equal. */
export const contextKey = (context: Context): string =>
  [context.selector, ...context.conditions].join('\n')

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

interface PlacedDeclaration {
  readonly declaration: CandidateDeclaration
  readonly specificity: Specificity
  readonly order: bigint
  readonly position: number
}

function comparePlaced(a: PlacedDeclaration, b: PlacedDeclaration): number {
  return (
    compareSpecificity(a.specificity, b.specificity) ||
    (a.order < b.order ? -1 : a.order > b.order ? 1 : 0) ||
    a.position - b.position
  )
}

// A later declaration wins unless the earlier one is important and the later one isn't.
const overrides = (later: { important: boolean }, earlier: { important: boolean }): boolean =>
  later.important || !earlier.important

/**
 * Effective declarations of compiled candidates in one normalized context (SPEC §5.6): rules
 * of the context in cascade order, `var()` resolved, `--tw-*` declarations dropped, shorthands
 * expanded and values normalized, vendor-prefixed copies of unprefixed declarations dropped.
 * Sorted by property.
 */
export function resolveEffective(
  design: Pick<TailwindDesignSystem, 'prefix' | 'themeValue'>,
  compiled: readonly CompiledCandidate[],
  context: Context,
  options: EffectiveOptions,
): NormalDeclaration[] {
  const key = contextKey(context)
  const placed: PlacedDeclaration[] = []
  const registered = new Map<string, string | undefined>()
  for (const candidate of compiled) {
    for (const rule of candidate.rules) {
      if (rule.context === undefined || contextKey(rule.context) !== key) continue
      for (const declaration of rule.declarations) {
        placed.push({
          declaration,
          specificity: rule.specificity,
          order: candidate.order,
          position: placed.length,
        })
      }
    }
    for (const registration of candidate.properties) {
      if (!registered.has(registration.name)) {
        registered.set(registration.name, registration.initialValue)
      }
    }
  }
  placed.sort(comparePlaced)

  const internal = new Map<string, CandidateDeclaration>()
  for (const { declaration } of placed) {
    if (!declaration.property.startsWith(INTERNAL)) continue
    const earlier = internal.get(declaration.property)
    if (earlier === undefined || overrides(declaration, earlier)) {
      internal.set(declaration.property, declaration)
    }
  }

  const sources: Sources = {
    prefix: design.prefix,
    themeValue: cachedThemeValue(design),
    internal,
    registered,
  }
  const resolved: Declaration[] = []
  for (const { declaration } of placed) {
    if (declaration.property.startsWith(INTERNAL)) continue
    const value = resolveValue(sources, declaration.value, [], 0)
    if (value === undefined || (value.trim() === '' && !declaration.property.startsWith('--'))) {
      continue
    }
    resolved.push({ property: declaration.property, value, important: declaration.important })
  }

  const winners = new Map<string, NormalDeclaration>()
  for (const declaration of normalizeDeclarations(resolved, options)) {
    const earlier = winners.get(declaration.property)
    if (earlier === undefined || overrides(declaration, earlier)) {
      winners.set(declaration.property, declaration)
    }
  }
  const sorted = [...winners.values()].sort((a, b) =>
    a.property < b.property ? -1 : a.property > b.property ? 1 : 0,
  )
  // Input blocks drop these too (SPEC §5.4 step 6), so `select-none`, which also sets
  // `-webkit-user-select`, still equals `user-select: none`.
  const redundant = redundantVendorDeclarations(sorted, options)
  return redundant.size === 0 ? sorted : sorted.filter((_, position) => !redundant.has(position))
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
  /** Winning `--tw-*` declarations of the set. */
  readonly internal: ReadonlyMap<string, CandidateDeclaration>
  /** `@property` initial values of the set. */
  readonly registered: ReadonlyMap<string, string | undefined>
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
  const declared = sources.internal.get(name)
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
  return name.startsWith(INTERNAL) ? sources.registered.get(name) : null
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
