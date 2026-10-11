import { splitTopLevel } from './split.ts'
import { isColorToken, isLengthToken } from './tokens.ts'

const TRANSPARENT = / \/ 0\)$/

interface ShadowLayer {
  readonly text: string
  readonly invisible: boolean
}

// A layer is `inset? <length>{2,4} <color>?` in any order of the three groups. Missing lengths
// are 0 and a missing color is currentcolor, so every layer prints in one canonical order. A
// layer with anything else (a var() that may stand for several parts) is kept as written.
function parseLayer(layer: string, lengthCount: number): ShadowLayer {
  const lengths: string[] = []
  let color: string | undefined
  let inset = false
  for (const token of splitTopLevel(layer, ' ')) {
    if (token === 'inset' && !inset) inset = true
    else if (isLengthToken(token) && lengths.length < lengthCount) lengths.push(token)
    else if (color === undefined && isColorToken(token)) color = token
    else return { text: layer, invisible: false }
  }
  if (lengths.length < 2) return { text: layer, invisible: false }
  while (lengths.length < lengthCount) lengths.push('0')
  const paint = color ?? 'currentcolor'
  const text = [...(inset ? ['inset'] : []), ...lengths, paint].join(' ')
  return { text, invisible: lengths.every((length) => length === '0') || TRANSPARENT.test(paint) }
}

// N40: a layer with zero offsets, blur and spread, or a fully transparent color, paints nothing,
// so Tailwind's five-layer `box-shadow` (four `0 0 #0000` layers) equals its one visible layer.
/** Normal form of an already value-normalized `box-shadow` or `text-shadow`. */
export function normalizeShadowList(property: string, value: string): string {
  if (value === 'none') return value
  const lengthCount = property === 'box-shadow' ? 4 : 3
  const visible = splitTopLevel(value, ',')
    .map((layer) => parseLayer(layer, lengthCount))
    .filter((layer) => !layer.invisible)
  return visible.length === 0 ? 'none' : visible.map((layer) => layer.text).join(',')
}
