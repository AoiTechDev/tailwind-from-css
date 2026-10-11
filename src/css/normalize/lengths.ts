import valueParser from 'postcss-value-parser'
import { unitlessProperties } from '../../data/css-properties.generated.ts'
import { splitTopLevel } from './split.ts'

/** A number with a lowercase unit; `''` for a plain number, `'%'` for a percentage. */
export interface Dimension {
  readonly value: number
  readonly unit: string
}

/** What `rem` and `em` resolve against, in px. `false`/`undefined` leaves the unit as written. */
export interface LengthBasis {
  readonly rootFontSize: number | false
  readonly emBasis: number | undefined
}

const UNIT = /^(?:%|[a-z]*)$/

const PX_PER_UNIT: ReadonlyMap<string, number> = new Map([
  ['px', 1],
  ['in', 96],
  ['cm', 96 / 2.54],
  ['mm', 96 / 25.4],
  ['q', 96 / 101.6],
  ['pt', 96 / 72],
  ['pc', 16],
])

const LENGTH_UNITS: ReadonlySet<string> = new Set([
  ...PX_PER_UNIT.keys(),
  ...['em', 'rem', 'ex', 'rex', 'ch', 'rch', 'ic', 'ric', 'cap', 'rcap', 'lh', 'rlh'],
  ...['vw', 'vh', 'vi', 'vb', 'vmin', 'vmax'],
  ...['svw', 'svh', 'svi', 'svb', 'svmin', 'svmax'],
  ...['lvw', 'lvh', 'lvi', 'lvb', 'lvmin', 'lvmax'],
  ...['dvw', 'dvh', 'dvi', 'dvb', 'dvmin', 'dvmax'],
  ...['cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax'],
])

const PERCENT_AS_NUMBER = /^(?:opacity|scale|[a-z-]+-opacity)$/

// Beyond this a number has no decimals left to round, and scaling it could overflow.
const ROUNDING_LIMIT = 1e15

/** Rounds to `decimals` places and prints without exponent, trailing zeros or `-0`. */
export function formatNumber(value: number, decimals = 4): string {
  if (Math.abs(value) >= ROUNDING_LIMIT) return String(value)
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** Parses `12px`, `-.5EM`, `50%`, `1e3`. `undefined` for anything that isn't a finite number. */
export function parseDimension(word: string): Dimension | undefined {
  const parsed = valueParser.unit(word)
  if (parsed === false) return undefined
  const value = Number(parsed.number)
  const unit = parsed.unit.toLowerCase()
  return Number.isFinite(value) && UNIT.test(unit) ? { value, unit } : undefined
}

export function formatDimension(dimension: Dimension): string {
  return formatNumber(dimension.value) + dimension.unit
}

// N10: absolute units always become px. `rem` needs a root font size, and `em` needs the
// element's own font size, which only the caller knows (SPEC §6).
export function toPx(dimension: Dimension, basis: LengthBasis): Dimension {
  const factor = PX_PER_UNIT.get(dimension.unit)
  if (factor !== undefined) return { value: dimension.value * factor, unit: 'px' }
  if (dimension.unit === 'rem' && basis.rootFontSize !== false) {
    return { value: dimension.value * basis.rootFontSize, unit: 'px' }
  }
  if (dimension.unit === 'em' && basis.emBasis !== undefined) {
    return { value: dimension.value * basis.emBasis, unit: 'px' }
  }
  return dimension
}

export const isLengthUnit = (unit: string): boolean => LENGTH_UNITS.has(unit)

export const isZeroLength = (dimension: Dimension): boolean =>
  dimension.value === 0 && LENGTH_UNITS.has(dimension.unit)

// N11: a bare 0 means something else where the grammar also takes a number (line-height: 0 is
// a factor) or where it is read as a flex factor (flex-basis), so those keep the unit.
export const keepsZeroUnit = (property: string): boolean =>
  property === 'flex-basis' || unitlessProperties.has(property)

// N13: for these properties the grammar defines 50% and 0.5 as the same value.
export function percentsToNumbers(property: string, value: string): string {
  if (!PERCENT_AS_NUMBER.test(property)) return value
  return splitTopLevel(value, ' ')
    .map((token) => {
      const dimension = parseDimension(token)
      return dimension?.unit === '%' ? formatNumber(dimension.value / 100) : token
    })
    .join(' ')
}
