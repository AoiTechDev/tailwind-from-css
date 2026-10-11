import {
  type Color,
  colorsNamed,
  modeA98,
  modeHsl,
  modeHwb,
  modeLab,
  modeLch,
  modeLrgb,
  modeOklab,
  modeOklch,
  modeP3,
  modeProphoto,
  modeRec2020,
  modeRgb,
  modeXyz50,
  modeXyz65,
  parse,
  useMode,
} from 'culori/fn'
import { formatNumber } from './lengths.ts'
import { splitTopLevel } from './split.ts'

const toRgb = useMode(modeRgb)
for (const mode of [modeHsl, modeHwb, modeLab, modeLch, modeOklab, modeOklch, modeLrgb]) {
  useMode(mode)
}
for (const mode of [modeP3, modeRec2020, modeA98, modeProphoto, modeXyz50, modeXyz65]) {
  useMode(mode)
}

/** Functions whose result is a color in one space; `color-mix()` is handled separately. */
export const COLOR_FUNCTIONS: ReadonlySet<string> = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'srgb',
])

/** Spaces that keep their own normal form (N21): culori mode → printed prefix and channels. */
const OWN_SPACES: ReadonlyMap<string, readonly [string, readonly string[]]> = new Map([
  ['oklch', ['oklch(', ['l', 'c', 'h']]],
  ['oklab', ['oklab(', ['l', 'a', 'b']]],
  ['lch', ['lch(', ['l', 'c', 'h']]],
  ['lab', ['lab(', ['l', 'a', 'b']]],
  ['p3', ['color(display-p3 ', ['r', 'g', 'b']]],
  ['rec2020', ['color(rec2020 ', ['r', 'g', 'b']]],
  ['a98', ['color(a98-rgb ', ['r', 'g', 'b']]],
  ['prophoto', ['color(prophoto-rgb ', ['r', 'g', 'b']]],
  ['lrgb', ['color(srgb-linear ', ['r', 'g', 'b']]],
  ['xyz50', ['color(xyz-d50 ', ['x', 'y', 'z']]],
  ['xyz65', ['color(xyz-d65 ', ['x', 'y', 'z']]],
])

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const SRGB_FORM = /^srgb\((none|-?[\d.]+) (none|-?[\d.]+) (none|-?[\d.]+) \/ (-?[\d.]+)\)$/
const SRGB_ANYWHERE = /srgb\(([^ )]+) ([^ )]+) ([^ )]+) \/ ([^ )]+)\)/g
const TRAILING_ALPHA = / \/ ([^ )]+)\)$/
const TRANSPARENT = 'srgb(0 0 0 / 0)'
const CHANNEL_TOLERANCE = 0.5
const ALPHA_TOLERANCE = 0.5 / 255

export const isHexColor = (word: string): boolean => HEX.test(word)

export const isNamedColor = (word: string): boolean =>
  word === 'transparent' || Object.hasOwn(colorsNamed, word)

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const channel = (value: number | string | undefined, decimals = 4): string =>
  typeof value === 'number' ? formatNumber(value, decimals) : 'none'

function printSrgb(color: Color, clamp: boolean): string {
  const rgb = ['r', 'g', 'b'].map((name) => {
    const value = color[name]
    if (typeof value !== 'number') return 'none'
    return channel((clamp ? clamp01(value) : value) * 255, 2)
  })
  return `srgb(${rgb.join(' ')} / ${channel(clamp01(color.alpha ?? 1))})`
}

function parseSrgbForm(match: RegExpExecArray): Color {
  const [r, g, b, alpha] = match
    .slice(1)
    .map((text) => (text === 'none' ? undefined : Number(text)))
  const scaled = (value: number | undefined): number | undefined =>
    value === undefined ? undefined : value / 255
  return { mode: 'rgb', r: scaled(r), g: scaled(g), b: scaled(b), alpha: alpha ?? 1 }
}

// culori 4.0.2 throws on some malformed functions (`rgb(9a)`) instead of returning undefined.
function tryParse(text: string): Color | undefined {
  try {
    return parse(text)
  } catch {
    return undefined
  }
}

// N20: every sRGB-family syntax becomes `srgb(r g b / a)` with 0–255 channels. Legacy syntaxes
// clamp out-of-range channels like browsers do; `color(srgb …)` doesn't. N21: other spaces keep
// their own space, with culori's channel scale (L as a fraction for oklab/oklch).
function parseColorText(text: string): string | undefined {
  const own = SRGB_FORM.exec(text)
  if (own) return printSrgb(parseSrgbForm(own), false)
  const color = tryParse(text)
  if (color === undefined) return undefined
  if (color.mode === 'rgb') return printSrgb(color, !text.startsWith('color('))
  if (color.mode === 'hsl' || color.mode === 'hwb') return printSrgb(toRgb(color), true)
  const space = OWN_SPACES.get(color.mode)
  if (space === undefined) return undefined
  const [prefix, channels] = space
  const values = channels.map((name) => channel(color[name]))
  return `${prefix}${values.join(' ')} / ${channel(clamp01(color.alpha ?? 1))})`
}

// A theme color shows up in every color utility (bg, text, border …), and culori's parser is
// the slowest part of normalization, so results are kept per token.
const colorCache = new Map<string, string | undefined>()
const COLOR_CACHE_SIZE = 4096

/** Normal form of one color token, or `undefined` when the text isn't a color culori can parse. */
export function normalizeColor(text: string): string | undefined {
  if (colorCache.has(text)) return colorCache.get(text)
  const normal = parseColorText(text)
  if (colorCache.size >= COLOR_CACHE_SIZE) colorCache.clear()
  colorCache.set(text, normal)
  return normal
}

function parseStop(stop: string): { color: string; percent: number | undefined } | undefined {
  const tokens = splitTopLevel(stop, ' ')
  if (tokens.length === 1) return { color: stop, percent: undefined }
  const percentIndex = tokens.findIndex((token) => token.endsWith('%'))
  if (tokens.length !== 2 || percentIndex === -1) return undefined
  const percent = Number(tokens[percentIndex]?.slice(0, -1))
  const color = tokens[1 - percentIndex] ?? ''
  return Number.isFinite(percent) && percent >= 0 ? { color, percent } : undefined
}

// N22: mixing with `transparent` (premultiplied) keeps the other color and scales its alpha by
// its weight, so `color-mix(in oklab, C 50%, transparent)` is C at half alpha. The weights follow
// CSS Color 5: missing ones complete 100%, and a sum below 100% scales alpha down too.
/** `text` is an already normalized `color-mix(…)`. Returns it unchanged when the rule doesn't apply. */
export function normalizeColorMix(text: string): string {
  const [space, ...stops] = splitTopLevel(text.slice('color-mix('.length, -1), ',')
  if (!space?.startsWith('in ') || stops.length !== 2) return text
  const parsed = stops.map(parseStop)
  const [first, second] = parsed
  if (first === undefined || second === undefined) return text
  const clearIndex = parsed.findIndex((stop) => stop?.color === TRANSPARENT)
  const mixed = clearIndex === 0 ? second : first
  const clear = clearIndex === 0 ? first : second
  const alpha = TRAILING_ALPHA.exec(mixed.color)
  if (clearIndex === -1 || alpha === null || mixed.color === TRANSPARENT) return text
  const weight = mixed.percent ?? (clear.percent === undefined ? 50 : 100 - clear.percent)
  const sum = weight + (clear.percent ?? 100 - weight)
  if (sum <= 0) return text
  const scaled = (Number(alpha[1]) * weight * Math.min(1, sum / 100)) / sum
  return mixed.color.replace(TRAILING_ALPHA, ` / ${formatNumber(scaled)})`)
}

function srgbSkeleton(value: string, channels: number[][]): string {
  return value.replace(SRGB_ANYWHERE, (_match, ...groups: string[]) => {
    channels.push(groups.slice(0, 4).map((text) => (text === 'none' ? Number.NaN : Number(text))))
    return 'srgb()'
  })
}

const channelEqual = (a: number, b: number, tolerance: number): boolean =>
  Number.isNaN(a) || Number.isNaN(b)
    ? Number.isNaN(a) && Number.isNaN(b)
    : Math.abs(a - b) < tolerance

const roundedStep = (text: string, scale: number): string =>
  text === 'none' ? text : String(Math.round(Number(text) * scale))

/**
 * Index key of a normal value: every `srgb()` channel rounded to an 8-bit step, alpha included
 * (0–255). Values that compare equal under the N20 tolerance can still get neighbouring keys, so
 * look them up with {@link toleranceKeys}.
 */
export const quantizedKey = (value: string): string =>
  !value.includes('srgb(')
    ? value
    : value.replace(
        SRGB_ANYWHERE,
        (_match, r: string, g: string, b: string, alpha: string) =>
          `srgb(${roundedStep(r, 1)} ${roundedStep(g, 1)} ${roundedStep(b, 1)} / ${roundedStep(alpha, 255)})`,
      )

// A channel x matches values in (x - 0.5, x + 0.5), whose rounded steps are floor(x) and ceil(x).
function stepOptions(text: string, scale: number): string[] {
  if (text === 'none') return [text]
  const scaled = Number(text) * scale
  const rounded = Math.round(scaled)
  const others = [Math.floor(scaled), Math.ceil(scaled)].filter((step) => step !== rounded)
  return [rounded, ...new Set(others)].map(String)
}

/**
 * Every {@link quantizedKey} that a value equal to `value` under the N20 tolerance can have, the
 * rounded key first. Above `limit` combinations, only the rounded key is returned: a lookup may
 * then miss an equal value, but never finds an unequal one.
 */
export function toleranceKeys(value: string, limit: number): string[] {
  const literals: string[] = []
  const options: string[][] = []
  let end = 0
  for (const match of value.matchAll(SRGB_ANYWHERE)) {
    literals.push(value.slice(end, match.index))
    const [, r = '', g = '', b = '', alpha = ''] = match
    options.push(stepOptions(r, 1), stepOptions(g, 1), stepOptions(b, 1), stepOptions(alpha, 255))
    end = match.index + match[0].length
  }
  const count = options.reduce((product, steps) => product * steps.length, 1)
  if (count > limit) return [quantizedKey(value)]
  let combinations: string[][] = [[]]
  for (const steps of options) {
    combinations = combinations.flatMap((prefix) => steps.map((step) => [...prefix, step]))
  }
  const tail = value.slice(end)
  return combinations.map((steps) => {
    let key = ''
    for (let color = 0; color < literals.length; color++) {
      const [r, g, b, alpha] = steps.slice(color * 4, color * 4 + 4)
      key += `${literals[color]}srgb(${r} ${g} ${b} / ${alpha})`
    }
    return key + tail
  })
}

// N20: browsers store sRGB colors as 8-bit channels, so two normal forms whose channels differ by
// less than half a step are the same color. Equality with a tolerance isn't transitive, which is
// why it can't be folded into the normal form itself.
/** Compares two normal values, letting `srgb()` channels differ by less than half an 8-bit step. */
export function equalWithColorTolerance(a: string, b: string): boolean {
  if (a === b) return true
  const channelsA: number[][] = []
  const channelsB: number[][] = []
  if (srgbSkeleton(a, channelsA) !== srgbSkeleton(b, channelsB)) return false
  return channelsA.every((color, index) =>
    color.every((value, position) =>
      channelEqual(
        value,
        channelsB[index]?.[position] ?? Number.NaN,
        position === 3 ? ALPHA_TOLERANCE : CHANNEL_TOLERANCE,
      ),
    ),
  )
}
