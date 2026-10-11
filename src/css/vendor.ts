import {
  type NormalDeclaration,
  type NormalizeOptions,
  normalizeDeclaration,
  normalValuesEqual,
} from './normalize/index.ts'

const VENDOR_PREFIX = /^-(?:webkit|moz|ms|o)-/

/**
 * Positions of vendor-prefixed declarations that repeat an unprefixed one of the same block
 * (SPEC §5.4 step 6): `-webkit-X: v` where the block sets `X` to `v` with the same importance.
 * The prefixed value is read as `X`'s, so `-webkit-border-radius: 4px` repeats the four
 * `border-*-radius` longhands. `declarations` holds one declaration per property.
 *
 * @example
 * redundantVendorDeclarations(normalizeDeclarations(
 *   [{ property: '-webkit-user-select', value: 'none' }, { property: 'user-select', value: 'none' }],
 *   { rootFontSize: 16 },
 * ), { rootFontSize: 16 }) // Set { 0 }
 */
export function redundantVendorDeclarations(
  declarations: readonly NormalDeclaration[],
  options: NormalizeOptions,
): Set<number> {
  const redundant = new Set<number>()
  if (!declarations.some((declaration) => VENDOR_PREFIX.test(declaration.property))) {
    return redundant
  }
  const byProperty = new Map(declarations.map((declaration) => [declaration.property, declaration]))
  declarations.forEach((declaration, position) => {
    const unprefixed = declaration.property.replace(VENDOR_PREFIX, '')
    if (unprefixed === declaration.property) return
    const longhands = normalizeDeclaration(
      { property: unprefixed, value: declaration.value, important: declaration.important },
      options,
    )
    const repeated = longhands.every((longhand) => {
      const own = byProperty.get(longhand.property)
      return (
        own !== undefined &&
        own.important === longhand.important &&
        normalValuesEqual(own.value, longhand.value)
      )
    })
    if (repeated) redundant.add(position)
  })
  return redundant
}
