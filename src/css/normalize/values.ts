import valueParser, { type FunctionNode, type Node } from 'postcss-value-parser'
import { MATH_FUNCTIONS, normalizeMath } from './calc.ts'
import {
  COLOR_FUNCTIONS,
  isHexColor,
  isNamedColor,
  normalizeColor,
  normalizeColorMix,
} from './colors.ts'
import { normalizeFontFamily, normalizeFontWeight } from './fonts.ts'
import {
  type Dimension,
  formatDimension,
  isZeroLength,
  keepsZeroUnit,
  type LengthBasis,
  parseDimension,
  percentsToNumbers,
  toPx,
} from './lengths.ts'
import { normalizeShadowList } from './shadows.ts'
import { decodeEscapes, normalizeString, quoteString } from './strings.ts'
import { toMsOrDeg } from './time-angle.ts'

/** Inputs of value normalization besides the value itself. */
export interface ValueOptions extends LengthBasis {
  /** Custom property values substituted for `var()` before anything else. */
  readonly variables: ReadonlyMap<string, string> | undefined
}

interface Scope {
  readonly basis: LengthBasis
  /** N11 applies: not inside math functions, var() fallbacks, or unitless properties. */
  readonly dropZeroUnits: boolean
  /** The property takes case-sensitive custom idents, so words keep their case. */
  readonly keepCase: boolean
}

const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set([
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
])

// N02: these properties take custom idents (animation and counter names, grid lines, font
// families), which are case-sensitive, so their words are never lowercased or read as colors.
const CUSTOM_IDENT_PROPERTIES: ReadonlySet<string> = new Set([
  'anchor-name',
  'animation',
  'animation-name',
  'animation-timeline',
  'container',
  'container-name',
  'content',
  'counter-increment',
  'counter-reset',
  'counter-set',
  'font',
  'font-family',
  'font-palette',
  'font-variant',
  'font-variant-alternates',
  'grid',
  'grid-area',
  'grid-column',
  'grid-column-end',
  'grid-column-start',
  'grid-row',
  'grid-row-end',
  'grid-row-start',
  'grid-template',
  'grid-template-areas',
  'grid-template-columns',
  'grid-template-rows',
  'list-style',
  'list-style-type',
  'page',
  'position-anchor',
  'position-try',
  'position-try-fallbacks',
  'quotes',
  'scroll-timeline',
  'scroll-timeline-name',
  'string-set',
  'timeline-scope',
  'view-timeline',
  'view-timeline-name',
  'view-transition-class',
  'view-transition-name',
  'voice-family',
])

// em in font-size (and the font shorthand's size) refers to the parent's font size.
const PARENT_RELATIVE_EM: ReadonlySet<string> = new Set(['font-size', 'font'])

// A var()/env() fallback may be substituted into calc(), where a bare 0 changes type.
const SUBSTITUTION_FUNCTIONS: ReadonlySet<string> = new Set(['var', 'env'])

const MAX_SUBSTITUTION_DEPTH = 16
const MAY_REFERENCE_VARIABLE = /var\(/i

function substituteVariables(
  value: string,
  variables: ReadonlyMap<string, string> | undefined,
  depth = 0,
): string {
  if (variables === undefined || !MAY_REFERENCE_VARIABLE.test(value)) return value
  return valueParser.stringify(valueParser(value).nodes, (node) => {
    if (node.type !== 'function' || node.value.toLowerCase() !== 'var') return undefined
    const known = variables.get(node.nodes[0]?.value ?? '')
    if (known === undefined || depth >= MAX_SUBSTITUTION_DEPTH) return undefined
    return substituteVariables(known, variables, depth + 1)
  })
}

function printDimension(dimension: Dimension, scope: Scope): string {
  const converted = toMsOrDeg(toPx(dimension, scope.basis))
  return scope.dropZeroUnits && isZeroLength(converted) ? '0' : formatDimension(converted)
}

function printWord(word: string, scope: Scope): string {
  if (word.startsWith('--')) return word
  const lower = word.toLowerCase()
  // N23
  if (lower === 'currentcolor') return lower
  const dimension = parseDimension(word)
  if (dimension !== undefined) return printDimension(dimension, scope)
  if (isHexColor(word)) return normalizeColor(lower) ?? lower
  if (scope.keepCase) return word
  return isNamedColor(lower) ? (normalizeColor(lower) ?? lower) : lower
}

function printUrl(node: FunctionNode): string {
  const [first] = node.nodes
  const raw = first?.type === 'string' ? first.value : valueParser.stringify(node.nodes)
  return `url(${quoteString(decodeEscapes(raw.trim()))})`
}

function printFunction(node: FunctionNode, scope: Scope): string {
  const name = node.value.startsWith('--') ? node.value : node.value.toLowerCase()
  // Closing or rewriting what the author left open could change how the rest tokenizes.
  if (node.unclosed) return valueParser.stringify(node)
  if (name === 'url') return printUrl(node)
  if (MATH_FUNCTIONS.has(name)) {
    const inner: Scope = { ...scope, dropZeroUnits: false }
    const result = normalizeMath(name, node.nodes, {
      convert: (dimension) => toMsOrDeg(toPx(dimension, scope.basis)),
      printNode: (child) => printNode(child, inner),
      printNodes: (children) => printNodes(children, inner),
    })
    return typeof result === 'string' ? result : printDimension(result, scope)
  }
  const dropZeroUnits = scope.dropZeroUnits && !SUBSTITUTION_FUNCTIONS.has(name)
  const printed = `${name}(${printNodes(node.nodes, { ...scope, dropZeroUnits })})`
  if (COLOR_FUNCTIONS.has(name)) return normalizeColor(printed) ?? printed
  return name === 'color-mix' ? normalizeColorMix(printed) : printed
}

function printNode(node: Node, scope: Scope): string {
  switch (node.type) {
    case 'word':
      return printWord(node.value, scope)
    case 'string':
      return normalizeString(node.value)
    case 'function':
      return printFunction(node, scope)
    default:
      return node.value
  }
}

// N03: one space between tokens, none inside parentheses or around commas, ` / ` around
// slashes, comments dropped (a comment separates tokens like a space).
function printNodes(nodes: readonly Node[], scope: Scope): string {
  let out = ''
  let separate = false
  for (const node of nodes) {
    if (node.type === 'space' || node.type === 'comment') continue
    if (node.type === 'div' && node.value === '/') {
      out += out === '' || out.endsWith(',') ? '/' : ' /'
      separate = true
    } else if (node.type === 'div') {
      out += node.value
      separate = false
    } else {
      // Adjacent values get a space even when written without one (`"a"b`, `calc(0)s`), so a
      // value that changes when normalized can't fuse with its neighbour into a new token.
      out += (separate ? ' ' : '') + printNode(node, scope)
      separate = true
    }
  }
  return out
}

// Custom properties are token streams: only whitespace and comments are normalized (N03).
function printTokenStream(nodes: readonly Node[]): string {
  let out = ''
  let pendingSpace = false
  for (const node of nodes) {
    if (node.type === 'space' || node.type === 'comment') {
      pendingSpace = out !== ''
      continue
    }
    const text =
      node.type === 'function'
        ? `${node.value}(${printTokenStream(node.nodes)}${node.unclosed ? '' : ')'}`
        : node.type === 'div'
          ? node.value
          : valueParser.stringify(node)
    out += (pendingSpace && node.type !== 'div' ? ' ' : '') + text
    pendingSpace = false
  }
  return out
}

function applyPropertyRules(property: string, value: string): string {
  switch (property) {
    case 'box-shadow':
    case 'text-shadow':
      return normalizeShadowList(property, value)
    case 'font-family':
      return normalizeFontFamily(value)
    case 'font-weight':
      return normalizeFontWeight(value)
    default:
      return percentsToNumbers(property, value)
  }
}

/**
 * Normal form of `value` for `property` (lowercase, aliases resolved). Shorthands are not
 * expanded here; their values get the generic rules only.
 */
export function normalizeValue(property: string, value: string, options: ValueOptions): string {
  const text = substituteVariables(value, options.variables).trim()
  if (property.startsWith('--')) return printTokenStream(valueParser(text).nodes)
  const lower = text.toLowerCase()
  if (CSS_WIDE_KEYWORDS.has(lower)) return lower
  const scope: Scope = {
    basis: {
      rootFontSize: options.rootFontSize,
      emBasis: PARENT_RELATIVE_EM.has(property) ? undefined : options.emBasis,
    },
    dropZeroUnits: !keepsZeroUnit(property),
    keepCase: CUSTOM_IDENT_PROPERTIES.has(property),
  }
  return applyPropertyRules(property, printNodes(valueParser(text).nodes, scope)).trim()
}
