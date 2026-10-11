import { normalValuesEqual } from '../css/normalize/index.ts'
import {
  type CompiledCandidate,
  type Context,
  compileCandidates,
  contextKey,
  normalizeContext,
  resolveEffective,
} from '../tailwind/effective.ts'
import { arbitraryProperty, candidateName, encodeValue } from './encode.ts'
import type { Match, MatchDeclaration, Matcher } from './exact.ts'

/** One block of the element after matching. Contexts of different blocks differ. */
export interface VerifyBlock {
  /** The block's context as written; normalized here. */
  readonly context: Context
  /** The variant chain its classes carry (`variantChain`). */
  readonly variants: readonly string[]
  readonly declarations: readonly MatchDeclaration[]
  readonly matches: readonly Match[]
}

/** A declaration whose class failed verification. */
export interface VerifyIssue {
  readonly block: number
  /** Position in the block's declarations. */
  readonly declaration: number
  /**
   * `TFC501`: its class didn't produce it even on its own, so it fell back to an arbitrary
   * property. `TFC502`: the fallback failed too, so it's unconverted.
   */
  readonly code: 'TFC501' | 'TFC502'
}

/** The classes that passed, per block, and what had to give. */
export interface VerifyResult {
  readonly matches: readonly (readonly Match[])[]
  /** Sorted by block, declaration and code. */
  readonly issues: readonly VerifyIssue[]
}

interface Mismatch {
  /** Positions of the block whose class doesn't produce them. */
  readonly positions: ReadonlySet<number>
  /** The context gets a longhand its block doesn't set. */
  readonly extra: boolean
}

interface State {
  readonly matcher: Matcher
  readonly blocks: readonly VerifyBlock[]
  readonly contexts: readonly Context[]
  readonly keys: readonly string[]
  readonly matches: Match[][]
  readonly compiled: Map<string, CompiledCandidate | null>
  readonly issues: Map<string, VerifyIssue>
}

const NO_MISMATCH: Mismatch = { positions: new Set(), extra: false }
const SHARED_LIMIT = 4096

/**
 * Verifies the classes of every block together (SPEC §5.7): the effective declarations of the
 * whole class list, per context, must equal each block's declarations that a class covers, and
 * no other context may get any. A class that fails is replaced by one arbitrary property per
 * declaration, and the list is verified again; whatever still fails is removed, and its
 * declarations become unconverted (`TFC502`). A fallback counts as `TFC501` only when the block's
 * classes fail on their own; when only other contexts make them wrong (ADR-0013), the arbitrary
 * property is just a better class.
 *
 * @example
 * verify(matcher, [{ context: BASE_CONTEXT, variants: [], declarations, matches }])
 * // { matches: [matches], issues: [] }
 */
export function verify(matcher: Matcher, blocks: readonly VerifyBlock[]): VerifyResult {
  const contexts = blocks.map((block) => normalizeContext(block.context, matcher.index.options))
  const state: State = {
    matcher,
    blocks,
    contexts,
    keys: contexts.map(contextKey),
    matches: blocks.map((block) => [...block.matches]),
    compiled: new Map(),
    issues: new Map(),
  }
  const first = mismatches(state)
  for (const [key, mismatch] of first) {
    const block = state.keys.indexOf(key)
    const report = block === -1 || !passesAlone(state, block)
    for (const [owner, match] of culprits(state, key, mismatch)) {
      replace(state, owner, match, report)
    }
  }
  // Every round removes at least one class (or stops), so this ends.
  let round = mismatches(state)
  while (round.size > 0 && removeCulprits(state, round)) round = mismatches(state)
  const issues = [...state.issues.values()].sort(
    (a, b) => a.block - b.block || a.declaration - b.declaration || a.code.localeCompare(b.code),
  )
  return { matches: state.matches, issues }
}

// Compiled classes are kept per matcher (shared across calls) and per call (stable while the
// shared cache may be cleared).
function compiledOf(state: State, classNames: readonly string[]): CompiledCandidate[] {
  const shared = state.matcher.candidates
  const missing: string[] = []
  for (const name of new Set(classNames)) {
    if (state.compiled.has(name)) continue
    const known = shared.get(name)
    if (known === undefined) missing.push(name)
    else state.compiled.set(name, known)
  }
  if (missing.length > 0) {
    const compiled = compileCandidates(state.matcher.design, missing, state.matcher.index.options)
    if (shared.size + missing.length > SHARED_LIMIT) shared.clear()
    missing.forEach((name, index) => {
      state.compiled.set(name, compiled[index] ?? null)
      shared.set(name, compiled[index] ?? null)
    })
  }
  return classNames.flatMap((name) => state.compiled.get(name) ?? [])
}

/** Mismatches by context key: every block's context, plus any other context a class lands in. */
function mismatches(state: State): Map<string, Mismatch> {
  const { design, index } = state.matcher
  const compiled = compiledOf(
    state,
    state.matches.flat().map((match) => match.className),
  )
  const found = new Map<string, Mismatch>()
  state.blocks.forEach((block, position) => {
    const context = state.contexts[position] as Context
    const actual = resolveEffective(design, compiled, context, index.options)
    const mismatch = compare(block, state.matches[position] ?? [], actual)
    if (mismatch !== NO_MISMATCH) found.set(state.keys[position] as string, mismatch)
  })
  const foreign = new Map<string, Context>()
  for (const candidate of compiled) {
    for (const rule of candidate.rules) {
      if (rule.context === undefined) continue
      const key = contextKey(rule.context)
      if (!state.keys.includes(key)) foreign.set(key, rule.context)
    }
  }
  for (const [key, context] of foreign) {
    if (resolveEffective(design, compiled, context, index.options).length > 0) {
      found.set(key, { positions: new Set(), extra: true })
    }
  }
  return found
}

function compare(
  block: VerifyBlock,
  matches: readonly Match[],
  actual: ReturnType<typeof resolveEffective>,
): Mismatch {
  const byProperty = new Map(actual.map((declaration) => [declaration.property, declaration]))
  const expected = new Set<string>()
  const positions = new Set<number>()
  for (const match of matches) {
    for (const position of match.declarations) {
      const wanted = block.declarations[position] as MatchDeclaration
      expected.add(wanted.property)
      const got = byProperty.get(wanted.property)
      if (
        got === undefined ||
        got.important !== wanted.important ||
        !normalValuesEqual(got.value, wanted.value)
      ) {
        positions.add(position)
      }
    }
  }
  const extra = actual.some((declaration) => !expected.has(declaration.property))
  return positions.size === 0 && !extra ? NO_MISMATCH : { positions, extra }
}

// Whether the block's classes are right in its context when no other block's classes exist.
function passesAlone(state: State, block: number): boolean {
  const matches = state.matches[block] ?? []
  const compiled = compiledOf(
    state,
    matches.map((match) => match.className),
  )
  const actual = resolveEffective(
    state.matcher.design,
    compiled,
    state.contexts[block] as Context,
    state.matcher.index.options,
  )
  return compare(state.blocks[block] as VerifyBlock, matches, actual) === NO_MISMATCH
}

/**
 * The classes to blame: a block's classes covering its wrong positions, and for a context that
 * gets an extra longhand, every class with a rule there.
 */
function culprits(state: State, key: string, mismatch: Mismatch): [number, Match][] {
  const found: [number, Match][] = []
  const block = state.keys.indexOf(key)
  state.matches.forEach((matches, owner) => {
    for (const match of matches) {
      const covers =
        owner === block && match.declarations.some((position) => mismatch.positions.has(position))
      const lands =
        mismatch.extra &&
        (state.compiled.get(match.className)?.rules ?? []).some(
          (rule) => rule.context !== undefined && contextKey(rule.context) === key,
        )
      if (covers || lands) found.push([owner, match])
    }
  })
  return found
}

function addIssue(
  state: State,
  block: number,
  declaration: number,
  code: VerifyIssue['code'],
): void {
  state.issues.set(`${block}:${declaration}:${code}`, { block, declaration, code })
}

/** Replaces a class by one arbitrary property per declaration; an unencodable one is dropped. */
function replace(state: State, owner: number, match: Match, report: boolean): void {
  const matches = state.matches[owner] as Match[]
  const at = matches.indexOf(match)
  if (at === -1 || match.kind === 'arbitrary-property') return
  const block = state.blocks[owner] as VerifyBlock
  const { design, important } = state.matcher
  const replacements: Match[] = []
  for (const position of match.declarations) {
    const declaration = block.declarations[position] as MatchDeclaration
    const encoded = encodeValue(declaration.raw)
    if (report || encoded === undefined) addIssue(state, owner, position, 'TFC501')
    if (encoded === undefined) {
      addIssue(state, owner, position, 'TFC502')
      continue
    }
    const core = arbitraryProperty(declaration.property, encoded)
    replacements.push({
      className: candidateName(core, {
        prefix: design.prefix,
        important: declaration.important ? important : false,
        variants: block.variants,
      }),
      kind: 'arbitrary-property',
      declarations: [position],
    })
  }
  matches.splice(at, 1, ...replacements)
}

function removeCulprits(state: State, round: ReadonlyMap<string, Mismatch>): boolean {
  let removed = false
  for (const [key, mismatch] of round) {
    for (const [owner, match] of culprits(state, key, mismatch)) {
      removed = remove(state, owner, match) || removed
    }
  }
  return removed
}

function remove(state: State, owner: number, match: Match): boolean {
  const matches = state.matches[owner] as Match[]
  const at = matches.indexOf(match)
  if (at === -1) return false
  matches.splice(at, 1)
  for (const position of match.declarations) {
    addIssue(state, owner, position, 'TFC501')
    addIssue(state, owner, position, 'TFC502')
  }
  return true
}
