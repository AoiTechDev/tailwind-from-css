import { conditionsDisjoint, widthConditionImplied } from '../css/conditions.ts'
import {
  covers,
  longhandsOf,
  type NormalDeclaration,
  normalValuesEqual,
} from '../css/normalize/index.ts'
import { compareSpecificity, intersectSelectors, type Specificity } from '../css/selector.ts'
import type { TailwindDesignSystem } from '../tailwind/adapter.ts'
import {
  appliesWithin,
  type CompiledCandidate,
  type Context,
  compileCandidates,
  contextKey,
  type EffectiveOptions,
  normalizeContext,
  resolveApplied,
} from '../tailwind/effective.ts'
import { arbitraryProperty, candidateName, encodeValue } from './encode.ts'
import { type Match, type MatchDeclaration, type Matcher, matchDeclarations } from './exact.ts'
import { type VariantResolver, variantChain } from './variants.ts'
import { verify } from './verify.ts'

/** Where a declaration stands in the source cascade, besides its importance (SPEC §5.8). */
export interface SourceRank {
  /** Specificity of the original selector (`convertCss`) or of the relative one (`convertStyles`). */
  readonly specificity: Specificity
  /** Source order: array order for `convertStyles`, stylesheet order for `convertCss`. */
  readonly order: number
}

/** One block of the element: its context and longhands, ranked by the source cascade. */
export interface RankedBlock {
  /** As written; normalized here. */
  readonly context: Context
  readonly declarations: readonly MatchDeclaration[]
  /** The rank of each declaration. */
  readonly ranks: readonly SourceRank[]
}

/** A block after verification (SPEC §5.7), with its variant chain and classes. */
export interface CascadeBlock extends RankedBlock {
  readonly variants: readonly string[]
  readonly matches: readonly Match[]
}

/** A declaration of a block, by block and position. */
export interface BlockDeclaration {
  readonly block: number
  readonly declaration: number
}

/** A class added for an intersection of contexts, carrying the source winners' values. */
export interface StackedClass {
  readonly className: string
  readonly kind: Match['kind']
  /** The declarations whose values it carries. */
  readonly sources: readonly BlockDeclaration[]
}

/** A diagnostic about a declaration of a block. */
export interface CascadeIssue extends BlockDeclaration {
  /**
   * `TFC401`: it wins where it overlaps other contexts only thanks to a stacked class.
   * `TFC402`: Tailwind would let it win where the source doesn't, and no stacked class can fix
   * that, so it's unconverted. `TFC501`/`TFC502`: as in verification, for the classes that
   * replaced a removed class's other declarations.
   */
  readonly code: 'TFC401' | 'TFC402' | 'TFC501' | 'TFC502'
}

/** The classes per block after the check, the stacked classes, and the issues. */
export interface CascadeResult {
  readonly matches: readonly (readonly Match[])[]
  readonly stacked: readonly StackedClass[]
  /** In the order they were found. */
  readonly issues: readonly CascadeIssue[]
}

/** A covered longhand of one block. */
interface Participant {
  readonly block: number
  readonly position: number
  readonly declaration: MatchDeclaration
  readonly context: Context
  readonly source: SourceRank
  readonly rank: TailwindRank
}

/** A class's rule for a longhand: its specificity; its order comes from {@link State.orders}. */
interface TailwindRank {
  readonly specificity: Specificity
  readonly className: string
}

/** Something that sets a longhand in a context: a participant or a planned stacked class. */
interface Contender {
  readonly declaration: MatchDeclaration
}

/** A context where a longhand needs a stacked class, with the participants that apply there. */
interface Need {
  /** The longhand. */
  readonly property: string
  readonly context: Context
  readonly key: string
  readonly members: readonly Participant[]
  readonly winner: Participant
}

interface Analysis {
  readonly property: string
  readonly needs: readonly Need[]
  /** The participants Tailwind lets win where the source doesn't. */
  readonly losers: readonly Participant[]
  readonly failed: boolean
}

interface State {
  readonly matcher: Matcher
  readonly resolver: VariantResolver
  readonly options: EffectiveOptions
  readonly blocks: readonly CascadeBlock[]
  readonly contexts: readonly Context[]
  readonly matches: Match[][]
  readonly compiled: Map<string, CompiledCandidate | null>
  readonly issues: Map<string, CascadeIssue>
}

interface Plan {
  readonly stacked: readonly StackedClass[]
  readonly losers: readonly Participant[]
}

// SPEC §5.8: beyond this many conflicting contexts per longhand, stacking isn't attempted.
const MAX_CONFLICTING = 4
// Stacked classes per longhand. Four conflicting contexts have 2^4 - 4 - 1 = 11 intersections;
// contexts that apply there too may need a few more.
const MAX_STACKED = 16
const ZERO: Specificity = [0, 0, 0]
const CACHE_LIMIT = 4096
const WIDTH = /\(width [<>]=? /

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The context where `a` and `b` both apply to the same element, in normal form (§6): the
 * selectors intersected, the conditions joined. `'disjoint'` when they can't apply together
 * (provably exclusive conditions, or different elements or pseudo-elements); `undefined` when
 * they may but no context can describe where (two different ancestor parts).
 *
 * @example
 * contextIntersection({ selector: '&', conditions: ['@media (width >= 768px)'] },
 *   { selector: '&:hover', conditions: [] }, options)
 * // { selector: '&:hover', conditions: ['@media (width >= 768px)'] }
 */
export function contextIntersection(
  a: Context,
  b: Context,
  options: EffectiveOptions,
): Context | 'disjoint' | undefined {
  if (conditionsDisjoint(a.conditions, b.conditions)) return 'disjoint'
  const selector = intersectSelectors(a.selector, b.selector)
  if (selector === undefined || selector === 'disjoint') return selector
  return normalizeContext({ selector, conditions: [...a.conditions, ...b.conditions] }, options)
}

const compareSource = (a: Participant, b: Participant): number =>
  Number(a.declaration.important) - Number(b.declaration.important) ||
  compareSpecificity(a.source.specificity, b.source.specificity) ||
  a.source.order - b.source.order

type Ranked = { readonly declaration: MatchDeclaration; readonly rank: TailwindRank }

function tailwindOrder(state: State): (a: Ranked, b: Ranked) => number {
  return (a, b) =>
    Number(a.declaration.important) - Number(b.declaration.important) ||
    compareSpecificity(a.rank.specificity, b.rank.specificity) ||
    classOrder(state.matcher.design, a.rank.className, b.rank.className)
}

const pairOrders = new WeakMap<TailwindDesignSystem, Map<string, number>>()

// Tailwind numbers the classes of one `getClassOrder` call, so keys are only comparable within
// one call: each pair is ranked on its own (and remembered).
function classOrder(design: TailwindDesignSystem, a: string, b: string): number {
  if (a === b) return 0
  let known = pairOrders.get(design)
  if (known === undefined) {
    known = new Map()
    pairOrders.set(design, known)
  }
  const cacheKey = `${a}\u0000${b}`
  let result = known.get(cacheKey)
  if (result === undefined) {
    const [first, second] = design.classOrder([a, b])
    result =
      first === second || first === null || second === null || first === undefined
        ? compareText(a, b)
        : first < (second as bigint)
          ? -1
          : 1
    if (known.size >= CACHE_LIMIT) known.clear()
    known.set(cacheKey, result)
  }
  return result
}

/** `getClassOrder` keys of `names` from one call, so they can be compared. */
function ordersOf(design: TailwindDesignSystem, names: readonly string[]): Map<string, bigint> {
  const orders = design.classOrder(names)
  return new Map(
    names.flatMap((name, index) => {
      const order = orders[index]
      return order === null || order === undefined ? [] : [[name, order] as const]
    }),
  )
}

const sameValue = (a: Contender, b: Contender): boolean =>
  a.declaration.property === b.declaration.property &&
  a.declaration.important === b.declaration.important &&
  normalValuesEqual(a.declaration.value, b.declaration.value)

const highest = <T>(items: readonly T[], compare: (a: T, b: T) => number): T =>
  items.reduce((best, item) => (compare(item, best) > 0 ? item : best))

/**
 * Declarations that never show: another block's context applies wherever theirs does, and that
 * block's declaration of the same longhand wins the source cascade (a base rule after an
 * `@media` or `@starting-style` rule for the same element). Dropping them is lossless (`TFC106`),
 * and it's needed, since no stacked class could beat a class in its own context.
 *
 * @example
 * shadowedDeclarations([md, base], options) // [{ block: 0, declaration: 0 }]
 */
export function shadowedDeclarations(
  blocks: readonly RankedBlock[],
  options: EffectiveOptions,
): BlockDeclaration[] {
  const contexts = blocks.map((block) => normalizeContext(block.context, options))
  const keys = contexts.map(contextKey)
  const shadowed: BlockDeclaration[] = []
  blocks.forEach((inner, block) => {
    inner.declarations.forEach((declaration, position) => {
      const self = participantOf(inner, block, position, contexts[block] as Context)
      const beaten = blocks.some((outer, other) => {
        if (other === block || keys[other] === keys[block]) return false
        return outer.declarations.some((item, at) => {
          if (
            item.property !== declaration.property &&
            !covers(item.property, declaration.property)
          ) {
            return false
          }
          const rival = participantOf(outer, other, at, contexts[other] as Context)
          return (
            compareSource(rival, self) > 0 &&
            appliesWithin(contexts[other] as Context, contexts[block] as Context, options)
          )
        })
      })
      if (beaten) shadowed.push({ block, declaration: position })
    })
  })
  return shadowed
}

// `appliesWithin`, also when a width condition of `outer` is only implied by `inner`'s bounds
// (`md` within `xl`).
const widerLayer = (outer: Context, inner: Context, options: EffectiveOptions): boolean =>
  appliesWithin(
    {
      selector: outer.selector,
      conditions: outer.conditions.filter(
        (condition) => !widthConditionImplied(condition, inner.conditions),
      ),
    },
    inner,
    options,
  )

/** A class that shows nothing another block's class doesn't already show where it applies. */
export interface RedundantClass {
  readonly block: number
  /** Position in the block's matches. */
  readonly match: number
  /** Per declaration it covers, the declaration of another block that shows the same value. */
  readonly shownBy: readonly { readonly declaration: number; readonly by: BlockDeclaration }[]
}

/**
 * Relaxed classes under a width condition that can go (SPEC §4): for each longhand
 * the class covers, a block that applies wherever it does sets the same value with the same
 * importance, and every other block setting that longhand where they overlap either beats the
 * class in the source cascade or loses to that block. Then the source shows the same value
 * everywhere without the class. Snapping makes repeats (`text-2xl md:text-2xl`); exact mode never
 * has relaxed classes, so it keeps every class.
 *
 * @example
 * redundantClasses([base, md, xl], options) // [{ block: 1, match: 0, shownBy: [{ declaration: 0, by: { block: 0, declaration: 0 } }] }]
 */
export function redundantClasses(
  blocks: readonly CascadeBlock[],
  options: EffectiveOptions,
): RedundantClass[] {
  const contexts = blocks.map((block) => normalizeContext(block.context, options))
  const dropped = blocks.map(() => new Set<number>())
  const coveredBy = blocks.map(
    (block) =>
      new Map(
        block.matches.flatMap((match, at) =>
          match.declarations.map((position) => [position, at] as const),
        ),
      ),
  )
  const shows = (block: number, position: number): boolean => {
    const match = coveredBy[block]?.get(position)
    return match !== undefined && !dropped[block]?.has(match)
  }
  const participant = (block: number, position: number): Participant =>
    participantOf(blocks[block] as CascadeBlock, block, position, contexts[block] as Context)
  const showing = (block: number, position: number): BlockDeclaration | undefined => {
    const self = participant(block, position)
    const { property } = self.declaration
    if (longhandsOf(property).length !== 1 || longhandsOf(property)[0] !== property) return
    const within = contexts[block] as Context
    const candidates = blocks.flatMap((outer, other) =>
      other === block || !widerLayer(contexts[other] as Context, within, options)
        ? []
        : outer.declarations.flatMap((_, at) =>
            shows(other, at) && sameValue(participant(other, at), self)
              ? [participant(other, at)]
              : [],
          ),
    )
    if (candidates.length === 0) return
    const shown = highest(candidates, compareSource)
    const between = blocks.some((rival, other) => {
      if (
        other === block ||
        contextIntersection(within, contexts[other] as Context, options) === 'disjoint'
      ) {
        return false
      }
      return rival.declarations.some((item, at) => {
        if (!longhandsOf(item.property).includes(property)) return false
        const match = coveredBy[other]?.get(at)
        if (match !== undefined && dropped[other]?.has(match)) return false
        const contender = participant(other, at)
        return (
          !sameValue(contender, self) &&
          compareSource(contender, self) < 0 &&
          compareSource(contender, shown) > 0
        )
      })
    })
    return between ? undefined : { block: shown.block, declaration: shown.position }
  }
  const found: RedundantClass[] = []
  blocks.forEach((block, index) => {
    if (!(contexts[index] as Context).conditions.some((condition) => WIDTH.test(condition))) return
    block.matches.forEach((match, at) => {
      const relaxed = match.declarations.some(
        (position) => block.declarations[position]?.relaxed !== undefined,
      )
      if (!relaxed) return
      const shownBy: RedundantClass['shownBy'][number][] = []
      for (const declaration of match.declarations) {
        const by = showing(index, declaration)
        if (by === undefined) return
        shownBy.push({ declaration, by })
      }
      dropped[index]?.add(at)
      found.push({ block: index, match: at, shownBy })
    })
  })
  // A class that showed a dropped one's value may have gone too: follow to the one that stays.
  const by = new Map(
    found.flatMap((item) =>
      item.shownBy.map((shown) => [`${item.block}:${shown.declaration}`, shown.by] as const),
    ),
  )
  const last = (at: BlockDeclaration): BlockDeclaration => {
    const next = by.get(`${at.block}:${at.declaration}`)
    return next === undefined ? at : last(next)
  }
  return found.map((item) => ({
    ...item,
    shownBy: item.shownBy.map((shown) => ({ ...shown, by: last(shown.by) })),
  }))
}

/**
 * Longhands (positions) of one block whose class Tailwind puts before the class of a shorthand
 * that covers them and stays whole (N01), although the source writes the longhand later with the
 * same importance: Tailwind sorts `[border:…]`, `[background:…]` and `[font:…]` after every
 * longhand utility, so the longhand would never show. No class can fix that (`TFC402`).
 *
 * @example
 * shorthandOrderConflicts(matcher, input, matches) // [1] for `border: var(--a); border-top-color: red`
 */
export function shorthandOrderConflicts(
  matcher: Matcher,
  declarations: readonly MatchDeclaration[],
  matches: readonly Match[],
): number[] {
  const classOf = new Map<number, string>()
  for (const match of matches) {
    for (const position of match.declarations) classOf.set(position, match.className)
  }
  const conflicts: number[] = []
  declarations.forEach((longhand, position) => {
    const own = classOf.get(position)
    if (own === undefined) return
    const hidden = declarations.some((shorthand, at) => {
      const other = classOf.get(at)
      return (
        other !== undefined &&
        other !== own &&
        shorthand.important === longhand.important &&
        shorthand.source < longhand.source &&
        covers(shorthand.property, longhand.property) &&
        classOrder(matcher.design, other, own) > 0
      )
    })
    if (hidden) conflicts.push(position)
  })
  return conflicts
}

function participantOf(
  block: RankedBlock,
  index: number,
  position: number,
  context: Context,
  rank: TailwindRank = { specificity: ZERO, className: '' },
): Participant {
  return {
    block: index,
    position,
    declaration: block.declarations[position] as MatchDeclaration,
    context,
    source: block.ranks[position] as SourceRank,
    rank,
  }
}

/**
 * Checks the cascade between the blocks of one element (SPEC §5.8, ADR-0008). For each longhand
 * set in two or more contexts that can apply together, the source winner (importance,
 * specificity of the original selector, source order) must be Tailwind's winner too
 * (importance, specificity of the generated selector, `getClassOrder`). Where they differ, a
 * class for the intersection of the contexts, carrying the source winner's value, is stacked on
 * top (`TFC401`), verified (§5.7), and checked to win there. With more than four conflicting
 * contexts for a longhand, or a stacked class that can't be written or doesn't win, the
 * declarations Tailwind would wrongly let win lose their classes instead (`TFC402`).
 *
 * @example
 * checkCascade(matcher, resolver, [md, minWidth1000])
 * // { matches, stacked: [{ className: 'md:min-[1000px]:p-6', … }], issues: [{ code: 'TFC401', … }] }
 */
export function checkCascade(
  matcher: Matcher,
  resolver: VariantResolver,
  blocks: readonly CascadeBlock[],
): CascadeResult {
  const options = matcher.index.options
  const state: State = {
    matcher,
    resolver,
    options,
    blocks,
    contexts: blocks.map((block) => normalizeContext(block.context, options)),
    matches: blocks.map((block) => [...block.matches]),
    compiled: new Map(),
    issues: new Map(),
  }
  // Every round that fails removes a class, so this ends.
  let plan = planStacks(state)
  while (plan.losers.length > 0) {
    for (const loser of plan.losers) removeCoverage(state, loser)
    reverify(state)
    plan = planStacks(state)
  }
  for (const stacked of plan.stacked) {
    for (const source of stacked.sources) addIssue(state, source, 'TFC401')
  }
  return { matches: state.matches, stacked: plan.stacked, issues: [...state.issues.values()] }
}

function addIssue(state: State, at: BlockDeclaration, code: CascadeIssue['code']): void {
  state.issues.set(`${at.block}:${at.declaration}:${code}`, { ...at, code })
}

function compiledOf(state: State, names: readonly string[]): (CompiledCandidate | null)[] {
  const shared = state.matcher.candidates
  const missing = [...new Set(names)].filter(
    (name) => !state.compiled.has(name) && !shared.has(name),
  )
  const compiled = compileCandidates(state.matcher.design, missing, state.options)
  for (const [index, name] of missing.entries()) {
    state.compiled.set(name, compiled[index] as CompiledCandidate | null)
  }
  return names.map((name) => state.compiled.get(name) ?? shared.get(name) ?? null)
}

/** Specificity of a class's rule in a context, and its `getClassOrder` key. */
function rankIn(state: State, className: string, key: string): TailwindRank | undefined {
  const [compiled] = compiledOf(state, [className])
  const rule = compiled?.rules.find(
    (candidate) => candidate.context !== undefined && contextKey(candidate.context) === key,
  )
  return rule === undefined ? undefined : { specificity: rule.specificity, className }
}

const regions = new Map<string, Context | 'disjoint' | undefined>()

function region(state: State, a: number, b: number): Context | 'disjoint' | undefined {
  const first = state.contexts[a] as Context
  const second = state.contexts[b] as Context
  const cacheKey = `${state.options.rootFontSize}\u0001${contextKey(first)}\u0001${contextKey(second)}`
  if (!regions.has(cacheKey)) {
    if (regions.size >= CACHE_LIMIT) regions.clear()
    regions.set(cacheKey, contextIntersection(first, second, state.options))
  }
  return regions.get(cacheKey)
}

/**
 * Every covered declaration, grouped by the longhands it sets in code-point order: a shorthand
 * kept whole (N01) takes part for each of its longhands.
 */
function participantsByProperty(state: State): [string, Participant[]][] {
  const byProperty = new Map<string, Participant[]>()
  state.matches.forEach((matches, block) => {
    const key = contextKey(state.contexts[block] as Context)
    for (const match of matches) {
      const rank = rankIn(state, match.className, key)
      if (rank === undefined) continue
      for (const position of match.declarations) {
        const participant = participantOf(
          state.blocks[block] as CascadeBlock,
          block,
          position,
          state.contexts[block] as Context,
          rank,
        )
        for (const property of longhandsOf(participant.declaration.property)) {
          const list = byProperty.get(property) ?? []
          list.push(participant)
          byProperty.set(property, list)
        }
      }
    }
  })
  return [...byProperty.keys()].sort(compareText).flatMap((property) => {
    const list = byProperty.get(property) as Participant[]
    return new Set(list.map((participant) => participant.block)).size > 1
      ? [[property, list] as [string, Participant[]]]
      : []
  })
}

function planStacks(state: State): Plan {
  const analyses = participantsByProperty(state).map(([property, participants]) =>
    analyze(state, property, participants),
  )
  const failed = analyses.filter((analysis) => analysis.failed)
  if (failed.length > 0) return { stacked: [], losers: failed.flatMap((a) => a.losers) }
  // A whole shorthand needs the same stacked class for each of its longhands: one is enough.
  const needs = [
    ...new Map(
      analyses
        .flatMap((analysis) => analysis.needs)
        .map((need) => [`${need.key}\u0002${need.winner.block}:${need.winner.position}`, need]),
    ).values(),
  ]
  if (needs.length === 0) return { stacked: [], losers: [] }
  const groups = new Map<string, Need[]>()
  for (const need of needs) groups.set(need.key, [...(groups.get(need.key) ?? []), need])
  const stacked: { need: Need; className: string; kind: Match['kind']; rank: TailwindRank }[] = []
  const failing = new Set<string>()
  for (const key of [...groups.keys()].sort(compareText)) {
    const group = groups.get(key) as Need[]
    const built = buildStack(state, group)
    if (built === undefined) {
      for (const need of group) failing.add(need.property)
      continue
    }
    for (const entry of built) stacked.push(entry)
    for (const need of group) {
      if (!built.some((entry) => entry.need === need)) failing.add(need.property)
    }
  }
  for (const entry of stacked) {
    if (!winsWhereNeeded(state, entry, stacked)) failing.add(entry.need.property)
  }
  if (failing.size === 0) {
    for (const property of shownWrongly(state, stacked)) failing.add(property)
  }
  if (failing.size > 0) {
    return {
      stacked: [],
      losers: [
        ...new Set(
          analyses.flatMap((analysis) => (failing.has(analysis.property) ? analysis.losers : [])),
        ),
      ],
    }
  }
  const byClass = new Map<string, StackedClass>()
  for (const { need, className, kind } of stacked) {
    const known = byClass.get(className)
    const source = { block: need.winner.block, declaration: need.winner.position }
    const sources = known?.sources ?? []
    const repeated = sources.some(
      (other) => other.block === source.block && other.declaration === source.declaration,
    )
    byClass.set(className, { className, kind, sources: repeated ? sources : [...sources, source] })
  }
  return { stacked: [...byClass.values()], losers: [] }
}

/** The needs of one longhand: where a stacked class must carry the source winner's value. */
function analyze(state: State, property: string, participants: readonly Participant[]): Analysis {
  const losers = new Set<Participant>()
  const conflicting = new Set<Participant>()
  const starts: Context[] = []
  let failed = false
  participants.forEach((first, index) => {
    for (const second of participants.slice(index + 1)) {
      // Within one block verification has settled the order (SPEC §5.7).
      if (first.block === second.block) continue
      const context = region(state, first.block, second.block)
      if (context === 'disjoint') continue
      const winner = compareSource(first, second) > 0 ? first : second
      const shown = tailwindOrder(state)(first, second) > 0 ? first : second
      if (winner === shown || sameValue(winner, shown)) continue
      losers.add(shown)
      conflicting.add(first).add(second)
      if (context === undefined) failed = true
      else starts.push(context)
    }
  })
  const lost = [...losers]
  if (lost.length === 0) return { property, needs: [], losers: [], failed: false }
  if (failed || conflicting.size > MAX_CONFLICTING) {
    return { property, needs: [], losers: lost, failed: true }
  }
  const needs = regionNeeds(state, property, participants, starts)
  return needs === undefined
    ? { property, needs: [], losers: lost, failed: true }
    : { property, needs, losers: lost, failed: false }
}

interface Region {
  readonly context: Context
  readonly members: readonly Participant[]
  readonly id: string
}

function regionOf(state: State, participants: readonly Participant[], context: Context): Region {
  const members = participants.filter((participant) =>
    appliesWithin(participant.context, context, state.options),
  )
  const id = members.map((member) => `${member.block}:${member.position}`).join(',')
  return { context, members, id }
}

// Intersections from the conflicting pairs first; every stacked class makes its intersections
// with the other contexts worth a look, since it may now win there too. A stacked class is
// planned to beat the participants and the stacked classes of larger regions (checked later).
function regionNeeds(
  state: State,
  property: string,
  participants: readonly Participant[],
  starts: readonly Context[],
): Need[] | undefined {
  const queue = starts.map((context) => regionOf(state, participants, context))
  const seen = new Set<string>()
  const needs: Need[] = []
  while (queue.length > 0) {
    queue.sort((a, b) => a.members.length - b.members.length || compareText(a.id, b.id))
    const next = queue.shift() as Region
    if (seen.has(next.id) || next.members.length < 2) continue
    seen.add(next.id)
    const expected = highest(next.members, compareSource)
    const shown = shownIn(state, next, needs)
    if (shown !== undefined && sameValue(shown, expected)) continue
    const key = contextKey(next.context)
    if (key === contextKey(expected.context) || needs.length === MAX_STACKED) return undefined
    needs.push({ property, context: next.context, key, members: next.members, winner: expected })
    for (const other of participants) {
      if (next.members.includes(other)) continue
      const deeper = contextIntersection(next.context, other.context, state.options)
      if (deeper === undefined) return undefined
      if (deeper !== 'disjoint') queue.push(regionOf(state, participants, deeper))
    }
  }
  return needs
}

// What Tailwind shows in a region under the plan: the stacked class of the smallest region that
// applies (`undefined` when two of them disagree), else the participants' winner.
function shownIn(state: State, at: Region, needs: readonly Need[]): Contender | undefined {
  const applying = needs.filter((need) => appliesWithin(need.context, at.context, state.options))
  if (applying.length === 0) return highest(at.members, tailwindOrder(state))
  const most = Math.max(...applying.map((need) => need.members.length))
  const top = applying.filter((need) => need.members.length === most)
  const [first] = top as [Need]
  return top.every((need) => sameValue(need.winner, first.winner)) ? first.winner : undefined
}

/** Classes for one intersection context, verified on their own; `undefined` if impossible. */
function buildStack(
  state: State,
  group: readonly Need[],
): { need: Need; className: string; kind: Match['kind']; rank: TailwindRank }[] | undefined {
  const [{ context, key }] = group as [Need]
  const winners = [...new Set(group.map((need) => need.winner))]
  const declarations = winners.map((winner) => winner.declaration)
  const chain = variantChain(
    state.resolver,
    context,
    new Set(declarations.map((declaration) => declaration.property)),
  )
  if ('code' in chain) return undefined
  const matched = matchDeclarations(state.matcher, declarations, chain.variants)
  const verified = verify(state.matcher, [
    { context, variants: chain.variants, declarations, matches: matched.matches },
  ])
  if (verified.issues.some((issue) => issue.code === 'TFC502')) return undefined
  const built: { need: Need; className: string; kind: Match['kind']; rank: TailwindRank }[] = []
  for (const match of verified.matches[0] ?? []) {
    const rank = rankIn(state, match.className, key)
    if (rank === undefined) return undefined
    for (const position of match.declarations) {
      for (const need of group) {
        if (need.winner !== winners[position]) continue
        built.push({ need, className: match.className, kind: match.kind, rank })
      }
    }
  }
  return built
}

// The plan assumed each stacked class beats the participants of its region and the stacked
// classes of larger regions that apply there.
function winsWhereNeeded(
  state: State,
  entry: { need: Need; rank: TailwindRank },
  stacked: readonly { need: Need; rank: TailwindRank }[],
): boolean {
  const { need } = entry
  const { property } = need
  const self = { declaration: need.winner.declaration, rank: entry.rank }
  const rivals = [
    ...need.members,
    ...stacked
      .filter(
        (other) =>
          other.need.property === property &&
          other.need.members.length < need.members.length &&
          other.need.members.every((member) => need.members.includes(member)),
      )
      .map((other) => ({ declaration: other.need.winner.declaration, rank: other.rank })),
  ]
  const compare = tailwindOrder(state)
  return rivals.every((rival) => compare(self, rival) > 0)
}

/** Longhands that the final class list doesn't show right in some stacked context (§5.7). */
function shownWrongly(
  state: State,
  stacked: readonly { need: Need; className: string }[],
): string[] {
  const names = [
    ...state.matches.flat().map((match) => match.className),
    ...stacked.map((entry) => entry.className),
  ]
  const unique = [...new Set(names)]
  const orders = ordersOf(state.matcher.design, unique)
  const all = compiledOf(state, unique).flatMap((candidate) => {
    const order = candidate === null ? undefined : orders.get(candidate.candidate)
    return candidate === null || order === undefined ? [] : [{ ...candidate, order }]
  })
  const wrong: string[] = []
  const byKey = new Map<string, NormalShown>()
  for (const { need } of stacked) {
    let shown = byKey.get(need.key)
    if (shown === undefined) {
      const declarations = resolveApplied(state.matcher.design, all, need.context, state.options)
      shown = new Map(declarations.map((declaration) => [declaration.property, declaration]))
      byKey.set(need.key, shown)
    }
    const wanted = need.winner.declaration
    const got = visible(shown, need.property)
    if (
      got === undefined ||
      got.property !== wanted.property ||
      got.important !== wanted.important ||
      !normalValuesEqual(got.value, wanted.value)
    ) {
      wrong.push(need.property)
    }
  }
  return wrong
}

type NormalShown = Map<string, NormalDeclaration>

// What sets a longhand among cascaded declarations: the longhand itself, else the smallest
// shorthand covering it (a larger one written later would have removed the smaller one).
function visible(shown: NormalShown, longhand: string): NormalDeclaration | undefined {
  const own = shown.get(longhand)
  if (own !== undefined) return own
  const covering = [...shown.values()].filter((declaration) =>
    covers(declaration.property, longhand),
  )
  return covering.find((declaration) =>
    covering.every((other) => !covers(declaration.property, other.property)),
  )
}

/**
 * Takes a loser's longhand out of its class (`TFC402`). The class's other longhands get one
 * arbitrary property each, as verification's fallback does; one that can't be encoded is lost
 * too.
 */
function removeCoverage(state: State, loser: Participant): void {
  const matches = state.matches[loser.block] as Match[]
  const at = matches.findIndex((match) => match.declarations.includes(loser.position))
  if (at === -1) return
  const match = matches[at] as Match
  addIssue(state, { block: loser.block, declaration: loser.position }, 'TFC402')
  const block = state.blocks[loser.block] as CascadeBlock
  const replacements: Match[] = []
  for (const position of match.declarations) {
    if (position === loser.position) continue
    const declaration = block.declarations[position] as MatchDeclaration
    const encoded = encodeValue(declaration.raw)
    if (encoded === undefined) {
      addIssue(state, { block: loser.block, declaration: position }, 'TFC402')
      continue
    }
    replacements.push({
      className: candidateName(arbitraryProperty(declaration.property, encoded), {
        prefix: state.matcher.design.prefix,
        important: declaration.important ? state.matcher.important : false,
        variants: block.variants,
      }),
      kind: 'arbitrary-property',
      declarations: [position],
    })
  }
  matches.splice(at, 1, ...replacements)
}

// Replacements are verified like any class (SPEC §5.7); what fails is unconverted.
function reverify(state: State): void {
  const verified = verify(
    state.matcher,
    state.blocks.map((block, index) => ({
      context: block.context,
      variants: block.variants,
      declarations: block.declarations,
      matches: state.matches[index] as Match[],
    })),
  )
  verified.matches.forEach((matches, index) => {
    state.matches[index] = [...matches]
  })
  for (const issue of verified.issues) addIssue(state, issue, issue.code)
}
