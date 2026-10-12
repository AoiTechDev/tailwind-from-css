import { initialValues, shorthandLonghands } from '../../data/css-properties.generated.ts'
import { parseDimension } from './lengths.ts'
import { splitTopLevel } from './split.ts'
import {
  isColorToken,
  isImageToken,
  isLengthPercentageToken,
  isLengthToken,
  isNumberToken,
} from './tokens.ts'

// N01. Every parser below reads an already value-normalized shorthand (lowercase keywords,
// colors and lengths in normal form, `/` as its own token) and returns one value per longhand,
// or `undefined` when a component doesn't parse, in which case the shorthand stays whole.

interface Shorthand {
  /** Longhands in the order `parse` returns their values. */
  readonly longhands: readonly string[]
  parse(tokens: readonly string[], value: string): readonly string[] | undefined
}

const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set([
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
])

// A substituted var() or env() can stand for any number of components.
const PENDING_SUBSTITUTION = /(?:^|[^\w-])(?:var|env|attr)\(/

const PROPERTY_ALIASES: ReadonlyMap<string, string> = new Map([
  ['grid-gap', 'gap'],
  ['grid-row-gap', 'row-gap'],
  ['grid-column-gap', 'column-gap'],
  ['word-wrap', 'overflow-wrap'],
])

/** Lowercases a property name and replaces legacy aliases (`grid-gap` → `gap`). */
export function canonicalProperty(property: string): string {
  if (property.startsWith('--')) return property
  const lower = property.toLowerCase()
  return PROPERTY_ALIASES.get(lower) ?? lower
}

const initial = (longhand: string): string => initialValues.get(longhand) ?? 'initial'

const generatedLonghands = (shorthand: string): readonly string[] =>
  shorthandLonghands.get(shorthand) ?? []

const keywords = (...words: string[]): ReadonlySet<string> => new Set(words)

const SIDES = ['top', 'right', 'bottom', 'left'] as const

// 1–4 values → top, right, bottom, left (corners: top-left, top-right, bottom-right, bottom-left).
function fourSides(tokens: readonly string[]): readonly string[] | undefined {
  if (tokens.length === 0 || tokens.length > 4 || tokens.includes('/')) return undefined
  const [top = '', right = top, bottom = top, left = right] = tokens
  return [top, right, bottom, left]
}

function pair(tokens: readonly string[]): readonly string[] | undefined {
  if (tokens.length === 0 || tokens.length > 2 || tokens.includes('/')) return undefined
  const [first = '', second = first] = tokens
  return [first, second]
}

const box = (longhands: readonly string[]): Shorthand => ({ longhands, parse: fourSides })
const twoValues = (longhands: readonly string[]): Shorthand => ({ longhands, parse: pair })

const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(
  (corner) => `border-${corner}-radius`,
)

const borderRadius: Shorthand = {
  longhands: CORNERS,
  parse(tokens) {
    const slash = tokens.indexOf('/')
    const horizontal = fourSides(slash === -1 ? tokens : tokens.slice(0, slash))
    const vertical = slash === -1 ? horizontal : fourSides(tokens.slice(slash + 1))
    if (horizontal === undefined || vertical === undefined) return undefined
    return horizontal.map((x, index) => (x === vertical[index] ? x : `${x} ${vertical[index]}`))
  },
}

const ALIGNMENT_PREFIXES = keywords('first', 'last', 'safe', 'unsafe', 'legacy')

function alignmentGroups(tokens: readonly string[]): string[] {
  const groups: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? ''
    const next = tokens[index + 1]
    const joins = next !== undefined && (ALIGNMENT_PREFIXES.has(token) || next === 'legacy')
    groups.push(joins ? `${token} ${next}` : token)
    if (joins) index++
  }
  return groups
}

// place-content copies align into justify, except a baseline position, which becomes `start`.
const place = (align: string, justify: string): Shorthand => ({
  longhands: [align, justify],
  parse(tokens) {
    const groups = alignmentGroups(tokens)
    const [first = '', second] = groups
    if (groups.length > 2 || tokens.includes('/')) return undefined
    const copied = align === 'align-content' && first.endsWith('baseline') ? 'start' : first
    return [first, second ?? copied]
  },
})

// [<grow> <shrink>?] || <basis>. A unitless 0 is a flex factor unless two factors precede it.
const flex: Shorthand = {
  longhands: ['flex-grow', 'flex-shrink', 'flex-basis'],
  parse(tokens) {
    const [a = '', b = '', c = ''] = tokens
    const pattern = tokens.map((token) => (isNumberToken(token) ? 'n' : 'b')).join('')
    if (pattern === 'b' && a === 'none') return ['0', '0', 'auto']
    if (pattern === 'b' && a === 'auto') return ['1', '1', 'auto']
    if (tokens.includes('/')) return undefined
    switch (pattern) {
      case 'n':
        return [a, '1', '0%']
      case 'b':
        return ['1', '1', a]
      case 'nn':
        return [a, b, '0%']
      case 'nb':
        return [a, '1', b]
      case 'bn':
        return [b, '1', a]
      case 'nnb':
        return [a, b, c]
      case 'bnn':
        return [b, c, a]
      case 'nnn':
        return c === '0' ? [a, b, '0px'] : undefined
      default:
        return undefined
    }
  },
}

const FLEX_DIRECTIONS = keywords('row', 'row-reverse', 'column', 'column-reverse')
const FLEX_WRAPS = keywords('nowrap', 'wrap', 'wrap-reverse')

const flexFlow: Shorthand = {
  longhands: ['flex-direction', 'flex-wrap'],
  parse(tokens) {
    let direction: string | undefined
    let wrap: string | undefined
    for (const token of tokens) {
      if (direction === undefined && FLEX_DIRECTIONS.has(token)) direction = token
      else if (wrap === undefined && FLEX_WRAPS.has(token)) wrap = token
      else return undefined
    }
    return [direction ?? initial('flex-direction'), wrap ?? initial('flex-wrap')]
  },
}

const LINE_STYLES = keywords(
  'none',
  'hidden',
  'dotted',
  'dashed',
  'solid',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
)
const OUTLINE_STYLES: ReadonlySet<string> = new Set([...LINE_STYLES, 'auto'])
const LINE_WIDTHS = keywords('thin', 'medium', 'thick')

// <line-width> || <line-style> || <color>, applied to every longhand of the shorthand by suffix.
const line = (shorthand: string, styles: ReadonlySet<string>): Shorthand => {
  const longhands = generatedLonghands(shorthand)
  return {
    longhands,
    parse(tokens) {
      const parts = new Map<string, string>()
      for (const token of tokens) {
        const part =
          LINE_WIDTHS.has(token) || isLengthToken(token)
            ? '-width'
            : styles.has(token)
              ? '-style'
              : isColorToken(token)
                ? '-color'
                : undefined
        if (part === undefined || parts.has(part)) return undefined
        parts.set(part, token)
      }
      return longhands.map(
        (longhand) => parts.get(longhand.slice(longhand.lastIndexOf('-'))) ?? initial(longhand),
      )
    },
  }
}

const DECORATION_LINES = keywords(
  'none',
  'underline',
  'overline',
  'line-through',
  'blink',
  'spelling-error',
  'grammar-error',
)
const DECORATION_STYLES = keywords('solid', 'double', 'dotted', 'dashed', 'wavy')

// mdn-data lists three longhands; CSS Text Decoration 4 and browsers also reset the thickness.
const textDecoration: Shorthand = {
  longhands: [
    'text-decoration-color',
    'text-decoration-line',
    'text-decoration-style',
    'text-decoration-thickness',
  ],
  parse(tokens) {
    const lines: string[] = []
    let color: string | undefined
    let style: string | undefined
    let thickness: string | undefined
    for (const token of tokens) {
      if (DECORATION_LINES.has(token)) lines.push(token)
      else if (style === undefined && DECORATION_STYLES.has(token)) style = token
      else if (
        thickness === undefined &&
        (token === 'auto' || token === 'from-font' || isLengthPercentageToken(token))
      )
        thickness = token
      else if (color === undefined && isColorToken(token)) color = token
      else return undefined
    }
    if (lines.length > 1 && lines.includes('none')) return undefined
    return [
      color ?? initial('text-decoration-color'),
      lines.length > 0 ? lines.join(' ') : initial('text-decoration-line'),
      style ?? initial('text-decoration-style'),
      thickness ?? initial('text-decoration-thickness'),
    ]
  },
}

const columns: Shorthand = {
  longhands: generatedLonghands('columns'),
  parse(tokens) {
    let count: string | undefined
    let width: string | undefined
    for (const token of tokens) {
      if (token === 'auto') continue
      if (count === undefined && isNumberToken(token)) count = token
      else if (width === undefined && isLengthToken(token)) width = token
      else return undefined
    }
    if (tokens.length > 2) return undefined
    return [
      count ?? initial('column-count'),
      initial('column-height'),
      width ?? initial('column-width'),
    ]
  },
}

// `none` sets whichever of image and type isn't otherwise given.
const listStyle: Shorthand = {
  longhands: generatedLonghands('list-style'),
  parse(tokens) {
    let nones = 0
    let image: string | undefined
    let position: string | undefined
    let type: string | undefined
    for (const token of tokens) {
      if (token === 'none') nones++
      else if (position === undefined && (token === 'inside' || token === 'outside'))
        position = token
      else if (image === undefined && isImageToken(token)) image = token
      else if (type === undefined && token !== '/') type = token
      else return undefined
    }
    const unset = Number(image === undefined) + Number(type === undefined)
    if (nones > unset) return undefined
    if (nones > 0) {
      image ??= 'none'
      type ??= 'none'
    }
    return [
      image ?? initial('list-style-image'),
      position ?? initial('list-style-position'),
      type ?? initial('list-style-type'),
    ]
  },
}

function slashParts(tokens: readonly string[]): string[] {
  const parts: string[][] = [[]]
  for (const token of tokens) {
    if (token === '/') parts.push([])
    else parts[parts.length - 1]?.push(token)
  }
  return parts.map((part) => part.join(' '))
}

const isCustomIdent = (part: string): boolean =>
  !part.includes(' ') &&
  parseDimension(part) === undefined &&
  part.toLowerCase() !== 'auto' &&
  part.toLowerCase() !== 'span'

// A missing grid line copies the opposite line when that one is a custom ident, else it's auto.
const copyOrAuto = (part: string): string => (isCustomIdent(part) ? part : 'auto')

const gridLine = (start: string, end: string): Shorthand => ({
  longhands: [start, end],
  parse(tokens) {
    const parts = slashParts(tokens)
    const [first = '', second = copyOrAuto(first)] = parts
    return parts.length > 2 || parts.includes('') ? undefined : [first, second]
  },
})

const gridArea: Shorthand = {
  longhands: ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'],
  parse(tokens) {
    const parts = slashParts(tokens)
    const [rowStart = '', columnStart = copyOrAuto(rowStart)] = parts
    const [, , rowEnd = copyOrAuto(rowStart), columnEnd = copyOrAuto(columnStart)] = parts
    return parts.length > 4 || parts.includes('')
      ? undefined
      : [rowStart, columnStart, rowEnd, columnEnd]
  },
}

const EASING_KEYWORDS = keywords(
  'ease',
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
)
const EASING_FUNCTION = /^(?:cubic-bezier|steps|linear)\(/

const IDENT = /^-{0,2}[a-z_][\w-]*$/i
const STRING = /^".*"$/

const isEasing = (token: string): boolean =>
  EASING_KEYWORDS.has(token.toLowerCase()) || EASING_FUNCTION.test(token)
const isTime = (token: string): boolean => parseDimension(token)?.unit === 'ms'

type LayerParser = (tokens: readonly string[], last: boolean) => Map<string, string> | undefined

// Comma-separated layers: every longhand gets one value per layer, in layer order, except
// background-color, which isn't a list and comes from the final layer.
const layered = (longhands: readonly string[], parseLayer: LayerParser): Shorthand => ({
  longhands,
  parse(_tokens, value) {
    const layers = splitTopLevel(value, ',')
    const parsed = layers.map((layer, index) =>
      parseLayer(splitTopLevel(layer, ' '), index === layers.length - 1),
    )
    if (!parsed.every((layer) => layer !== undefined)) return undefined
    return longhands.map((longhand) => {
      const values = longhand === 'background-color' ? parsed.slice(-1) : parsed
      return values.map((layer) => layer.get(longhand) ?? initial(longhand)).join(',')
    })
  },
})

// Assigns each token to the first of `slots` that accepts it and is still free.
function fillSlots(
  tokens: readonly string[],
  slots: ReadonlyArray<readonly [string, (token: string) => boolean]>,
): Map<string, string> | undefined {
  const filled = new Map<string, string>()
  for (const token of tokens) {
    const slot = slots.find(([longhand, accepts]) => !filled.has(longhand) && accepts(token))
    if (slot === undefined) return undefined
    filled.set(slot[0], token)
  }
  return filled
}

const TRANSITION_SLOTS: ReadonlyArray<readonly [string, (token: string) => boolean]> = [
  ['transition-duration', isTime],
  ['transition-delay', isTime],
  ['transition-timing-function', isEasing],
  ['transition-behavior', (token) => token === 'normal' || token === 'allow-discrete'],
  ['transition-property', (token) => IDENT.test(token)],
]

const transition = layered(generatedLonghands('transition'), (tokens) =>
  fillSlots(tokens, TRANSITION_SLOTS),
)

const ANIMATION_DIRECTIONS = keywords('normal', 'reverse', 'alternate', 'alternate-reverse')
const ANIMATION_FILL_MODES = keywords('none', 'forwards', 'backwards', 'both')
const ANIMATION_PLAY_STATES = keywords('running', 'paused')

const lowercased =
  (test: (token: string) => boolean) =>
  (token: string): boolean =>
    test(token.toLowerCase())

// Keywords go to the other longhands first; what's left is the name (case kept).
const ANIMATION_SLOTS: ReadonlyArray<readonly [string, (token: string) => boolean]> = [
  ['animation-duration', isTime],
  ['animation-delay', isTime],
  ['animation-timing-function', isEasing],
  [
    'animation-iteration-count',
    lowercased((token) => token === 'infinite' || isNumberToken(token)),
  ],
  ['animation-direction', lowercased((token) => ANIMATION_DIRECTIONS.has(token))],
  ['animation-fill-mode', lowercased((token) => ANIMATION_FILL_MODES.has(token))],
  ['animation-play-state', lowercased((token) => ANIMATION_PLAY_STATES.has(token))],
  ['animation-name', (token) => IDENT.test(token) || STRING.test(token)],
]

const animation = layered(generatedLonghands('animation'), (tokens) => {
  const filled = fillSlots(tokens, ANIMATION_SLOTS)
  if (filled === undefined) return undefined
  for (const [longhand, token] of filled) {
    if (longhand !== 'animation-name') filled.set(longhand, token.toLowerCase())
  }
  return filled
})

const FONT_STRETCHES = keywords(
  'ultra-condensed',
  'extra-condensed',
  'condensed',
  'semi-condensed',
  'semi-expanded',
  'expanded',
  'extra-expanded',
  'ultra-expanded',
)
const FONT_SIZES = keywords(
  'xx-small',
  'x-small',
  'small',
  'medium',
  'large',
  'x-large',
  'xx-large',
  'xxx-large',
  'larger',
  'smaller',
  'math',
)

const isWeight = (token: string): boolean => {
  const weight = parseDimension(token)
  if (weight !== undefined) return weight.unit === '' && weight.value >= 1 && weight.value <= 1000
  return token === 'bold' || token === 'bolder' || token === 'lighter'
}

// [style || variant || weight || stretch]? size [/ line-height]? family. Family names keep their
// case (font is a custom-ident property), so keywords are compared lowercased. System fonts
// (`font: caption`) have no size, so they fail to parse and stay whole.
const font: Shorthand = {
  longhands: generatedLonghands('font'),
  parse(tokens) {
    const prefix = new Map<string, string>()
    let index = 0
    for (; index < tokens.length; index++) {
      const token = (tokens[index] ?? '').toLowerCase()
      const next = tokens[index + 1] ?? ''
      if (token === 'normal') continue
      if (!prefix.has('style') && (token === 'italic' || token === 'oblique')) {
        const angle = token === 'oblique' && parseDimension(next)?.unit === 'deg'
        prefix.set('style', angle ? `${token} ${next}` : token)
        if (angle) index++
      } else if (!prefix.has('variant') && token === 'small-caps') prefix.set('variant', token)
      else if (!prefix.has('weight') && isWeight(token)) prefix.set('weight', token)
      else if (!prefix.has('stretch') && FONT_STRETCHES.has(token)) prefix.set('stretch', token)
      else break
    }
    const size = (tokens[index] ?? '').toLowerCase()
    if (!isLengthPercentageToken(size) && !FONT_SIZES.has(size)) return undefined
    const slash = tokens[index + 1] === '/'
    const lineHeight = slash ? tokens[index + 2] : undefined
    const family = tokens.slice(index + (slash ? 3 : 1)).join(' ')
    if ((slash && lineHeight === undefined) || family === '') return undefined
    return [
      family,
      size,
      prefix.get('stretch') ?? 'normal',
      prefix.get('style') ?? 'normal',
      prefix.get('variant') ?? 'normal',
      prefix.get('weight') ?? 'normal',
      lineHeight?.toLowerCase() ?? 'normal',
    ]
  },
}

const POSITION_KEYWORDS = keywords('left', 'right', 'top', 'bottom', 'center')
const isPosition = (token: string): boolean =>
  POSITION_KEYWORDS.has(token) || isLengthPercentageToken(token)
const isSize = (token: string): boolean => token === 'auto' || isLengthPercentageToken(token)
const REPEAT_ONE = keywords('repeat-x', 'repeat-y')
const REPEAT_TWO = keywords('repeat', 'space', 'round', 'no-repeat')

interface LayerGrammar {
  readonly prefix: 'background' | 'mask'
  /** Boxes valid for both origin and clip. */
  readonly boxes: ReadonlySet<string>
  /** Boxes valid for clip only; a single one leaves origin at its initial value. */
  readonly clipOnly: ReadonlySet<string>
  /** Single-keyword longhands other than the boxes (attachment, composite, mode). */
  readonly keywords: ReadonlyArray<readonly [string, ReadonlySet<string>]>
  readonly color: boolean
}

// <image> || <position> [/ <size>]? || <repeat> || <box> || <box> || keywords || <color> (last).
function parseImageLayer(grammar: LayerGrammar, tokens: readonly string[], last: boolean) {
  const { prefix } = grammar
  const layer = new Map<string, string>()
  const boxes: string[] = []
  const claim = (component: string, value: string): boolean => {
    if (layer.has(`${prefix}-${component}`)) return false
    layer.set(`${prefix}-${component}`, value)
    return true
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? ''
    if ((token === 'none' || isImageToken(token)) && claim('image', token)) continue
    if (isPosition(token) && !layer.has(`${prefix}-position`)) {
      const start = index
      while (index + 1 < tokens.length && index - start < 3 && isPosition(tokens[index + 1] ?? ''))
        index++
      claim('position', tokens.slice(start, index + 1).join(' '))
      if (tokens[index + 1] !== '/') continue
      const first = tokens[index + 2] ?? ''
      const second = tokens[index + 3] ?? ''
      if (first === 'cover' || first === 'contain') claim('size', first)
      else if (!isSize(first)) return undefined
      else claim('size', isSize(second) ? `${first} ${second}` : first)
      index += isSize(first) && isSize(second) ? 3 : 2
      continue
    }
    if (REPEAT_ONE.has(token) && claim('repeat', token)) continue
    if (REPEAT_TWO.has(token) && !layer.has(`${prefix}-repeat`)) {
      const next = tokens[index + 1] ?? ''
      claim('repeat', REPEAT_TWO.has(next) ? `${token} ${next}` : token)
      if (REPEAT_TWO.has(next)) index++
      continue
    }
    if ((grammar.boxes.has(token) || grammar.clipOnly.has(token)) && boxes.length < 2) {
      boxes.push(token)
      continue
    }
    const keyword = grammar.keywords.find(([, words]) => words.has(token))
    if (keyword !== undefined && claim(keyword[0], token)) continue
    if (grammar.color && last && isColorToken(token) && claim('color', token)) continue
    return undefined
  }
  const [origin, clip = origin] = boxes
  if (origin !== undefined && !grammar.clipOnly.has(origin)) layer.set(`${prefix}-origin`, origin)
  if (clip !== undefined) layer.set(`${prefix}-clip`, clip)
  return layer
}

const BACKGROUND_LAYER: LayerGrammar = {
  prefix: 'background',
  boxes: keywords('border-box', 'padding-box', 'content-box'),
  clipOnly: keywords('text', 'border-area'),
  keywords: [['attachment', keywords('scroll', 'fixed', 'local')]],
  color: true,
}

const MASK_LAYER: LayerGrammar = {
  prefix: 'mask',
  boxes: keywords('border-box', 'padding-box', 'content-box', 'fill-box', 'stroke-box', 'view-box'),
  clipOnly: keywords('no-clip'),
  keywords: [
    ['composite', keywords('add', 'subtract', 'intersect', 'exclude')],
    ['mode', keywords('alpha', 'luminance', 'match-source')],
  ],
  color: false,
}

const background = layered(generatedLonghands('background'), (tokens, last) =>
  parseImageLayer(BACKGROUND_LAYER, tokens, last),
)

const mask = layered(generatedLonghands('mask'), (tokens, last) =>
  parseImageLayer(MASK_LAYER, tokens, last),
)

const sides = (prefix: string, suffix: string): readonly string[] =>
  SIDES.map((side) => `${prefix}${side}${suffix}`)

const startEnd = (prefix: string, suffix = ''): readonly string[] => [
  `${prefix}-start${suffix}`,
  `${prefix}-end${suffix}`,
]

const LINE_SHORTHANDS = [
  'border',
  ...SIDES.map((side) => `border-${side}`),
  'border-block',
  'border-inline',
  'border-block-start',
  'border-block-end',
  'border-inline-start',
  'border-inline-end',
  'column-rule',
]

// Grid, border-image and the vendor and draft shorthands have no parser: they stay whole.
const SHORTHANDS: ReadonlyMap<string, Shorthand> = new Map<string, Shorthand>([
  ['margin', box(sides('margin-', ''))],
  ['padding', box(sides('padding-', ''))],
  ['inset', box(sides('', ''))],
  ['scroll-margin', box(sides('scroll-margin-', ''))],
  ['scroll-padding', box(sides('scroll-padding-', ''))],
  ['border-width', box(sides('border-', '-width'))],
  ['border-style', box(sides('border-', '-style'))],
  ['border-color', box(sides('border-', '-color'))],
  ['border-radius', borderRadius],
  ...['margin', 'padding', 'inset', 'scroll-margin', 'scroll-padding'].flatMap((base) =>
    ['block', 'inline'].map((axis): [string, Shorthand] => [
      `${base}-${axis}`,
      twoValues(startEnd(`${base}-${axis}`)),
    ]),
  ),
  ...['block', 'inline'].flatMap((axis) =>
    ['width', 'style', 'color'].map((kind): [string, Shorthand] => [
      `border-${axis}-${kind}`,
      twoValues(startEnd(`border-${axis}`, `-${kind}`)),
    ]),
  ),
  ['gap', twoValues(['row-gap', 'column-gap'])],
  ['overflow', twoValues(['overflow-x', 'overflow-y'])],
  ['place-content', place('align-content', 'justify-content')],
  ['place-items', place('align-items', 'justify-items')],
  ['place-self', place('align-self', 'justify-self')],
  ['flex', flex],
  ['flex-flow', flexFlow],
  ...LINE_SHORTHANDS.map((shorthand): [string, Shorthand] => [
    shorthand,
    line(shorthand, LINE_STYLES),
  ]),
  ['outline', line('outline', OUTLINE_STYLES)],
  ['text-decoration', textDecoration],
  ['columns', columns],
  ['list-style', listStyle],
  ['grid-row', gridLine('grid-row-start', 'grid-row-end')],
  ['grid-column', gridLine('grid-column-start', 'grid-column-end')],
  ['grid-area', gridArea],
  ['transition', transition],
  ['animation', animation],
  ['font', font],
  ['background', background],
  ['mask', mask],
])

/** Longhands each expandable shorthand sets, in the order {@link expandShorthand} returns them. */
export const EXPANDED_LONGHANDS: ReadonlyMap<string, readonly string[]> = new Map(
  [...SHORTHANDS].map(([shorthand, { longhands }]) => [shorthand, longhands]),
)

const covered = new Map<string, ReadonlySet<string>>()
const sortedLonghands = new Map<string, readonly string[]>()

// Every longhand a shorthand sets: what N01 expands it into, and what mdn-data lists.
function longhandSet(shorthand: string): ReadonlySet<string> | undefined {
  let set = covered.get(shorthand)
  if (set === undefined) {
    const longhands = [
      ...(EXPANDED_LONGHANDS.get(shorthand) ?? []),
      ...generatedLonghands(shorthand),
    ]
    if (longhands.length === 0) return undefined
    set = new Set(longhands)
    covered.set(shorthand, set)
  }
  return set
}

/**
 * Whether a declaration of `shorthand` sets every longhand a declaration of `property` sets, so
 * a later one overrides it completely, even when it stays whole (N01: a `var()` value).
 *
 * @example
 * covers('padding', 'padding-top') // true
 * covers('border', 'border-color')  // true
 */
export function covers(shorthand: string, property: string): boolean {
  if (shorthand === property) return false
  const set = longhandSet(shorthand)
  if (set === undefined) return false
  const own = longhandSet(property)
  return own === undefined ? set.has(property) : [...own].every((longhand) => set.has(longhand))
}

/**
 * The longhands a declaration of `property` sets, sorted: a shorthand's (also when it stays
 * whole), or the property itself.
 *
 * @example
 * longhandsOf('padding') // ['padding-bottom', 'padding-left', 'padding-right', 'padding-top']
 */
export function longhandsOf(property: string): readonly string[] {
  let sorted = sortedLonghands.get(property)
  if (sorted === undefined) {
    const set = longhandSet(property)
    if (set === undefined) return [property]
    sorted = [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    sortedLonghands.set(property, sorted)
  }
  return sorted
}

/**
 * Whether an important winner of a block covers a later declaration that isn't important, so
 * the later one never shows.
 */
export function coveredByImportant(
  winners: ReadonlyMap<string, { readonly important: boolean }>,
  declaration: { readonly property: string; readonly important: boolean },
): boolean {
  if (declaration.important) return false
  for (const [property, winner] of winners) {
    if (winner.important && covers(property, declaration.property)) return true
  }
  return false
}

/**
 * Removes from a block's winners (by property) those a later declaration overrides completely
 * because its shorthand covers them, unless they're important and it isn't.
 */
export function dropCovered(
  winners: Map<string, { readonly important: boolean }>,
  declaration: { readonly property: string; readonly important: boolean },
): void {
  if (longhandSet(declaration.property) === undefined) return
  for (const [property, winner] of winners) {
    if ((declaration.important || !winner.important) && covers(declaration.property, property)) {
      winners.delete(property)
    }
  }
}

/**
 * Expands an already value-normalized shorthand into `[longhand, value]` pairs. `undefined`
 * when `property` isn't an expandable shorthand or a component doesn't parse.
 */
export function expandShorthand(
  property: string,
  value: string,
): Array<readonly [string, string]> | undefined {
  const shorthand = SHORTHANDS.get(property)
  if (shorthand === undefined || PENDING_SUBSTITUTION.test(value)) return undefined
  const values = CSS_WIDE_KEYWORDS.has(value)
    ? shorthand.longhands.map(() => value)
    : shorthand.parse(splitTopLevel(value, ' '), value)
  return values?.map((longhandValue, index) => [shorthand.longhands[index] ?? '', longhandValue])
}
