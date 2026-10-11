import type { Declaration } from '../../types.ts'
import { equalWithColorTolerance } from './colors.ts'
import { canonicalProperty, expandShorthand } from './shorthands.ts'
import { normalizeValue } from './values.ts'

/** A longhand declaration whose value is in normal form (SPEC §6). */
export interface NormalDeclaration {
  readonly property: string
  readonly value: string
  readonly important: boolean
}

/** Inputs of normalization besides the declarations. */
export interface NormalizeOptions {
  /** px per rem, or `false` to keep rem apart from px (SPEC §3.4). */
  readonly rootFontSize: number | false
  /**
   * The element's own font size in px, for `em` (N10). {@link normalizeDeclarations} finds it in
   * the block; pass it only when normalizing single declarations of a block you have resolved.
   */
  readonly emBasis?: number | undefined
  /** Values of custom properties, substituted for `var()` before folding (`--spacing`, N12). */
  readonly variables?: ReadonlyMap<string, string> | undefined
}

const PX = /^(\d+(?:\.\d+)?)px$/

/**
 * Normalizes one declaration: the property is lowercased and de-aliased, shorthands are
 * expanded to longhands where every component parses (N01), and each value gets its normal form.
 *
 * @example
 * normalizeDeclaration({ property: 'margin', value: '0 1rem' }, { rootFontSize: 16 })
 * // margin-top: 0, margin-right: 16px, margin-bottom: 0, margin-left: 16px
 */
export function normalizeDeclaration(
  declaration: Declaration,
  options: NormalizeOptions,
): NormalDeclaration[] {
  const property = canonicalProperty(declaration.property)
  const important = declaration.important === true
  const valueOptions = {
    rootFontSize: options.rootFontSize,
    emBasis: options.emBasis,
    variables: options.variables,
  }
  const value = normalizeValue(property, declaration.value, valueOptions)
  const longhands = property.startsWith('--') ? undefined : expandShorthand(property, value)
  if (longhands === undefined) return [{ property, value, important }]
  return longhands.map(([longhand, longhandValue]) => ({
    property: longhand,
    value: normalizeValue(longhand, longhandValue, valueOptions),
    important,
  }))
}

function winningFontSize(declarations: readonly NormalDeclaration[]): string | undefined {
  let winner: NormalDeclaration | undefined
  for (const declaration of declarations) {
    if (declaration.property !== 'font-size') continue
    if (winner === undefined || declaration.important || !winner.important) winner = declaration
  }
  return winner?.value
}

// N10: `em` resolves against the element's own font size, which is known only when the same
// block sets an absolute one. Normalizing twice keeps the rule out of every value parser.
/**
 * Normalizes the declarations of one block (one element, one context), in order. Nothing is
 * deduplicated: later declarations still win in the caller's cascade.
 */
export function normalizeDeclarations(
  declarations: readonly Declaration[],
  options: NormalizeOptions,
): NormalDeclaration[] {
  const withoutBasis = { ...options, emBasis: undefined }
  const normalized = declarations.flatMap((declaration) =>
    normalizeDeclaration(declaration, withoutBasis),
  )
  const fontSize = PX.exec(winningFontSize(normalized) ?? '')
  if (fontSize === null) return normalized
  const withBasis = { ...options, emBasis: Number(fontSize[1]) }
  return declarations.flatMap((declaration) => normalizeDeclaration(declaration, withBasis))
}

/**
 * Whether two normal values are equal. Exact string equality, except that `srgb()` channels may
 * differ by less than half an 8-bit step (N20).
 */
export const normalValuesEqual = (a: string, b: string): boolean => equalWithColorTolerance(a, b)

export { normalizeValue } from './values.ts'
