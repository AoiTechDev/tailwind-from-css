import postcss, { type ChildNode } from 'postcss'
import { unitlessProperties } from '../data/css-properties.generated.ts'
import type { Declaration, DeclarationsInput } from '../types.ts'
import { splitTopLevel } from './normalize/split.ts'

/** A declaration that was skipped because it isn't valid CSS (TFC102). */
export interface InvalidDeclaration {
  readonly property: string
  readonly value: string
  readonly important: boolean
  readonly code: 'TFC102'
}

/** Declarations read from a {@link DeclarationsInput}, in input order. */
export interface DeclarationList {
  /** Kebab-case properties (custom properties as written), trimmed values, `important` set. */
  readonly declarations: Declaration[]
  readonly invalid: InvalidDeclaration[]
}

const IMPORTANT = /\s*!\s*important\s*$/i
const UPPERCASE = /[A-Z]/g
const HAS_UPPERCASE = /[A-Z]/
const HAS_LOWERCASE = /[a-z]/
const BAD_PROPERTY = /[\s:;{}()!]/
const VENDOR = /^(?:Webkit|Moz|O|ms|Ms)(?=[A-Z])/
const VENDOR_PREFIX = /^-(?:webkit|moz|ms|o)-/
const LEADING_DASH = /^-/

/**
 * Kebab-case property name: `backgroundColor` → `background-color`, `WebkitLineClamp` →
 * `-webkit-line-clamp`, `msFlex` → `-ms-flex` (React's convention for vendor prefixes). Custom
 * properties are kept as written; names with a dash are lowercased.
 */
export function toPropertyName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.startsWith('--')) return trimmed
  const camelCase = HAS_UPPERCASE.test(trimmed) && HAS_LOWERCASE.test(trimmed)
  if (trimmed.includes('-') || !camelCase) return trimmed.toLowerCase()
  const vendor = VENDOR.exec(trimmed)?.[0].toLowerCase()
  const rest = vendor === undefined ? trimmed : trimmed.slice(vendor.length)
  const kebab = rest
    .replace(UPPERCASE, (char) => `-${char.toLowerCase()}`)
    .replace(LEADING_DASH, '')
  return vendor === undefined ? kebab : `-${vendor}-${kebab}`
}

// Brackets must balance and nothing may end the declaration early (`;`, `{`, `}`).
function isWellFormed(value: string): boolean {
  const closers: string[] = []
  let quote = ''
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (quote !== '') {
      if (char === '\\') index++
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '(') closers.push(')')
    else if (char === '[') closers.push(']')
    else if (char === ')' || char === ']') {
      if (closers.pop() !== char) return false
    } else if (char === ';' || char === '{' || char === '}') return false
  }
  return quote === '' && closers.length === 0
}

interface Collected {
  readonly declarations: Declaration[]
  readonly invalid: InvalidDeclaration[]
}

function reject(list: Collected, property: string, value: string, important = false): void {
  list.invalid.push({ property, value, important, code: 'TFC102' })
}

function addValue(list: Collected, property: string, raw: string, flagged: boolean): void {
  const important = flagged || IMPORTANT.test(raw)
  const value = raw.replace(IMPORTANT, '').trim()
  const validProperty = property !== '' && property !== '--' && !BAD_PROPERTY.test(property)
  if (!validProperty || value === '' || !isWellFormed(value))
    reject(list, property, value, important)
  else list.declarations.push({ property, value, important })
}

function add(list: Collected, name: string, raw: string | number, flagged: boolean): void {
  const property = toPropertyName(name)
  if (typeof raw === 'string') addValue(list, property, raw, flagged)
  else if (!Number.isFinite(raw)) reject(list, property, String(raw), flagged)
  else {
    const unprefixed = property.replace(VENDOR_PREFIX, '')
    const unitless = raw === 0 || property.startsWith('--') || unitlessProperties.has(unprefixed)
    addValue(list, property, unitless ? String(raw) : `${raw}px`, flagged)
  }
}

// postcss rejects the whole string for one broken declaration; then every `;`-separated piece
// is read on its own, so the valid ones survive.
function readPieces(css: string, list: Collected): void {
  for (const piece of splitTopLevel(css, ';')) {
    const text = piece.trim()
    if (text === '') continue
    const colon = text.indexOf(':')
    if (colon === -1) reject(list, toPropertyName(text), '')
    else add(list, text.slice(0, colon), text.slice(colon + 1), false)
  }
}

function readNode(node: ChildNode, list: Collected): void {
  if (node.type === 'decl') add(list, node.prop, node.value, node.important)
  else if (node.type !== 'comment') reject(list, '', node.toString())
}

function readString(css: string, list: Collected): void {
  let root: postcss.Root
  try {
    root = postcss.parse(`a{${css}}`)
  } catch {
    readPieces(css, list)
    return
  }
  root.each((node) => {
    if (node === root.first && node.type === 'rule') node.each((child) => readNode(child, list))
    else readNode(node, list)
  })
}

/**
 * Reads declarations from any accepted shape (SPEC §3.2). Record keys may be camelCase; numbers
 * get `px` unless the property is unitless or the number is 0. A trailing `!important` in a value
 * sets `important`. Invalid declarations are returned separately with `TFC102`, never thrown.
 *
 * @example
 * toDeclarations({ backgroundColor: '#fff', padding: 8, lineHeight: 1.5 })
 * // background-color: #fff · padding: 8px · line-height: 1.5
 */
export function toDeclarations(input: DeclarationsInput): DeclarationList {
  const list: Collected = { declarations: [], invalid: [] }
  if (typeof input === 'string') readString(input, list)
  else if (Array.isArray(input)) {
    for (const declaration of input) {
      add(list, declaration.property, declaration.value, declaration.important === true)
    }
  } else {
    for (const [property, value] of Object.entries(input)) add(list, property, value, false)
  }
  return list
}
