import type {
  CandidateAst,
  CandidateDeclaration,
  CandidateRule,
  PropertyRule,
  TailwindDesignSystem,
  VariantEntry,
} from '../../src/tailwind/adapter.ts'

/** A hand-written design system for unit tests: what each candidate compiles to, in class order. */
export interface FakeDesignInput {
  readonly candidates: Readonly<Record<string, CandidateAst>>
  /** Candidates `classList()` returns, in order; default: every key of `candidates`. */
  readonly classList?: readonly string[]
  /** Modifiers `classList()` lists per candidate; default none. */
  readonly modifiers?: Readonly<Record<string, readonly string[]>>
  readonly theme?: Readonly<Record<string, string>>
  readonly prefix?: string | null
  readonly variants?: readonly VariantEntry[]
  readonly roots?: readonly string[]
  readonly version?: string
}

/** Parses `property: value` (a trailing `!` marks it important). */
function decl(text: string): CandidateDeclaration {
  const colon = text.indexOf(':')
  const value = text.slice(colon + 1).trim()
  const important = value.endsWith('!')
  return {
    property: text.slice(0, colon).trim(),
    value: important ? value.slice(0, -1).trim() : value,
    important,
  }
}

/** A rule with the given selector, conditions and `property: value` declarations. */
export function rule(
  selector: string,
  declarations: readonly string[],
  conditions: readonly string[] = [],
): CandidateRule {
  return { selector, conditions, declarations: declarations.map(decl) }
}

/** An `@property` registration. */
export function property(name: string, initialValue?: string): PropertyRule {
  return { name, syntax: '"*"', inherits: false, initialValue }
}

/** A candidate compiled to `rules`, with `properties` registered. */
export function ast(
  rules: readonly CandidateRule[],
  properties: readonly PropertyRule[] = [],
): CandidateAst {
  return { rules, properties }
}

/** A static variant whose `selectors()` result is irrelevant (the index compiles probes). */
export function variant(
  name: string,
  values: readonly string[] = [],
  hasDash = true,
): VariantEntry {
  return {
    name,
    isArbitrary: values.length > 0,
    values,
    hasDash,
    selectors: () => [],
  }
}

/** Builds a {@link TailwindDesignSystem} that answers from `input` only. */
export function fakeDesign(input: FakeDesignInput): TailwindDesignSystem {
  const names = Object.keys(input.candidates)
  const theme = input.theme ?? {}
  return {
    version: input.version ?? '4.3.3',
    prefix: input.prefix ?? null,
    classList: () =>
      (input.classList ?? names).map((name) => ({
        name,
        modifiers: [...(input.modifiers?.[name] ?? [])],
      })),
    toAst: (candidates) => candidates.map((name) => input.candidates[name] ?? null),
    classOrder: (candidates) =>
      candidates.map((name) => {
        const index = names.indexOf(name)
        return index === -1 ? null : BigInt(index)
      }),
    variants: () => [...(input.variants ?? [])],
    functionalRoots: () => [...(input.roots ?? [])].sort(),
    themeValue: (name) => theme[name],
  }
}
