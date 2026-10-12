import { colorDifference } from '../css/normalize/colors.ts'
import { cssText, type NormalDeclaration, normalValuesEqual } from '../css/normalize/index.ts'
import { type Dimension, formatNumber, parseDimension } from '../css/normalize/lengths.ts'
import { type Context, contextKey, normalizeContext } from '../tailwind/effective.ts'
import type { IndexedUtility, UtilityIndex } from '../tailwind/index-builder.ts'
import type { RelaxationName, ResolvedOptions } from '../types.ts'
import { type VariantResolver, type VariantResult, variantChain } from './variants.ts'

/** One relaxation applied to a class (SPEC §4): what changed, and by how much. */
export interface Relaxation {
  readonly name: RelaxationName
  readonly detail: string
  readonly delta?: number
}

/** The relaxations a converter may apply, with their tolerances (SPEC §3.4). */
export interface RelaxSettings {
  readonly relaxations: ReadonlySet<RelaxationName>
  readonly tolerance: ResolvedOptions['tolerance']
}

/** How a class's value compares with the wanted one: `delta` 0 and no relaxation when equal. */
export interface ValueMatch {
  readonly delta: number
  readonly relaxation?: Relaxation
}

/** A context a block may use instead of its own, and the relaxations that got it there. */
export interface RelaxedContext {
  readonly context: Context
  readonly relaxations: readonly Relaxation[]
}

/** An indexed utility and its declaration of one longhand. */
export interface UtilitySetting {
  readonly utility: IndexedUtility
  readonly declaration: NormalDeclaration
}

const EXACT: ValueMatch = { delta: 0 }
// SPEC §4 `pill-radius`: Tailwind's `rounded-full` (N12 keeps infinity as written).
const INFINITE_LENGTH = 'calc(infinity * 1px)'
const PILL_MIN_PX = 1000
const RADIUS = /radius$/
// SPEC §4 `length-nearest`: spacing, sizing, inset, gap, radius, font-size, letter-spacing and
// line-height.
const NEAREST_LENGTH =
  /^(?:(?:scroll-)?(?:margin|padding)(?:-.+)?|(?:row-|column-)?gap|(?:min-|max-)?(?:width|height|inline-size|block-size)|flex-basis|top|right|bottom|left|inset-.+|border-.*radius|font-size|letter-spacing|line-height)$/
const HOVER = /:hover(?![\w-])/
const HOVER_MEDIA = '@media (hover: hover)'
const RANGE = /\(width (>=|>|<=|<) (\d+(?:\.\d+)?)px\)/g
const BREAKPOINT = /^&\n(@media|@container(?: [\w-]+)?) \(width (>=|<) (\d+(?:\.\d+)?)px\)$/
const RANGE_HEAD = /^(@media|@container(?: [\w-]+)?) /
const DECIMALS = 4

const SIDES = ['top', 'right', 'bottom', 'left'] as const
const FLOW: Readonly<Record<(typeof SIDES)[number], string>> = {
  top: 'block-start',
  right: 'inline-end',
  bottom: 'block-end',
  left: 'inline-start',
}
const CORNERS: Readonly<Record<string, string>> = {
  'top-left': 'start-start',
  'top-right': 'start-end',
  'bottom-left': 'end-start',
  'bottom-right': 'end-end',
}

// SPEC §4 `logical-properties` assumes a left-to-right, horizontal writing mode, where these
// pairs set the same side or corner of the box.
const LOGICAL: ReadonlyMap<string, string> = new Map([
  ...SIDES.map((side): [string, string] => [side, `inset-${FLOW[side]}`]),
  ...['margin', 'padding', 'scroll-margin', 'scroll-padding'].flatMap((box) =>
    SIDES.map((side): [string, string] => [`${box}-${side}`, `${box}-${FLOW[side]}`]),
  ),
  ...['width', 'style', 'color'].flatMap((kind) =>
    SIDES.map((side): [string, string] => [
      `border-${side}-${kind}`,
      `border-${FLOW[side]}-${kind}`,
    ]),
  ),
  ...Object.entries(CORNERS).map(([corner, flow]): [string, string] => [
    `border-${corner}-radius`,
    `border-${flow}-radius`,
  ]),
])
const PHYSICAL: ReadonlyMap<string, string> = new Map(
  [...LOGICAL].map(([physical, logical]) => [logical, physical]),
)

/** The relaxations of resolved options, or `undefined` when there are none (`exact`). */
export function relaxSettings(options: ResolvedOptions): RelaxSettings | undefined {
  return options.relaxations.length === 0
    ? undefined
    : { relaxations: new Set(options.relaxations), tolerance: options.tolerance }
}

/** The logical longhand that sets the same side as `physical` in LTR (`margin-left` → `margin-inline-start`). */
export const logicalProperty = (physical: string): string | undefined => LOGICAL.get(physical)

/** The physical longhand of a logical one in LTR (`margin-inline-start` → `margin-left`). */
export const physicalProperty = (logical: string): string | undefined => PHYSICAL.get(logical)

/** A relaxation that renders `physical` as `logical`. */
export const logicalRelaxation = (physical: string, logical: string): Relaxation => ({
  name: 'logical-properties',
  detail: `${physical} as ${logical}`,
})

/** The relaxation that lets a class add a line-height the input doesn't set. */
export const lineHeightRelaxation = (value: string): Relaxation => ({
  name: 'text-line-height',
  detail: `adds line-height: ${cssText(value)}`,
})

const rounded = (value: number): number => Number(formatNumber(value, DECIMALS))

function valueRelaxation(
  name: RelaxationName,
  property: string,
  wanted: string,
  got: string,
  delta?: number,
): ValueMatch {
  const detail = `${property}: ${cssText(wanted)} → ${cssText(got)}`
  return delta === undefined
    ? { delta: 0, relaxation: { name, detail } }
    : { delta: rounded(delta), relaxation: { name, detail, delta: rounded(delta) } }
}

const px = (value: string): Dimension | undefined => {
  const dimension = parseDimension(value)
  return dimension?.unit === 'px' ? dimension : undefined
}

/**
 * Whether a class may set `property` to `got` where the input wants `wanted` (both normal
 * values), under the enabled value relaxations of SPEC §4: `pill-radius` (≥ 1000px →
 * `calc(infinity * 1px)`), `length-nearest` (px, within `lengthPx` **and** `lengthRatio`),
 * `font-weight-nearest` (any distance; the nearest is picked by the caller), `color-nearest`
 * (ΔE OK ≤ `colorDeltaE`, equal alpha). Equal values match with no relaxation.
 *
 * @example
 * relaxedValue(settings, 'padding-top', '13.3px', '14px')
 * // { delta: 0.7, relaxation: { name: 'length-nearest', detail: 'padding-top: 13.3px → 14px', delta: 0.7 } }
 */
export function relaxedValue(
  settings: RelaxSettings,
  property: string,
  wanted: string,
  got: string,
): ValueMatch | undefined {
  if (normalValuesEqual(wanted, got)) return EXACT
  const { relaxations, tolerance } = settings
  if (relaxations.has('pill-radius') && RADIUS.test(property) && got === INFINITE_LENGTH) {
    const length = px(wanted)
    if (length !== undefined && length.value >= PILL_MIN_PX) {
      return valueRelaxation('pill-radius', property, wanted, got)
    }
  }
  if (relaxations.has('length-nearest') && NEAREST_LENGTH.test(property)) {
    const from = px(wanted)
    const to = px(got)
    if (from !== undefined && to !== undefined) {
      const delta = Math.abs(from.value - to.value)
      if (delta <= tolerance.lengthPx && delta <= tolerance.lengthRatio * Math.abs(from.value)) {
        return valueRelaxation('length-nearest', property, wanted, got, delta)
      }
    }
  }
  if (relaxations.has('font-weight-nearest') && property === 'font-weight') {
    const from = parseDimension(wanted)
    const to = parseDimension(got)
    if (from?.unit === '' && to?.unit === '') {
      const delta = Math.abs(from.value - to.value)
      return valueRelaxation('font-weight-nearest', property, wanted, got, delta)
    }
  }
  if (relaxations.has('color-nearest') && !property.startsWith('--')) {
    const difference = colorDifference(wanted, got)
    if (
      difference !== undefined &&
      normalValuesEqual(formatNumber(difference.alphas[0]), formatNumber(difference.alphas[1])) &&
      difference.distance <= tolerance.colorDeltaE
    ) {
      return valueRelaxation('color-nearest', property, wanted, got, difference.distance)
    }
  }
  return undefined
}

/**
 * Bare spacing tokens near `value` for `length-nearest`: the multiples of 0.5 of `--spacing` just
 * below and above it (`13.3px` with `4px` → `3`, `3.5`). Signs are dropped, as negative roots
 * carry them.
 */
export function nearestSpacingTokens(value: string, spacing: Dimension | undefined): string[] {
  const length = parseDimension(value)
  if (length === undefined || spacing === undefined || length.unit !== spacing.unit) return []
  const steps = (Math.abs(length.value) / spacing.value) * 2
  return [...new Set([Math.floor(steps), Math.ceil(steps)])].map((step) => formatNumber(step / 2))
}

const settingCache = new WeakMap<UtilityIndex, Map<string, UtilitySetting[]>>()

/** Every indexed utility that sets `property`, with its declaration of it, by preference. */
export function utilitiesSetting(index: UtilityIndex, property: string): readonly UtilitySetting[] {
  let byProperty = settingCache.get(index)
  if (byProperty === undefined) {
    byProperty = new Map()
    const seen = new Set<string>()
    for (const utilities of index.byLonghand.values()) {
      for (const utility of utilities) {
        if (seen.has(utility.candidate)) continue
        seen.add(utility.candidate)
        for (const declaration of utility.declarations) {
          const list = byProperty.get(declaration.property) ?? []
          list.push({ utility, declaration })
          byProperty.set(declaration.property, list)
        }
      }
    }
    settingCache.set(index, byProperty)
  }
  return byProperty.get(property) ?? []
}

/** Variants with arbitrary parts: a chain with fewer reads better. `TFC303` counts as worst. */
const arbitraryParts = (chain: VariantResult): number =>
  'code' in chain
    ? Number.POSITIVE_INFINITY
    : chain.variants.filter((variant) => variant.includes('[')).length

type Breakpoints = Map<string, { readonly operator: string; readonly value: number }[]>

const breakpointCache = new WeakMap<UtilityIndex, Breakpoints>()

// Width conditions the theme names as variants (`md`, `max-md`, `@md`), by at-rule and side.
function breakpointsOf(index: UtilityIndex): Breakpoints {
  let found = breakpointCache.get(index)
  if (found === undefined) {
    found = new Map()
    for (const key of index.variants.keys()) {
      const match = BREAKPOINT.exec(key)
      if (match === null) continue
      const [, head = '', operator = '', value = ''] = match
      const side = `${head}\u0000${operator === '>=' ? 'min' : 'max'}`
      found.set(side, [...(found.get(side) ?? []), { operator, value: Number(value) }])
    }
    breakpointCache.set(index, found)
  }
  return found
}

// SPEC §4 `breakpoint-nearest`: each width bound snaps to the nearest named one on its side
// within `breakpointPx` (ties to the smaller width).
function snapBreakpoints(
  index: UtilityIndex,
  settings: RelaxSettings,
  conditions: readonly string[],
): { conditions: string[]; relaxations: Relaxation[] } {
  const breakpoints = breakpointsOf(index)
  const relaxations: Relaxation[] = []
  const snapped = conditions.map((condition) => {
    const head = RANGE_HEAD.exec(condition)?.[1]
    if (head === undefined) return condition
    return condition.replace(RANGE, (range, operator: string, text: string) => {
      const value = Number(text)
      const side = `${head}\u0000${operator.startsWith('>') ? 'min' : 'max'}`
      const nearest = (breakpoints.get(side) ?? [])
        .map((breakpoint) => ({ ...breakpoint, delta: Math.abs(breakpoint.value - value) }))
        .filter((breakpoint) => breakpoint.delta <= settings.tolerance.breakpointPx)
        .sort((a, b) => a.delta - b.delta || a.value - b.value)[0]
      if (nearest === undefined) return range
      const replacement = `(width ${nearest.operator} ${formatNumber(nearest.value)}px)`
      if (replacement === range) return range
      relaxations.push({
        name: 'breakpoint-nearest',
        detail: `${range} → ${replacement}`,
        delta: rounded(nearest.delta),
      })
      return replacement
    })
  })
  return { conditions: snapped, relaxations }
}

/**
 * The context a block may use instead of its own under SPEC §4's context relaxations, when that
 * reads better (fewer arbitrary variants): `hover-media` adds `@media (hover: hover)` to a
 * `:hover` context (so `hover:` fits, ADR-0006), `breakpoint-nearest` snaps width bounds to the
 * theme's breakpoints. `undefined` when neither helps. The caller compares against this context
 * from then on (SPEC §5.7).
 *
 * @example
 * relaxContext(resolver, settings, { selector: '&:hover', conditions: [] }, new Set(['color']))
 * // { context: { selector: '&:hover', conditions: ['@media (hover: hover)'] }, relaxations: [hover-media] }
 */
export function relaxContext(
  resolver: VariantResolver,
  settings: RelaxSettings,
  context: Context,
  properties: ReadonlySet<string>,
): RelaxedContext | undefined {
  const { options, index } = resolver
  let current = normalizeContext(context, options)
  let cost = arbitraryParts(variantChain(resolver, current, properties))
  const relaxations: Relaxation[] = []
  const tryContext = (next: Context, applied: readonly Relaxation[]): void => {
    const normal = normalizeContext(next, options)
    if (contextKey(normal) === contextKey(current)) return
    const nextCost = arbitraryParts(variantChain(resolver, normal, properties))
    if (nextCost >= cost) return
    current = normal
    cost = nextCost
    relaxations.push(...applied)
  }
  if (settings.relaxations.has('hover-media') && HOVER.test(current.selector)) {
    tryContext({ selector: current.selector, conditions: [...current.conditions, HOVER_MEDIA] }, [
      { name: 'hover-media', detail: `:hover as hover: (adds ${HOVER_MEDIA})` },
    ])
  }
  if (settings.relaxations.has('breakpoint-nearest')) {
    const snapped = snapBreakpoints(index, settings, current.conditions)
    if (snapped.relaxations.length > 0) {
      tryContext(
        { selector: current.selector, conditions: snapped.conditions },
        snapped.relaxations,
      )
    }
  }
  return relaxations.length === 0 ? undefined : { context: current, relaxations }
}
