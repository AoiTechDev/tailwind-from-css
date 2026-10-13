import { toDeclarations, toPropertyName } from './css/declarations.ts'
import {
  covers,
  longhandsOf,
  type NormalDeclaration,
  normalizeBlock,
  normalizeDeclaration,
  normalValuesEqual,
} from './css/normalize/index.ts'
import { splitTopLevel } from './css/normalize/split.ts'
import { inheritedProperties, initialValues } from './data/css-properties.generated.ts'
import type { Declaration, DeclarationsInput, PruneOptions } from './types.ts'

// Computed styles are in px; author input that mixes rem and px is compared strictly, so a
// declaration is never dropped for an equality that depends on the root font size.
const NORMALIZE = { rootFontSize: false } as const

const CURRENT_COLOR = 'currentcolor'
// mdn-data 2.37.2 gives `auto` as the initial value of these (Chromium computes it to the text
// color) or doesn't list them yet (`row-rule-color`, Chromium 14x gap decorations).
const AUTO_CURRENT_COLOR: ReadonlySet<string> = new Set([
  'caret-color',
  'outline-color',
  'row-rule-color',
])
// Chromium derives it from `text-decoration-line` here and on ancestors; CSS can't set it.
const DERIVED: ReadonlySet<string> = new Set(['-webkit-text-decorations-in-effect'])
const ORIGINS: ReadonlySet<string> = new Set(['transform-origin', 'perspective-origin'])
// A none style forces the width to 0, so the line shows nothing whatever the style.
const LINE_STYLE = /^(border-(?:top|right|bottom|left)|outline|column-rule|row-rule)-style$/
// The style of a visible line stays with its width, so `border`/`outline` can cover both.
const VISIBLE_STYLE = /^(border-(?:top|right|bottom|left)|outline)-style$/
// Lists coordinated with another property's list (SPEC §9: a shorter list repeats).
const COORDINATED = /^(?:transition|animation|background|mask)-(?!border)/
const LIST_LENGTH: ReadonlySet<string> = new Set([
  'transition-property',
  'animation-name',
  'background-color',
  'background-image',
  'mask-image',
])

const PX = /^(-?\d*\.?\d+(?:e-?\d+)?)px$/
const ZERO = /^-?0(?:\.0+)?$/
const SPACES = /\s+/
const CENTER_TOLERANCE_PX = 0.01

const FLOW_BOX = /^(margin|padding|scroll-margin|scroll-padding|inset)-(block|inline)-(start|end)$/
const FLOW_BORDER = /^border-(block|inline)-(start|end)-(width|style|color)$/
const FLOW_CORNER = /^border-(start|end)-(start|end)-radius$/
const FLOW_SIZE = /^(min-|max-)?(block|inline)-size$/
const FLOW_AXIS = /^(overscroll-behavior|contain-intrinsic)-(block|inline)(-size)?$/

/** The normal value of each longhand of a block that wins its cascade (later wins unless important). */
type Block = ReadonlyMap<string, string>

function winners(declarations: readonly NormalDeclaration[]): Map<string, NormalDeclaration> {
  const won = new Map<string, NormalDeclaration>()
  for (const declaration of declarations) {
    const current = won.get(declaration.property)
    if (current === undefined || declaration.important || !current.important) {
      won.set(declaration.property, declaration)
    }
  }
  return won
}

const valuesOf = (won: ReadonlyMap<string, NormalDeclaration>): Block =>
  new Map([...won].map(([property, declaration]) => [property, declaration.value]))

function blockOf(input: DeclarationsInput): Block {
  return valuesOf(winners(normalizeBlock(toDeclarations(input).declarations, NORMALIZE).flat()))
}

const followsColor = (property: string): boolean =>
  initialValues.get(property) === CURRENT_COLOR || AUTO_CURRENT_COLOR.has(property)

const normalInitials = new Map<string, string | undefined>()

function initialOf(property: string): string | undefined {
  if (followsColor(property)) return CURRENT_COLOR
  if (normalInitials.has(property)) return normalInitials.get(property)
  const initial = initialValues.get(property)
  const [normal] =
    initial === undefined ? [] : normalizeDeclaration({ property, value: initial }, NORMALIZE)
  const value = normal?.property === property ? normal.value : undefined
  normalInitials.set(property, value)
  return value
}

function px(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (ZERO.test(value)) return 0
  const match = PX.exec(value)
  return match === null ? undefined : Number(match[1])
}

const sum = (values: ReadonlyArray<number | undefined>): number | undefined =>
  values.some((value) => value === undefined)
    ? undefined
    : values.reduce<number>((total, value) => total + (value ?? 0), 0)

// Both origins are measured from the border box.
function borderBox(block: Block, size: 'width' | 'height'): number | undefined {
  const sides = size === 'width' ? ['left', 'right'] : ['top', 'bottom']
  const extra =
    block.get('box-sizing') === 'border-box'
      ? [0]
      : sides.flatMap((side) => [
          px(block.get(`padding-${side}`)),
          px(block.get(`border-${side}-width`)),
        ])
  return sum([px(block.get(size)), ...extra])
}

function atCenter(value: string, block: Block): boolean {
  const [x, y, z = 0, ...rest] = value.split(SPACES).map(px)
  const width = borderBox(block, 'width')
  const height = borderBox(block, 'height')
  if (rest.length > 0 || x === undefined || y === undefined || z !== 0) return false
  if (width === undefined || height === undefined) return false
  return (
    Math.abs(x - width / 2) <= CENTER_TOLERANCE_PX &&
    Math.abs(y - height / 2) <= CENTER_TOLERANCE_PX
  )
}

// No transform applies to an inline box, so its origin (`0px 0px` in Chromium) means nothing.
const inlineBox = (block: Block): boolean =>
  block.get('display') === 'inline' && px(block.get('width')) === undefined

function oneItem(property: string, value: string): string {
  if (!COORDINATED.test(property) || LIST_LENGTH.has(property)) return value
  const [first, ...rest] = splitTopLevel(value, ',').map((item) => item.trim())
  return first !== undefined && rest.length > 0 && rest.every((item) => item === first)
    ? first
    : value
}

// Computed styles resolve some values against the element: a color that follows the text color
// comes back as that color, an origin at the center of the box as its px offset, a coordinated
// list as one item per layer or transition. Read back as `currentcolor`, the initial `50% 50%`
// and one item, they compare equal to an initial value or a baseline that does the same: the
// element shows the same with no class, in every state.
function readBack(property: string, value: string, block: Block): string {
  if (followsColor(property)) {
    const color = block.get('color')
    return color !== undefined && normalValuesEqual(value, color) ? CURRENT_COLOR : value
  }
  if (ORIGINS.has(property) && (inlineBox(block) || atCenter(value, block))) {
    return initialOf(property) ?? value
  }
  return oneItem(property, value)
}

/** The physical longhand a logical one sets in a horizontal writing mode. */
function physicalTwin(property: string, rtl: boolean): string | undefined {
  const inlineSide = (edge: string): string => ((edge === 'start') !== rtl ? 'left' : 'right')
  const side = (axis: string, edge: string): string =>
    axis === 'block' ? (edge === 'start' ? 'top' : 'bottom') : inlineSide(edge)
  const box = FLOW_BOX.exec(property)
  if (box !== null) {
    const [, name = '', axis = '', edge = ''] = box
    return name === 'inset' ? side(axis, edge) : `${name}-${side(axis, edge)}`
  }
  const border = FLOW_BORDER.exec(property)
  if (border !== null) return `border-${side(border[1] ?? '', border[2] ?? '')}-${border[3]}`
  const corner = FLOW_CORNER.exec(property)
  if (corner !== null) {
    return `border-${side('block', corner[1] ?? '')}-${inlineSide(corner[2] ?? '')}-radius`
  }
  const size = FLOW_SIZE.exec(property)
  if (size !== null) return `${size[1] ?? ''}${size[2] === 'block' ? 'height' : 'width'}`
  const axis = FLOW_AXIS.exec(property)
  if (axis === null) return undefined
  return axis[1] === 'overscroll-behavior'
    ? `overscroll-behavior-${axis[2] === 'block' ? 'y' : 'x'}`
    : `contain-intrinsic-${axis[2] === 'block' ? 'height' : 'width'}`
}

interface References {
  readonly parent: Block | undefined
  readonly baseline: Block | undefined
}

// SPEC §9: what the element shows for a longhand when no class sets it. The baseline was
// rendered under the parent, so it covers tag rules and inheritance alike. Without one, an
// inherited longhand comes from the parent (the initial value when there is no parent: a root),
// any other one is its initial value.
function reference(property: string, references: References): string | undefined {
  const { baseline, parent } = references
  const fromBaseline = baseline?.get(property)
  if (baseline !== undefined && fromBaseline !== undefined) {
    return readBack(property, fromBaseline, baseline)
  }
  if (inheritedProperties.has(property) && parent !== undefined) {
    const fromParent = parent.get(property)
    return fromParent === undefined ? undefined : readBack(property, fromParent, parent)
  }
  return initialOf(property)
}

function listed(names: readonly string[] | undefined): (property: string) => boolean {
  const properties = (names ?? []).map(toPropertyName)
  return (property) => properties.some((name) => name === property || covers(name, property))
}

const neverShown = (property: string): boolean => property.startsWith('--') || DERIVED.has(property)

/**
 * Drops the declarations of a computed style that the element would show without any class
 * (SPEC §9), so only what needs classes is converted. A longhand is dropped when its value
 * equals, after normal forms (SPEC §6), the baseline's; for an inherited longhand the baseline
 * doesn't list, the parent's (or, without a parent, its initial value); for any other longhand,
 * its initial value. Values computed against the element are read back first: a color equal to
 * the element's own `color` as `currentcolor`, an origin at the center of its border box as
 * `50% 50%`. A logical longhand equal to the physical one it sets (the element's `direction`,
 * horizontal `writing-mode`) is dropped. Custom properties are dropped (computed values have
 * `var()` substituted), important declarations are kept, and `keep`/`drop` override everything
 * (a shorthand stands for its longhands; `keep` wins). Declarations that set the same longhand
 * are kept or dropped together, so the one that won still wins. Invalid declarations are kept,
 * after the others, for the converter to report. Pure and synchronous.
 *
 * @example
 * pruneStyles(
 *   { display: 'flex', color: 'rgb(51, 51, 51)', marginTop: '0px', opacity: '1' },
 *   { parent: { color: '#333' }, baseline: { display: 'block', marginTop: '0px' } },
 * )
 * // [{ property: 'display', value: 'flex', important: false }]
 */
export function pruneStyles(styles: DeclarationsInput, options: PruneOptions): Declaration[] {
  const isKept = listed(options.keep)
  const isDropped = listed(options.drop)
  const references: References = {
    parent: options.parent === undefined ? undefined : blockOf(options.parent),
    baseline: options.baseline === undefined ? undefined : blockOf(options.baseline),
  }
  const { declarations, invalid } = toDeclarations(styles)
  const considered = declarations.filter(
    (declaration) =>
      isKept(declaration.property) ||
      !(isDropped(declaration.property) || neverShown(declaration.property)),
  )
  const groups = normalizeBlock(considered, NORMALIZE)
  const block = valuesOf(winners(groups.flat()))
  const horizontal = block.get('writing-mode') === 'horizontal-tb'
  const direction = block.get('direction')
  const flowKnown = horizontal && (direction === 'ltr' || direction === 'rtl')
  const twinned = (property: string, value: string): boolean => {
    const twin = flowKnown ? physicalTwin(property, direction === 'rtl') : undefined
    const twinValue = twin === undefined ? undefined : block.get(twin)
    return twinValue !== undefined && normalValuesEqual(value, twinValue)
  }
  const equalsReference = (property: string, value: string): boolean => {
    const expected = reference(property, references)
    return expected !== undefined && normalValuesEqual(readBack(property, value, block), expected)
  }
  const removable = (property: string): boolean => {
    const value = block.get(property)
    if (value === undefined) return false
    if (twinned(property, value)) return true
    if (LINE_STYLE.test(property) && value === 'none') return true
    const line = VISIBLE_STYLE.exec(property)?.[1]
    const width = line === undefined ? undefined : block.get(`${line}-width`)
    if (width !== undefined && px(width) !== 0 && !equalsReference(`${line}-width`, width)) {
      return false
    }
    return equalsReference(property, value)
  }
  // Computed styles list some shorthands next to their longhands (`text-decoration`).
  const alone = new Map<string, string[]>()
  for (const group of groups) {
    const [only, ...more] = group
    if (only !== undefined && more.length === 0) {
      alone.set(only.property, [...(alone.get(only.property) ?? []), only.value])
    }
  }
  const repeated = groups.map(
    (group) =>
      group.length > 1 &&
      group.every((normal) =>
        (alone.get(normal.property) ?? []).some((value) => normalValuesEqual(value, normal.value)),
      ),
  )

  const dropped = considered.map(
    (declaration, index) =>
      !declaration.important &&
      !isKept(declaration.property) &&
      (repeated[index] === true ||
        (groups[index] ?? []).every((normal) => removable(normal.property))),
  )
  // A longhand still set by a kept declaration keeps every declaration that sets it. A shorthand
  // its own longhands repeat changes no winner, so it stays dropped.
  const setters = new Map<string, number[]>()
  for (const [index, group] of groups.entries()) {
    if (repeated[index] === true && dropped[index] === true) continue
    for (const longhand of new Set(group.flatMap((normal) => longhandsOf(normal.property)))) {
      setters.set(longhand, [...(setters.get(longhand) ?? []), index])
    }
  }
  let changed = true
  while (changed) {
    changed = false
    for (const indices of setters.values()) {
      if (indices.every((index) => dropped[index]) || indices.every((index) => !dropped[index])) {
        continue
      }
      for (const index of indices) dropped[index] = false
      changed = true
    }
  }

  const invalidKept = invalid.filter(
    (declaration) => isKept(declaration.property) || !isDropped(declaration.property),
  )
  return [
    ...considered.filter((_, index) => !dropped[index]),
    ...invalidKept.map(({ property, value, important }) => ({ property, value, important })),
  ]
}
