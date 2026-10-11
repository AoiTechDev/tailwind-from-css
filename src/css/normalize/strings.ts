const HEX_ESCAPE = /^[0-9a-f]{1,6}/i
const WHITESPACE = /^[ \t\n\r\f]$/
const NEWLINE = /^(?:\r\n|[\n\r\f])/
const MAX_CODE_POINT = 0x10ffff

/** Resolves CSS escapes (`\"`, `\201C `, line continuations) to the characters they stand for. */
export function decodeEscapes(raw: string): string {
  let out = ''
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    if (char !== '\\') {
      out += char
      continue
    }
    const rest = raw.slice(index + 1)
    const newline = NEWLINE.exec(rest)
    if (newline) {
      index += newline[0].length
      continue
    }
    const hex = HEX_ESCAPE.exec(rest)
    if (hex) {
      const code = Number.parseInt(hex[0], 16)
      index += hex[0].length
      if (WHITESPACE.test(raw[index + 1] ?? '')) index++
      const valid = code !== 0 && code <= MAX_CODE_POINT && (code < 0xd800 || code > 0xdfff)
      out += valid ? String.fromCodePoint(code) : '�'
      continue
    }
    out += rest.slice(0, 1)
    index++
  }
  return out
}

/** Serializes text as a `"`-quoted CSS string, escaping only what must be escaped. */
export function quoteString(text: string): string {
  let out = '"'
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (char === '"' || char === '\\') out += `\\${char}`
    else if (code < 0x20 || code === 0x7f) out += `\\${code.toString(16)} `
    else out += char
  }
  return `${out}"`
}

// N42: 'a', "a" and "\61" are the same string. Every string is re-serialized with `"`.
export const normalizeString = (raw: string): string => quoteString(decodeEscapes(raw))
