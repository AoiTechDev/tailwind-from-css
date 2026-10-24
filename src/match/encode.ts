import { isDataUrl } from '../css/normalize/urls.ts'

const WHITESPACE = /[ \t\n\r\f]/
const IDENT_CHAR = /[\w-]/
// Tailwind's candidate scanner (Oxide) can't extract a class containing these.
const NOT_EXTRACTABLE = /[\n\r\f`]/
const OPENERS: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' }
const CLOSERS: ReadonlySet<string> = new Set([')', ']', '}'])

/** How a candidate is finished: the theme's `prefix()` and the important marker. */
export interface CandidateStyle {
  /** The `prefix()` of the entry CSS, without the colon, or `null`. */
  readonly prefix: string | null
  /** `false` for a normal declaration, else where the `!` goes (SPEC §3.4 `important`). */
  readonly important: false | 'suffix' | 'prefix'
  /** Variant chain, applied left to right: `['md', '[&:hover]']`. */
  readonly variants?: readonly string[]
}

/**
 * Encodes a CSS value for use inside `[…]` in a class (SPEC §5.5): whitespace outside strings
 * becomes `_` (dropped next to commas and parentheses), a literal `_` becomes `\_` except inside
 * `url()`, spaces inside strings become `_`, and `"`-quoted strings become `'`-quoted when the
 * string has no `'`. `undefined` when the value can't be part of a class (`TFC204`): a backtick,
 * a newline, unbalanced brackets, an unclosed string, or whitespace Tailwind wouldn't restore.
 *
 * @example
 * encodeValue('calc(100% - 2rem)') // 'calc(100%_-_2rem)'
 * encodeValue('"a b"')             // "'a_b'"
 */
export function encodeValue(value: string): string | undefined {
  const text = value.trim()
  let out = ''
  let depth = 0
  // Tailwind doesn't decode inside url(), so its content is copied as written.
  let urlDepth = -1
  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string
    const inUrl = urlDepth !== -1
    if (char === '\\') {
      // An escaped space would put a space into the class.
      if (WHITESPACE.test(text[index + 1] ?? '')) return undefined
      out += text.slice(index, index + 2)
      index++
    } else if (char === '"' || char === "'") {
      const end = closingQuote(text, index)
      const url = !inUrl
        ? 'none'
        : depth === urlDepth + 1 && out.endsWith('(') && isDataUrl(text.slice(index + 1, index + 6))
          ? 'data'
          : 'other'
      const string = end === -1 ? undefined : encodeString(text.slice(index + 1, end), char, url)
      if (string === undefined) return undefined
      out += string
      index = end
    } else if (WHITESPACE.test(char)) {
      while (WHITESPACE.test(text[index + 1] ?? '')) index++
      const next = text[index + 1] ?? ''
      if (out.endsWith('(') || out.endsWith(',') || next === ')' || next === ',') continue
      if (inUrl) return undefined
      out += '_'
    } else if (char === '_') {
      out += inUrl ? '_' : '\\_'
    } else {
      if (char === '(') {
        if (!inUrl && isUrlFunction(text, index)) urlDepth = depth
        depth++
      } else if (char === ')' && --depth === urlDepth) {
        urlDepth = -1
      }
      out += char
    }
  }
  return isExtractable(out) ? out : undefined
}

const isUrlFunction = (text: string, open: number): boolean =>
  text.slice(open - 3, open).toLowerCase() === 'url' && !IDENT_CHAR.test(text[open - 4] ?? ' ')

/** Index of the quote that closes the string opening at `open`, or -1. */
function closingQuote(text: string, open: number): number {
  const quote = text[open]
  for (let index = open + 1; index < text.length; index++) {
    if (text[index] === '\\') index++
    else if (text[index] === quote) return index
  }
  return -1
}

// Tailwind turns `_` back into a space inside strings too, and `\_` into `_`. A `"` string
// becomes a `'` string when that needs no escape, so the class fits in `class="…"`.
// `url` is where the string is: outside `url()`, the argument of a `data:` URL, or other.
function encodeString(
  content: string,
  quote: string,
  url: 'none' | 'data' | 'other',
): string | undefined {
  const requote = quote === '"' && !content.includes("'")
  const target = requote ? "'" : quote
  const inUrl = url !== 'none'
  // SPEC §6 N44: a space in a data: URL's body is `%20`, but not one the URL parser trims.
  const bodyEnd = content.trimEnd().length
  let inBody = false
  let out = target
  for (let index = 0; index < content.length; index++) {
    const char = content[index] as string
    if (char === '\\') {
      const next = content[index + 1] ?? ''
      // `\ ` in a string is a space, which `_` gives back.
      if (WHITESPACE.test(next) && (next !== ' ' || inUrl)) return undefined
      out += next === ' ' ? '_' : requote && next === '"' ? next : char + next
      index++
    } else if (WHITESPACE.test(char)) {
      if (char === ' ' && url === 'data' && inBody && index < bodyEnd) out += '%20'
      else if (char !== ' ' || inUrl) return undefined
      else out += '_'
    } else if (char === ',') {
      inBody = true
      out += char
    } else if (char === '_') {
      out += inUrl ? '_' : '\\_'
    } else {
      out += char
    }
  }
  return out + target
}

// Conservative: brackets inside strings count too.
function isExtractable(encoded: string): boolean {
  if (NOT_EXTRACTABLE.test(encoded)) return false
  const expected: string[] = []
  for (const char of encoded) {
    const closer = OPENERS[char]
    if (closer !== undefined) expected.push(closer)
    else if (CLOSERS.has(char) && expected.pop() !== char) return false
  }
  return expected.length === 0
}

/** `root-[value]`, or `root-[hint:value]` with a data-type hint. `encoded` is from {@link encodeValue}. */
export const arbitraryValue = (root: string, encoded: string, hint?: string): string =>
  `${root}-[${hint === undefined ? '' : `${hint}:`}${encoded}]`

/** `root-(--x)`, or `root-(hint:--x)` with a data-type hint. */
export const variableValue = (root: string, name: string, hint?: string): string =>
  `${root}-(${hint === undefined ? '' : `${hint}:`}${name})`

/** `[property:value]`. `encoded` is from {@link encodeValue}. */
export const arbitraryProperty = (property: string, encoded: string): string =>
  `[${property}:${encoded}]`

/**
 * The class for a candidate written without prefix, variants and important marker: `tw:p-4`,
 * `md:p-4!`, `tw:md:!p-4`.
 */
export function candidateName(core: string, style: CandidateStyle): string {
  const prefix = style.prefix === null ? '' : `${style.prefix}:`
  const chain = (style.variants ?? []).map((variant) => `${variant}:`).join('')
  if (style.important === 'prefix') return `${prefix}${chain}!${core}`
  return `${prefix}${chain}${core}${style.important === 'suffix' ? '!' : ''}`
}
