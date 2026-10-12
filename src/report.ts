import { diagnostic } from './diagnostics.ts'
import type {
  ClassMapping,
  ConversionResult,
  Diagnostic,
  DiagnosticCode,
  SourceRef,
  UnconvertedDeclaration,
} from './types.ts'

/** A class of the result and the input declarations it came from. */
export interface ReportClass {
  readonly className: string
  readonly kind: ClassMapping['kind']
  /** Positions in {@link ReportInput.sources}. */
  readonly sources: readonly number[]
}

/** Why a declaration, or one longhand of it, got no class. */
export type UnconvertedCode = 'TFC102' | 'TFC204' | 'TFC303' | 'TFC402' | 'TFC502'

/** Something worth a diagnostic that leaves nothing unconverted. */
export type NoteCode = 'TFC105' | 'TFC106' | 'TFC301' | 'TFC302' | 'TFC401' | 'TFC501'

/** A diagnostic about one input declaration. */
export interface ReportEntry<Code extends DiagnosticCode> {
  /** Position in {@link ReportInput.sources}. */
  readonly source: number
  readonly code: Code
  /**
   * For a declaration that was expanded into longhands, the longhand concerned, written as CSS
   * that can be kept as is. Absent when the declaration as written is concerned.
   */
  readonly longhand?: { readonly property: string; readonly value: string }
}

/** Everything the pipeline found out about one element. */
export interface ReportInput {
  /** Every input declaration, valid or not, in input order. */
  readonly sources: readonly SourceRef[]
  readonly classes: readonly ReportClass[]
  readonly unconverted: readonly ReportEntry<UnconvertedCode>[]
  readonly notes: readonly ReportEntry<NoteCode>[]
}

type MessageCode = UnconvertedCode | NoteCode

const declarationText = (source: SourceRef): string =>
  `"${source.property}: ${source.value}${source.important ? ' !important' : ''}"`

const contextText = (source: SourceRef): string =>
  source.conditions.length === 0
    ? source.selector
    : `${source.conditions.join(' ')} { ${source.selector} }`

const MESSAGES: Readonly<Record<MessageCode, (source: SourceRef) => string>> = {
  TFC102: (s) => `Invalid declaration ${declarationText(s)} in ${contextText(s)} skipped.`,
  TFC105: (s) =>
    `${declarationText(s)} in ${contextText(s)} repeats an unprefixed declaration and was dropped.`,
  TFC106: (s) =>
    `${declarationText(s)} in ${contextText(s)} is overridden wherever it applies and was dropped.`,
  TFC204: (s) => `${declarationText(s)} in ${contextText(s)} can't be written as a class.`,
  TFC301: (s) => `The selector of ${contextText(s)} needs an arbitrary variant.`,
  TFC302: (s) => `The conditions of ${contextText(s)} need an arbitrary variant.`,
  TFC303: (s) => `${declarationText(s)}: ${contextText(s)} can't be written as a variant.`,
  TFC401: (s) =>
    `${declarationText(s)} in ${contextText(s)} needs a stacked class to win where other contexts ` +
    'apply too.',
  TFC402: (s) =>
    `${declarationText(s)} in ${contextText(s)} would win where the source says it loses, and no ` +
    'stacked class can fix that.',
  TFC501: (s) =>
    `The class for ${declarationText(s)} in ${contextText(s)} failed verification and was ` +
    'replaced. Please report this.',
  TFC502: (s) =>
    `${declarationText(s)} in ${contextText(s)} failed verification even as an arbitrary property.`,
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const copy = (source: SourceRef): SourceRef => ({ ...source, conditions: [...source.conditions] })

function refOf(
  input: ReportInput,
  position: number,
  longhand?: ReportEntry<MessageCode>['longhand'],
): SourceRef {
  const source = copy(input.sources[position] as SourceRef)
  return longhand === undefined ? source : { ...source, ...longhand }
}

const entryKey = (entry: ReportEntry<MessageCode>): string =>
  [entry.source, entry.code, entry.longhand?.property ?? ''].join('\0')

function unique<Code extends MessageCode>(
  entries: readonly ReportEntry<Code>[],
): ReportEntry<Code>[] {
  const byKey = new Map(entries.map((entry) => [entryKey(entry), entry]))
  return [...byKey.values()].sort(
    (a, b) =>
      a.source - b.source ||
      compareText(a.longhand?.property ?? '', b.longhand?.property ?? '') ||
      compareText(a.code, b.code),
  )
}

interface Sorted {
  readonly mapping: ClassMapping
  /** Its first source, for diagnostics. */
  readonly first: number
}

/** Classes sorted by Tailwind's order (unknown ones last), then by name, each once. */
function mappingsOf(
  input: ReportInput,
  classOrder: (classes: readonly string[]) => readonly (bigint | null)[],
): Sorted[] {
  const byName = new Map<string, { kind: ClassMapping['kind']; sources: Set<number> }>()
  for (const entry of input.classes) {
    const known = byName.get(entry.className)
    if (known === undefined) {
      byName.set(entry.className, { kind: entry.kind, sources: new Set(entry.sources) })
    } else for (const source of entry.sources) known.sources.add(source)
  }
  const names = [...byName.keys()]
  const orders = classOrder(names)
  return names
    .map((name, position) => ({ name, order: orders[position] ?? null }))
    .sort((a, b) => {
      if (a.order === b.order) return compareText(a.name, b.name)
      if (a.order === null) return 1
      if (b.order === null) return -1
      return a.order < b.order ? -1 : 1
    })
    .map(({ name }) => {
      const { kind, sources } = byName.get(name) as {
        kind: ClassMapping['kind']
        sources: Set<number>
      }
      const positions = [...sources].sort((a, b) => a - b)
      return {
        mapping: {
          className: name,
          kind,
          sources: positions.map((source) => copy(input.sources[source] as SourceRef)),
        },
        first: positions[0] ?? 0,
      }
    })
}

const ARBITRARY: Partial<Record<ClassMapping['kind'], ['TFC201' | 'TFC202', string]>> = {
  'arbitrary-value': ['TFC201', 'an arbitrary value'],
  'arbitrary-property': ['TFC202', 'an arbitrary property'],
}

/**
 * Assembles the result for one element (SPEC §5.9): classes in Tailwind's order
 * (`getClassOrder`, the order `prettier-plugin-tailwindcss` uses) and each once, a mapping per
 * class with its sources, the unconverted declarations, and diagnostics, all sorted so the same
 * input gives a byte-identical result. `TFC201`/`TFC202` follow from the class kinds.
 *
 * @example
 * report({ sources, classes: [{ className: 'p-4', kind: 'bare', sources: [0] }], unconverted: [], notes: [] }, order)
 * // { className: 'p-4', classes: ['p-4'], mappings: [{ className: 'p-4', kind: 'bare', sources: [source] }], … }
 */
export function report(
  input: ReportInput,
  classOrder: (classes: readonly string[]) => readonly (bigint | null)[],
): ConversionResult {
  const sorted = mappingsOf(input, classOrder)
  const unconverted = unique(input.unconverted)
  const diagnostics: { at: number; diagnostic: Diagnostic }[] = []
  for (const entry of [...unique(input.notes), ...unconverted]) {
    const source = refOf(input, entry.source, entry.longhand)
    const message = MESSAGES[entry.code](source)
    diagnostics.push({ at: entry.source, diagnostic: diagnostic(entry.code, message, source) })
  }
  for (const { mapping, first } of sorted) {
    const arbitrary = ARBITRARY[mapping.kind]
    if (arbitrary === undefined) continue
    const [code, what] = arbitrary
    const message = `${mapping.className} uses ${what}.`
    diagnostics.push({ at: first, diagnostic: diagnostic(code, message, refOf(input, first)) })
  }
  diagnostics.sort(
    (a, b) =>
      a.at - b.at ||
      compareText(a.diagnostic.code, b.diagnostic.code) ||
      compareText(a.diagnostic.message, b.diagnostic.message),
  )
  const mappings = sorted.map((entry) => entry.mapping)
  const classes = mappings.map((mapping) => mapping.className)
  return {
    className: classes.join(' '),
    classes,
    mappings,
    unconverted: unconverted.map(
      (entry): UnconvertedDeclaration => ({
        ...refOf(input, entry.source, entry.longhand),
        code: entry.code,
      }),
    ),
    diagnostics: diagnostics.map((entry) => entry.diagnostic),
    exact:
      unconverted.length === 0 && mappings.every((mapping) => mapping.relaxation === undefined),
  }
}
