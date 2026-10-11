import { type NormalizeOptions, normalizeDeclaration } from '../../src/css/normalize/index.ts'

const DEFAULTS: NormalizeOptions = { rootFontSize: 16 }

/** Normal form of one declaration as `longhand: value` pairs joined by `; `. */
export function normal(
  property: string,
  value: string,
  options: Partial<NormalizeOptions> = {},
): string {
  return normalizeDeclaration({ property, value }, { ...DEFAULTS, ...options })
    .map((declaration) => `${declaration.property}: ${declaration.value}`)
    .join('; ')
}

/** Normal value of a declaration that stays a single longhand. */
export function normalValue(
  property: string,
  value: string,
  options: Partial<NormalizeOptions> = {},
): string {
  const declarations = normalizeDeclaration({ property, value }, { ...DEFAULTS, ...options })
  const [only] = declarations
  if (only === undefined || declarations.length !== 1) {
    throw new Error(`${property}: ${value} normalizes to ${declarations.length} declarations`)
  }
  return only.value
}
