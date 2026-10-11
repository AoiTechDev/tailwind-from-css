import selectorParser from 'postcss-selector-parser'
import { quoteString } from './normalize/strings.ts'

type SelectorNode = selectorParser.Node
type ComplexSelector = selectorParser.Selector

/** `[ids, classes/attributes/pseudo-classes, types/pseudo-elements]`. */
export type Specificity = readonly [number, number, number]

/** A selector split into the element that takes classes and the state/pseudo-element part. */
export interface SubjectSplit {
  /** The selector without its trailing pseudo-classes and pseudo-elements, normalized. */
  readonly subject: string
  /** What was removed, relative to the subject: `&`, `&:hover`, `&:hover::before`. */
  readonly transform: string
}

interface Part {
  readonly kind: 'type' | 'universal' | 'other'
  readonly text: string
}

const parser = selectorParser()
const WHITESPACE = /\s+/g
const AN_PLUS_B = /^([+-]?\d*)n([+-]\d+)?$/
const INTEGER = /^[+-]?\d+$/
const OF_SELECTOR = /\s+of\s+/i
// postcss-selector-parser drops a trailing empty member (`a,`) but keeps an inner one (`a,,b`).
const EMPTY_LIST_MEMBER = /^,|,\s*(?:,|$)/
const COMBINATORS: ReadonlySet<string> = new Set(['', '>', '+', '~'])
const TRAILING_HEX_ESCAPE = /(?:^|[^\\])(?:\\\\)*\\[0-9a-f]{1,6}$/i

const LEGACY_PSEUDO_ELEMENTS: ReadonlySet<string> = new Set([
  ':before',
  ':after',
  ':first-line',
  ':first-letter',
])
const SELECTOR_ARGUMENT: ReadonlySet<string> = new Set([
  ':is',
  ':where',
  ':not',
  ':has',
  ':host',
  ':host-context',
  '::slotted',
])
const MAX_OF_ARGUMENTS: ReadonlySet<string> = new Set([':is', ':not', ':has'])
const NTH: ReadonlySet<string> = new Set([
  ':nth-child',
  ':nth-last-child',
  ':nth-of-type',
  ':nth-last-of-type',
])
// These identify the element rather than describe a state, so they stay in the subject.
const SUBJECT_PSEUDOS: ReadonlySet<string> = new Set([':root', ':host', ':host-context', ':scope'])

const ZERO: Specificity = [0, 0, 0]

function parse(selector: string): selectorParser.Root | undefined {
  try {
    return parser.astSync(selector)
  } catch {
    return undefined
  }
}

const isPseudoElement = (name: string): boolean =>
  name.startsWith('::') || LEGACY_PSEUDO_ELEMENTS.has(name)

function pseudoName(node: selectorParser.Pseudo): string {
  const name = node.value.toLowerCase()
  return LEGACY_PSEUDO_ELEMENTS.has(name) ? `:${name}` : name
}

const rawArguments = (node: selectorParser.Pseudo): string =>
  node.nodes.map(String).join(',').replace(WHITESPACE, ' ').trim()

// `odd` is 2n+1 and `even` is 2n; otherwise An+B is printed without spaces or redundant parts.
function normalizeAnPlusB(text: string): string {
  const compact = text.replace(WHITESPACE, '').toLowerCase()
  if (compact === 'odd') return '2n+1'
  if (compact === 'even') return '2n'
  if (INTEGER.test(compact)) return String(Number(compact))
  const match = AN_PLUS_B.exec(compact)
  // Not An+B: kept as written, never printed as `NaN`.
  if (match === null) return text.replace(WHITESPACE, ' ').trim()
  const [, a = '', b = ''] = match
  const step = a === '' || a === '+' ? '' : a === '-' ? '-' : String(Number(a))
  const offset =
    b === '' || Number(b) === 0 ? '' : Number(b) > 0 ? `+${Number(b)}` : String(Number(b))
  return `${step}n${offset}`
}

function printPseudo(node: selectorParser.Pseudo): string {
  const name = pseudoName(node)
  if (node.nodes.length === 0) return terminateEscape(name)
  if (SELECTOR_ARGUMENT.has(name)) return `${name}(${node.nodes.map(printComplex).join(',')})`
  if (!NTH.has(name)) return `${name}(${rawArguments(node)})`
  const [step = '', of] = rawArguments(node).split(OF_SELECTOR)
  return `${name}(${normalizeAnPlusB(step)}${of === undefined ? '' : ` of ${normalizeSelector(of)}`})`
}

function printAttribute(node: selectorParser.Attribute): string {
  const name = node.qualifiedAttribute
  if (node.operator === undefined) return `[${name}]`
  const flag = node.insensitive ? ' i' : ''
  return `[${name}${node.operator}${quoteString(node.value ?? '')}${flag}]`
}

// A hex escape at the end of a name (`.`) always gets its terminating space, so a space that
// follows can't be read as part of the escape on the next pass.
const terminateEscape = (text: string): string =>
  TRAILING_HEX_ESCAPE.test(text) ? `${text} ` : text

function printBare(node: SelectorNode): string {
  node.spaces.before = ''
  node.spaces.after = ''
  return terminateEscape(String(node))
}

// `:is(X)` with one compound argument matches and weighs exactly like X.
function unwrapIs(node: selectorParser.Pseudo): Part[] | undefined {
  const [argument] = node.nodes
  if (pseudoName(node) !== ':is' || node.nodes.length !== 1 || argument === undefined)
    return undefined
  const compound = argument.nodes.filter((child) => child.type !== 'comment')
  const simple = compound.every(
    (child) =>
      child.type !== 'combinator' &&
      !(child.type === 'pseudo' && isPseudoElement(pseudoName(child))),
  )
  return simple ? compound.flatMap(printPart) : undefined
}

function printPart(node: SelectorNode): Part[] {
  switch (node.type) {
    case 'tag':
      return [{ kind: 'type', text: printBare(node) }]
    case 'universal': {
      // A namespaced `ns|*` restricts the element, so only a bare `*` is droppable.
      const text = printBare(node)
      return [{ kind: text === '*' ? 'universal' : 'type', text }]
    }
    case 'attribute':
      return [{ kind: 'other', text: printAttribute(node) }]
    case 'pseudo':
      return unwrapIs(node) ?? [{ kind: 'other', text: printPseudo(node) }]
    case 'comment':
      return []
    default:
      return [{ kind: 'other', text: printBare(node) }]
  }
}

// N50: `*` next to other simple selectors adds nothing (`*:hover` ≡ `:hover`, as Tailwind 4.3
// prints what 4.2 printed as `*:hover`). A type selector moves to the front after unwrapping.
function printCompound(nodes: readonly SelectorNode[]): string {
  const parts = nodes.flatMap(printPart)
  const types = parts.filter((part) => part.kind === 'type')
  if (types.length > 1) {
    return nodes
      .map((node) =>
        node.type === 'pseudo'
          ? printPseudo(node)
          : printPart(node)
              .map((part) => part.text)
              .join(''),
      )
      .join('')
  }
  const rest = parts.filter((part) => part.kind === 'other')
  const universal = parts.some((part) => part.kind === 'universal')
  const head =
    types.length > 0
      ? types
      : universal && rest.length === 0
        ? [{ kind: 'universal', text: '*' }]
        : []
  return [...head, ...rest].map((part) => part.text).join('')
}

// Compounds alternate with combinators. A relative selector (`> p`) starts with a combinator
// and gets no space before it; a dangling one gets none after it. Trimming the whole string
// instead would also cut an escaped space (`\ `).
function printComplex(selector: ComplexSelector): string {
  const compounds: string[] = []
  const combinators: string[] = []
  let compound: SelectorNode[] = []
  for (const node of selector.nodes) {
    if (node.type !== 'combinator') {
      compound.push(node)
      continue
    }
    compounds.push(printCompound(compound))
    combinators.push(node.value.trim())
    compound = []
  }
  compounds.push(printCompound(compound))
  return compounds
    .map((text, index) => {
      const combinator = combinators[index]
      if (combinator === undefined) return text
      if (combinator === '') return text === '' ? text : `${text} `
      const before = text === '' ? '' : ' '
      const after = compounds[index + 1] === '' ? '' : ' '
      return `${text}${before}${combinator}${after}`
    })
    .join('')
}

/**
 * Normal form of a selector or selector transform (SPEC §6, N50): whitespace and combinators,
 * quoted attribute values, lowercase pseudo names, `::` for legacy pseudo-elements, canonical
 * An+B, `:is()` with one compound argument unwrapped and redundant `*` dropped. `:where()` is
 * kept, since it changes specificity. A selector that doesn't parse is only whitespace-collapsed.
 *
 * @example
 * normalizeSelector('&:not(*:HOVER) >p') // '&:not(:hover) > p'
 */
export function normalizeSelector(selector: string): string {
  const spaced = selector.replace(WHITESPACE, ' ')
  const collapsed = spaced.trim()
  return printRoot(EMPTY_LIST_MEMBER.test(collapsed) ? undefined : parse(spaced), collapsed)
}

function printRoot(root: selectorParser.Root | undefined, collapsed: string): string {
  let readable = root !== undefined
  root?.walkCombinators((combinator) => {
    if (!COMBINATORS.has(combinator.value.trim())) readable = false
  })
  return root === undefined || !readable ? collapsed : root.nodes.map(printComplex).join(',')
}

/**
 * A compiled rule's selector relative to the element: every class named `className` becomes `&`,
 * and the result is in N50 form. `undefined` when the class doesn't occur or the selector doesn't
 * parse.
 *
 * @example
 * relativeSelector('.hover\\:flex:hover', 'hover:flex') // '&:hover'
 */
export function relativeSelector(selector: string, className: string): string | undefined {
  const root = parse(selector.replace(WHITESPACE, ' '))
  const classes: selectorParser.ClassName[] = []
  root?.walkClasses((node) => {
    if (node.value === className) classes.push(node)
  })
  if (root === undefined || classes.length === 0) return undefined
  for (const node of classes) node.replaceWith(selectorParser.nesting({ value: '&' }))
  const collapsed = String(root).trim()
  // The tree is printed as is, without a second parse, unless the text has an empty list member.
  return EMPTY_LIST_MEMBER.test(collapsed) ? collapsed : printRoot(root, collapsed)
}

const add = (a: Specificity, b: Specificity): Specificity => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

const maxOf = (values: readonly Specificity[]): Specificity =>
  values.reduce((best, value) => (compareSpecificity(value, best) > 0 ? value : best), ZERO)

function pseudoSpecificity(node: selectorParser.Pseudo, nesting: Specificity): Specificity {
  const name = pseudoName(node)
  const ofArguments = node.nodes.map((argument) => complexSpecificity(argument, nesting))
  if (name === ':where') return ZERO
  if (MAX_OF_ARGUMENTS.has(name)) return maxOf(ofArguments)
  if (isPseudoElement(name)) return add([0, 0, 1], name === '::slotted' ? maxOf(ofArguments) : ZERO)
  if (name === ':host' || name === ':host-context') return add([0, 1, 0], maxOf(ofArguments))
  const [, of] = rawArguments(node).split(OF_SELECTOR)
  return add([0, 1, 0], NTH.has(name) && of !== undefined ? specificity(of, { nesting }) : ZERO)
}

function complexSpecificity(selector: ComplexSelector, nesting: Specificity): Specificity {
  return selector.nodes.reduce<Specificity>((total, node) => {
    switch (node.type) {
      case 'id':
        return add(total, [1, 0, 0])
      case 'class':
      case 'attribute':
        return add(total, [0, 1, 0])
      case 'tag':
        return add(total, [0, 0, 1])
      case 'pseudo':
        return add(total, pseudoSpecificity(node, nesting))
      case 'nesting':
        return add(total, nesting)
      default:
        return total
    }
  }, ZERO)
}

/**
 * Specificity of a selector, the highest one for a list. `&` counts as `nesting`, by default
 * nothing. A selector that doesn't parse has specificity `[0, 0, 0]`.
 */
export function specificity(
  selector: string,
  options: { nesting?: Specificity } = {},
): Specificity {
  const root = parse(selector)
  const nesting = options.nesting ?? ZERO
  return root === undefined
    ? ZERO
    : maxOf(root.nodes.map((complex) => complexSpecificity(complex, nesting)))
}

/** Orders specificities: negative when `a` is lower, positive when higher, 0 when equal. */
export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * Splits one complex selector into its subject and its trailing pseudo-classes and
 * pseudo-elements (SPEC §5.1). A compound left empty becomes `*`. `undefined` for a selector
 * list or a selector that doesn't parse.
 *
 * @example
 * extractSubject('.card .title:hover::before')
 * // { subject: '.card .title', transform: '&:hover::before' }
 */
export function extractSubject(selector: string): SubjectSplit | undefined {
  const root = parse(selector)
  const [complex] = root?.nodes ?? []
  if (complex === undefined || root?.nodes.length !== 1) return undefined
  const nodes = complex.nodes.filter((node) => node.type !== 'comment')
  let start = nodes.length
  while (start > 0) {
    const node = nodes[start - 1]
    if (node?.type !== 'pseudo' || SUBJECT_PSEUDOS.has(pseudoName(node))) break
    start--
  }
  const kept = nodes.slice(0, start)
  const emptyCompound = kept.length === 0 || kept[kept.length - 1]?.type === 'combinator'
  const subject = `${kept.map(String).join('')}${emptyCompound ? '*' : ''}`
  const transform = `&${nodes.slice(start).map(String).join('')}`
  return { subject: normalizeSelector(subject), transform: normalizeSelector(transform) }
}

/** A relative selector whose last compound starts with `&`: what it adds to the element. */
interface ElementSelector {
  /** Everything before the last compound (ancestors, siblings), as written. */
  readonly ancestor: string
  /** Simple selectors of the last compound before a pseudo-element. */
  readonly element: readonly string[]
  readonly pseudoElement: string | undefined
  /** Simple selectors after the pseudo-element (`::before:hover`). */
  readonly afterPseudo: readonly string[]
}

function elementSelector(selector: string): ElementSelector | undefined {
  const [complex, ...rest] = parse(selector)?.nodes ?? []
  if (complex === undefined || rest.length > 0) return undefined
  const nodes = complex.nodes.filter((node) => node.type !== 'comment')
  let start = nodes.length
  while (start > 0 && nodes[start - 1]?.type !== 'combinator') start--
  const [nesting, ...simple] = nodes.slice(start)
  if (nesting?.type !== 'nesting' || simple.some((node) => node.type === 'nesting')) {
    return undefined
  }
  const pseudo = simple.findIndex((node) => node.type === 'pseudo' && node.value.startsWith('::'))
  const texts = simple.map((node) => String(node).trim())
  return {
    ancestor: nodes.slice(0, start).map(String).join(''),
    element: pseudo === -1 ? texts : texts.slice(0, pseudo),
    pseudoElement: pseudo === -1 ? undefined : texts[pseudo],
    afterPseudo: pseudo === -1 ? [] : texts.slice(pseudo + 1),
  }
}

const includesAll = (whole: readonly string[], part: readonly string[]): boolean =>
  part.every((item) => whole.includes(item))

/**
 * How a rule's relative selector relates to a context's, both in N50 form: `'same'` when the rule
 * matches the context's subject whenever the context matches (`&` and `&:hover` for
 * `&:hover:focus`), `'element'` when it matches the element a pseudo-element context belongs to
 * (`&:hover` for `&:hover::before`), else `undefined`. Only selectors whose last compound starts
 * with `&` are compared beyond equality.
 *
 * @example
 * selectorRelation('&', '.dark &:hover') // 'same'
 * selectorRelation('&', '&::before')     // 'element'
 */
export function selectorRelation(rule: string, context: string): 'same' | 'element' | undefined {
  if (rule === context) return 'same'
  const ruleParts = elementSelector(rule)
  const contextParts = elementSelector(context)
  if (ruleParts === undefined || contextParts === undefined) return undefined
  if (ruleParts.ancestor !== '' && ruleParts.ancestor !== contextParts.ancestor) return undefined
  if (!includesAll(contextParts.element, ruleParts.element)) return undefined
  if (ruleParts.pseudoElement === contextParts.pseudoElement) {
    return includesAll(contextParts.afterPseudo, ruleParts.afterPseudo) ? 'same' : undefined
  }
  return ruleParts.pseudoElement === undefined ? 'element' : undefined
}

/**
 * The parts of a relative selector whose last compound starts with `&`: what comes before that
 * compound, and the simple selectors after `&`, in order. `undefined` for anything else.
 *
 * @example
 * subjectParts('.dark &:hover::before') // { ancestor: '.dark ', parts: [':hover', '::before'] }
 */
export function subjectParts(
  selector: string,
): { readonly ancestor: string; readonly parts: readonly string[] } | undefined {
  const parts = elementSelector(selector)
  if (parts === undefined) return undefined
  const pseudo = parts.pseudoElement === undefined ? [] : [parts.pseudoElement]
  return { ancestor: parts.ancestor, parts: [...parts.element, ...pseudo, ...parts.afterPseudo] }
}
