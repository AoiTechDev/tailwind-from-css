/**
 * Splits a value at `separator` outside parentheses, brackets and strings. Empty parts are
 * dropped, so runs of spaces split like one space.
 */
export function splitTopLevel(text: string, separator: ' ' | ',' | ';'): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quote !== '') {
      if (char === '\\') index++
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '(' || char === '[') {
      depth++
    } else if (char === ')' || char === ']') {
      depth--
    } else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts.filter((part) => part !== '')
}
