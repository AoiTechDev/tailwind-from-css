import { TfcError } from './errors.ts'
import type { Mode, RelaxationName, ResolvedOptions } from './types.ts'

/** Every relaxation of SPEC §4. The `nearest` preset turns all of them on. */
export const RELAXATION_NAMES: readonly RelaxationName[] = Object.freeze([
  'hover-media',
  'logical-properties',
  'color-nearest',
  'length-nearest',
  'breakpoint-nearest',
  'font-weight-nearest',
  'text-line-height',
  'pill-radius',
] satisfies RelaxationName[])

const PRESETS: Readonly<Record<Mode, readonly RelaxationName[]>> = {
  exact: [],
  nearest: RELAXATION_NAMES,
}

const DEFAULT_CSS = '@import "tailwindcss";'
const DEFAULT_TOLERANCE = { colorDeltaE: 0.02, lengthPx: 2, lengthRatio: 0.1, breakpointPx: 16 }
const TOP_KEYS = ['mode', 'relax', 'tailwind', 'rootFontSize', 'tolerance', 'important']
const TAILWIND_KEYS = ['css', 'base']
const TOLERANCE_KEYS = Object.keys(DEFAULT_TOLERANCE)

type Fields = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRelaxation = (value: string): value is RelaxationName =>
  (RELAXATION_NAMES as readonly string[]).includes(value)

function invalid(message: string): TfcError {
  return new TfcError('TFC904', `Invalid options: ${message}`)
}

function shown(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return 'an array'
  if (value === null) return 'null'
  return typeof value === 'object' ? 'an object' : String(value)
}

function objectAt(value: unknown, path: string, keys: readonly string[]): Fields {
  if (value === undefined) return {}
  if (!isRecord(value)) throw invalid(`${path} must be an object, got ${shown(value)}.`)
  for (const key of Object.keys(value).sort()) {
    if (!keys.includes(key)) {
      throw invalid(`unknown option ${path === 'options' ? key : `${path}.${key}`}.`)
    }
  }
  return value
}

function oneOf<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  throw invalid(
    `${path} must be ${allowed.map((v) => `"${v}"`).join(' or ')}, got ${shown(value)}.`,
  )
}

function relaxations(mode: Mode, relax: unknown): readonly RelaxationName[] {
  const active = new Set(PRESETS[mode])
  if (relax === undefined) return [...active].sort()
  if (!Array.isArray(relax)) throw invalid(`relax must be an array, got ${shown(relax)}.`)
  for (const entry of relax as unknown[]) {
    const name = typeof entry === 'string' ? entry.replace(/^!/, '') : ''
    if (typeof entry !== 'string' || !isRelaxation(name)) {
      throw invalid(`relax has an unknown relaxation ${shown(entry)}.`)
    }
    if (entry.startsWith('!')) active.delete(name)
    else active.add(name)
  }
  return [...active].sort()
}

function rootFontSize(value: unknown): number | false {
  if (value === undefined) return 16
  if (value === false || (typeof value === 'number' && Number.isFinite(value) && value > 0)) {
    return value
  }
  throw invalid(`rootFontSize must be a positive number or false, got ${shown(value)}.`)
}

function tolerance(value: unknown): ResolvedOptions['tolerance'] {
  const given = objectAt(value, 'tolerance', TOLERANCE_KEYS)
  const resolved = { ...DEFAULT_TOLERANCE }
  for (const key of TOLERANCE_KEYS as (keyof typeof DEFAULT_TOLERANCE)[]) {
    const entry = given[key]
    if (entry === undefined) continue
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0) {
      throw invalid(`tolerance.${key} must be a number ≥ 0, got ${shown(entry)}.`)
    }
    resolved[key] = entry
  }
  return Object.freeze(resolved)
}

function tailwind(value: unknown, base: string): ResolvedOptions['tailwind'] {
  const given = objectAt(value, 'tailwind', TAILWIND_KEYS)
  if (given.css !== undefined && typeof given.css !== 'string') {
    throw invalid(`tailwind.css must be a string, got ${shown(given.css)}.`)
  }
  if (given.base !== undefined && (typeof given.base !== 'string' || given.base === '')) {
    throw invalid(`tailwind.base must be a non-empty string, got ${shown(given.base)}.`)
  }
  return Object.freeze({ css: given.css ?? DEFAULT_CSS, base: given.base ?? base })
}

/**
 * Validates converter options and applies every default (SPEC §3.4): the mode preset plus
 * `relax`, applied in order, gives the sorted relaxation list. The result is frozen. Unknown keys
 * and bad values throw.
 *
 * @throws {TfcError} `TFC904` for unknown keys or invalid values.
 * @example
 * resolveOptions({ mode: 'nearest', relax: ['!hover-media'] }, { base: process.cwd() }).relaxations
 * // ['breakpoint-nearest', 'color-nearest', … without 'hover-media']
 */
export function resolveOptions(
  options: unknown,
  defaults: { readonly base: string },
): ResolvedOptions {
  const given = objectAt(options, 'options', TOP_KEYS)
  const mode = oneOf(given.mode, 'mode', ['exact', 'nearest'], 'exact')
  return Object.freeze({
    mode,
    relaxations: Object.freeze(relaxations(mode, given.relax)),
    tailwind: tailwind(given.tailwind, defaults.base),
    rootFontSize: rootFontSize(given.rootFontSize),
    tolerance: tolerance(given.tolerance),
    important: oneOf(given.important, 'important', ['suffix', 'prefix'], 'suffix'),
  })
}
