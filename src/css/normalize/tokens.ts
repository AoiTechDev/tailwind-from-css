import { isLengthUnit, parseDimension } from './lengths.ts'

// Classifiers for tokens of an already normalized value: lowercase keywords, colors in their
// normal form, zero lengths as `0`, math functions folded where possible.

const MATH = /^(?:calc|min|max|clamp)\(/
const COLOR_FUNCTION = /^(?:srgb|rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/
const IMAGE_FUNCTION =
  /^(?:url|image|image-set|cross-fade|element|paint|(?:repeating-)?(?:linear|radial|conic)-gradient)\(/

const SYSTEM_COLORS: ReadonlySet<string> = new Set([
  'accentcolor',
  'accentcolortext',
  'activetext',
  'buttonborder',
  'buttonface',
  'buttontext',
  'canvas',
  'canvastext',
  'field',
  'fieldtext',
  'graytext',
  'highlight',
  'highlighttext',
  'linktext',
  'mark',
  'marktext',
  'selecteditem',
  'selecteditemtext',
  'visitedtext',
])

export const isNumberToken = (token: string): boolean => parseDimension(token)?.unit === ''

const isPercentageToken = (token: string): boolean => parseDimension(token)?.unit === '%'

export function isLengthToken(token: string): boolean {
  const unit = parseDimension(token)?.unit
  return token === '0' || MATH.test(token) || (unit !== undefined && isLengthUnit(unit))
}

export const isLengthPercentageToken = (token: string): boolean =>
  isLengthToken(token) || isPercentageToken(token)

export const isColorToken = (token: string): boolean =>
  token === 'currentcolor' || SYSTEM_COLORS.has(token) || COLOR_FUNCTION.test(token)

export const isImageToken = (token: string): boolean => IMAGE_FUNCTION.test(token)
