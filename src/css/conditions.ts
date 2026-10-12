import { formatDimension, parseDimension, toPx } from './normalize/lengths.ts'
import { splitTopLevel } from './normalize/split.ts'

/** Inputs of condition normalization. */
export interface ConditionOptions {
  /** px per rem for container queries; media queries always use 16 (N31). */
  readonly rootFontSize: number | false
}

type QueryKind = 'media' | 'container'

/** One at-rule condition, ready to merge with others of its group (N33). */
interface Entry {
  /** Entries with the same group merge into one `and` list. */
  readonly group: string
  /** Media type; entries merge only when at most one distinct type is involved. */
  readonly type: string | undefined
  readonly terms: readonly string[]
  readonly mergeable: boolean
  readonly print: (terms: readonly string[], type: string | undefined) => string
}

const COMMENT = /\/\*[\s\S]*?\*\//g
const WHITESPACE = /\s+/g
const AT_RULE = /^@([\w-]+)\s*([\s\S]*)$/
const RANGE = /^(.+?)\s*(<=|>=|<|>|=)\s*(.+?)(?:\s*(<=|>=|<|>)\s*(.+))?$/
const MIN_MAX = /^(min|max)-(.+)$/
const SUPPORTS_DECLARATION = /^\(\s*([\w-]+)\s*:\s*([\s\S]*?)\s*\)$/
const LOGICAL = /^(?:and|or|not|only)$/
const UNREADABLE = /["'\\[\]{};]|^\s*,|,\s*(?:,|$)/

const RANGE_FEATURES: ReadonlySet<string> = new Set([
  'width',
  'height',
  'inline-size',
  'block-size',
  'aspect-ratio',
  'resolution',
  'color',
  'color-index',
  'monochrome',
  'device-width',
  'device-height',
  'device-aspect-ratio',
])

const FLIPPED: Readonly<Record<string, string>> = {
  '<': '>',
  '>': '<',
  '<=': '>=',
  '>=': '<=',
  '=': '=',
}

// Media query lengths resolve against the initial font size, not the root element's (N31).
const MEDIA_FONT_SIZE = 16

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort(byCodePoint)

const collapse = (text: string): string =>
  text.replace(COMMENT, ' ').replace(WHITESPACE, ' ').trim()

/** Splits a condition into top-level words and parenthesized groups (`(…)`, `fn(…)`). */
function conditionTokens(text: string): string[] {
  const tokens: string[] = []
  let index = 0
  while (index < text.length) {
    if (text[index] === ' ') {
      index++
      continue
    }
    const start = index
    let depth = 0
    while (index < text.length && (depth > 0 || text[index] !== ' ')) {
      if (text[index] === '(') depth++
      else if (text[index] === ')') depth--
      index++
      if (depth === 0 && text[index - 1] === ')') break
    }
    tokens.push(text.slice(start, index))
  }
  return tokens
}

function normalizeFeatureValue(value: string, kind: QueryKind, rootFontSize: number | false) {
  const basis =
    kind === 'media'
      ? { rootFontSize: MEDIA_FONT_SIZE, emBasis: MEDIA_FONT_SIZE }
      : { rootFontSize, emBasis: undefined }
  return value
    .split('/')
    .map((part) => {
      const dimension = parseDimension(part.trim())
      if (dimension === undefined) return part.trim()
      const converted = toPx(dimension, basis)
      return converted.value === 0 && converted.unit === 'px' ? '0' : formatDimension(converted)
    })
    .join(' / ')
}

// N30: `min-X: v` is `X >= v` and `max-X: v` is `X <= v` (not `<`). Ranges read name first, and
// a two-sided range is two terms.
function normalizeFeature(group: string, kind: QueryKind, rootFontSize: number | false): string[] {
  const inner = group.slice(1, -1).trim()
  const value = (text: string): string => normalizeFeatureValue(text, kind, rootFontSize)
  if (inner.startsWith('(') || inner.startsWith('not ')) {
    return [`(${normalizeNested(inner, kind, rootFontSize)})`]
  }
  const colon = inner.indexOf(':')
  if (colon !== -1) {
    const name = inner.slice(0, colon).trim()
    const featureValue = value(inner.slice(colon + 1))
    const [, bound, feature = ''] = MIN_MAX.exec(name) ?? []
    if (RANGE_FEATURES.has(feature)) {
      return [`(${feature} ${bound === 'min' ? '>=' : '<='} ${featureValue})`]
    }
    return [`(${name}: ${featureValue})`]
  }
  const [, left = '', operator = '', middle = '', secondOperator, right] = RANGE.exec(inner) ?? []
  if (operator === '') return [`(${inner})`]
  const flipped = FLIPPED[operator] ?? operator
  if (secondOperator !== undefined && right !== undefined) {
    return [
      `(${middle} ${flipped} ${value(left)})`,
      `(${middle} ${secondOperator} ${value(right)})`,
    ]
  }
  return RANGE_FEATURES.has(middle) && !RANGE_FEATURES.has(left)
    ? [`(${middle} ${flipped} ${value(left)})`]
    : [`(${left} ${operator} ${value(middle)})`]
}

function normalizeNested(text: string, kind: QueryKind, rootFontSize: number | false): string {
  return conditionTokens(text)
    .flatMap((token) =>
      token.startsWith('(') ? normalizeFeature(token, kind, rootFontSize) : [token],
    )
    .join(' ')
}

/** The terms of an `and`-only condition, or `undefined` when it uses `or` or `not`. */
function conjunction(
  tokens: readonly string[],
  kind: QueryKind,
  rootFontSize: number | false,
): string[] | undefined {
  if (tokens.length % 2 === 0) return undefined
  const terms: string[] = []
  for (const [index, token] of tokens.entries()) {
    if (index % 2 === 1 ? token !== 'and' : LOGICAL.test(token)) return undefined
    if (index % 2 === 0) {
      terms.push(...(token.startsWith('(') ? normalizeFeature(token, kind, rootFontSize) : [token]))
    }
  }
  return terms
}

interface MediaQuery {
  readonly negated: boolean
  readonly type: string | undefined
  readonly terms: readonly string[]
  readonly mergeable: boolean
}

// N32: `only` is a no-op, `all and` can always go, and `screen and <features>` is read as the
// features alone (the comparison is about screen rendering). `print` stays distinct.
function parseMediaQuery(query: string): MediaQuery {
  const tokens = conditionTokens(query)
  const [first, second] = tokens
  const negated = first === 'not' && second !== undefined && !second.startsWith('(')
  let index = negated || first === 'only' ? 1 : 0
  const candidate = tokens[index]
  let type =
    candidate !== undefined && !candidate.startsWith('(') && candidate !== 'not'
      ? candidate
      : undefined
  if (type !== undefined) index += tokens[index + 1] === 'and' ? 2 : 1
  const rest = tokens.slice(index)
  const terms = rest.length === 0 ? [] : conjunction(rest, 'media', MEDIA_FONT_SIZE)
  if (terms === undefined) {
    return {
      negated,
      type,
      terms: [normalizeNested(rest.join(' '), 'media', MEDIA_FONT_SIZE)],
      mergeable: false,
    }
  }
  if (!negated && (type === 'all' || (type === 'screen' && terms.length > 0))) type = undefined
  return { negated, type, terms, mergeable: !negated }
}

function printMediaQuery(negated: boolean, type: string | undefined, terms: readonly string[]) {
  const head = type === undefined ? [] : [`${negated ? 'not ' : ''}${type}`]
  return [...head, ...terms].join(' and ')
}

function mediaEntry(prelude: string): Entry | undefined {
  const queries = splitTopLevel(prelude, ',').map((query) => parseMediaQuery(query.trim()))
  const [single] = queries
  if (single !== undefined && queries.length === 1) {
    if (single.type === undefined && single.terms.length === 0) return undefined
    return {
      group: 'media',
      type: single.type,
      terms: single.terms,
      mergeable: single.mergeable,
      print: (terms, type) => `@media ${printMediaQuery(single.negated, type, terms)}`,
    }
  }
  const list = queries
    .map((query) => printMediaQuery(query.negated, query.type, uniqueSorted(query.terms)))
    .sort(byCodePoint)
    .join(', ')
  return {
    group: 'media',
    type: undefined,
    terms: [],
    mergeable: false,
    print: () => `@media ${list}`,
  }
}

function supportsEntry(prelude: string): Entry {
  const tokens = conditionTokens(prelude)
  const isConjunction =
    tokens.length % 2 === 1 &&
    tokens.every((token, index) => (index % 2 === 1 ? token === 'and' : !LOGICAL.test(token)))
  const terms = tokens
    .filter((_, index) => index % 2 === 0)
    .map((token) => {
      const [, property, value] = SUPPORTS_DECLARATION.exec(token) ?? []
      return property === undefined ? token : `(${property.toLowerCase()}: ${value})`
    })
  return {
    group: 'supports',
    type: undefined,
    terms: isConjunction ? terms : [prelude],
    mergeable: isConjunction,
    print: (merged) => `@supports ${merged.join(' and ')}`,
  }
}

// Container names are case-sensitive. Only size features merge: style() and scroll-state()
// may query a different container than a size feature does.
function containerEntry(prelude: string, rootFontSize: number | false): Entry {
  const tokens = conditionTokens(prelude)
  const [first = ''] = tokens
  const name =
    first !== '' && !first.includes('(') && !LOGICAL.test(first.toLowerCase()) ? first : ''
  const rest = (name === '' ? tokens : tokens.slice(1)).map((token) =>
    token.startsWith('(') || !token.includes('(') ? token.toLowerCase() : token,
  )
  const terms = rest.length === 0 ? [] : conjunction(rest, 'container', rootFontSize)
  return {
    group: `container\u0000${name}`,
    type: undefined,
    terms: terms ?? [normalizeNested(rest.join(' '), 'container', rootFontSize)],
    mergeable: terms?.every((term) => term.startsWith('(')) === true,
    print: (merged) =>
      `@container ${[name, merged.join(' and ')].filter((part) => part !== '').join(' ')}`,
  }
}

// Strings, brackets, escapes, empty list members and unbalanced parentheses never occur in a
// query this module can read; such a prelude is kept verbatim rather than half-parsed.
function isPlainPrelude(prelude: string): boolean {
  if (UNREADABLE.test(prelude)) return false
  let depth = 0
  for (const char of prelude) {
    if (char === '(') depth++
    else if (char === ')' && --depth < 0) return false
  }
  return depth === 0
}

function parseCondition(condition: string, rootFontSize: number | false): Entry | undefined {
  const text = collapse(condition)
  const [, atRule, prelude = ''] = AT_RULE.exec(text) ?? []
  const name = atRule?.toLowerCase()
  if (name !== undefined && !isPlainPrelude(prelude)) {
    const verbatim = `@${name} ${prelude}`
    return { group: verbatim, type: undefined, terms: [], mergeable: false, print: () => verbatim }
  }
  if (name === 'media') return mediaEntry(prelude.toLowerCase())
  if (name === 'supports') return supportsEntry(prelude)
  if (name === 'container') return containerEntry(prelude, rootFontSize)
  const printed = name === undefined ? text : `@${name}${prelude === '' ? '' : ` ${prelude}`}`
  return { group: printed, type: undefined, terms: [], mergeable: false, print: () => printed }
}

// N33: nested conditions are a conjunction, so nesting order doesn't matter, and nested rules
// of one kind merge into a single `and` list of sorted, unique terms.
function merge(entries: readonly Entry[]): string[] {
  const groups = new Map<string, Entry[]>()
  const printed: string[] = []
  for (const entry of entries) {
    if (entry.mergeable) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry])
    else printed.push(entry.print(uniqueSorted(entry.terms), entry.type))
  }
  for (const group of groups.values()) {
    const types = uniqueSorted(
      group.flatMap((entry) => (entry.type === undefined ? [] : [entry.type])),
    )
    const parts = types.length > 1 ? group.map((entry) => [entry]) : [group]
    for (const part of parts) {
      const [first] = part as [Entry]
      const type = types.length > 1 ? first.type : types[0]
      printed.push(first.print(uniqueSorted(part.flatMap((entry) => entry.terms)), type))
    }
  }
  return uniqueSorted(printed)
}

/**
 * Normal form of a context's at-rule conditions (SPEC §6, N30–N33): a sorted list in which
 * nested rules of the same kind are merged. Conditions that always hold (`@media all`) are
 * dropped.
 *
 * @example
 * normalizeConditions(['@media only screen and (min-width: 48rem)'], { rootFontSize: 16 })
 * // ['@media (width >= 768px)']
 */
export function normalizeConditions(
  conditions: readonly string[],
  options: ConditionOptions,
): string[] {
  return merge(
    conditions.flatMap((condition) => parseCondition(condition, options.rootFontSize) ?? []),
  )
}

const MEDIA_PRELUDE = /^@media (.+)$/
const MEDIA_LIST_OR_NEGATION = /,|\bnot\b|\bor\b|\bonly\b/
const WIDTH_TERM = /^\(width (>=|>|<=|<|=) (-?\d*\.?\d+)px\)$/
const DISCRETE_TERM = /^\((prefers-color-scheme|orientation): ([a-z-]+)\)$/

/** What a set of plain media conjunctions requires; a contradiction makes the set unsatisfiable. */
interface MediaRequirements {
  readonly types: Set<string>
  readonly discrete: Map<string, Set<string>>
  min: number
  minInclusive: boolean
  max: number
  maxInclusive: boolean
}

function narrowWidth(requirements: MediaRequirements, operator: string, value: number): void {
  if (operator !== '<' && operator !== '<=') {
    const inclusive = operator !== '>'
    if (value > requirements.min || (value === requirements.min && !inclusive)) {
      requirements.min = value
      requirements.minInclusive = inclusive
    }
  }
  if (operator !== '>' && operator !== '>=') {
    const inclusive = operator !== '<'
    if (value < requirements.max || (value === requirements.max && !inclusive)) {
      requirements.max = value
      requirements.maxInclusive = inclusive
    }
  }
}

function addMediaCondition(requirements: MediaRequirements, condition: string): void {
  const [, query] = MEDIA_PRELUDE.exec(condition) ?? []
  if (query === undefined || MEDIA_LIST_OR_NEGATION.test(query)) return
  for (const term of query.split(' and ')) {
    if (!term.startsWith('(')) {
      requirements.types.add(term)
      continue
    }
    const width = WIDTH_TERM.exec(term)
    if (width !== null) {
      narrowWidth(requirements, width[1] as string, Number(width[2]))
      continue
    }
    const [, feature, value] = DISCRETE_TERM.exec(term) ?? []
    if (feature === undefined || value === undefined) continue
    const values = requirements.discrete.get(feature) ?? new Set()
    values.add(value)
    requirements.discrete.set(feature, values)
  }
}

/**
 * Whether two lists of normalized conditions (N30–N33) can never hold at the same time: their
 * media queries need width ranges that don't overlap, different explicit media types (`print`
 * vs `screen`), or different values of `prefers-color-scheme` or `orientation`. Anything else,
 * including negated queries and query lists, is assumed to be able to hold together (SPEC §5.8).
 *
 * @example
 * conditionsDisjoint(['@media (width >= 768px)'], ['@media (width < 768px)']) // true
 * conditionsDisjoint(['@media (width >= 768px)'], ['@media (hover: hover)'])  // false
 */
export function conditionsDisjoint(a: readonly string[], b: readonly string[]): boolean {
  const requirements: MediaRequirements = {
    types: new Set(),
    discrete: new Map(),
    min: Number.NEGATIVE_INFINITY,
    minInclusive: true,
    max: Number.POSITIVE_INFINITY,
    maxInclusive: true,
  }
  for (const condition of [...a, ...b]) addMediaCondition(requirements, condition)
  const { min, max } = requirements
  return (
    requirements.types.size > 1 ||
    [...requirements.discrete.values()].some((values) => values.size > 1) ||
    min > max ||
    (min === max && !(requirements.minInclusive && requirements.maxInclusive))
  )
}
