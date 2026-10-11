import { splitTopLevel } from './split.ts'
import { decodeEscapes, quoteString } from './strings.ts'

const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
])

const WEIGHT_KEYWORDS: ReadonlyMap<string, string> = new Map([
  ['normal', '400'],
  ['bold', '700'],
])

// N41: generic families are keywords, so they're lowercased and never quoted (a quoted "serif"
// is a font named serif). A family of several unquoted words is a name and can't be a keyword,
// so it's quoted. A single unquoted word stays unquoted: browsers treat some of them as
// keywords (`-apple-system`, `BlinkMacSystemFont`), and quoting those changes the font.
function normalizeFamily(family: string): string {
  const words = splitTopLevel(family, ' ')
  const [first = ''] = words
  if (words.length > 1) return quoteString(decodeEscapes(words.join(' ')))
  const lower = first.toLowerCase()
  return GENERIC_FAMILIES.has(lower) ? lower : first
}

/** Normal form of an already value-normalized `font-family` list. */
export function normalizeFontFamily(value: string): string {
  return splitTopLevel(value, ',').map(normalizeFamily).join(',')
}

// N43: `normal` and `bold` compute to 400 and 700. `bolder`/`lighter` depend on the parent.
/** Normal form of an already value-normalized `font-weight`. */
export const normalizeFontWeight = (value: string): string => WEIGHT_KEYWORDS.get(value) ?? value
