import type { Dimension } from './lengths.ts'

const MS_PER_UNIT: ReadonlyMap<string, number> = new Map([
  ['ms', 1],
  ['s', 1000],
])

const DEG_PER_UNIT: ReadonlyMap<string, number> = new Map([
  ['deg', 1],
  ['grad', 0.9],
  ['rad', 180 / Math.PI],
  ['turn', 360],
])

/** N15: times → `ms`. N16: angles → `deg`. Any other dimension is returned unchanged. */
export function toMsOrDeg(dimension: Dimension): Dimension {
  const ms = MS_PER_UNIT.get(dimension.unit)
  if (ms !== undefined) return { value: dimension.value * ms, unit: 'ms' }
  const deg = DEG_PER_UNIT.get(dimension.unit)
  if (deg !== undefined) return { value: dimension.value * deg, unit: 'deg' }
  return dimension
}
