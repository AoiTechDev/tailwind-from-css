import type { Node } from 'postcss-value-parser'
import { type Dimension, formatDimension, formatNumber, parseDimension } from './lengths.ts'

export const MATH_FUNCTIONS: ReadonlySet<string> = new Set(['calc', 'min', 'max', 'clamp'])

/** What the folder needs from the value printer. */
export interface MathHooks {
  /** Puts a leaf dimension into its normal unit (N10, N15, N16). */
  convert(dimension: Dimension): Dimension
  /** Prints a node that can't take part in folding (`var()`, `env()`, unknown functions). */
  printNode(node: Node): string
  /** Prints a node list that isn't a valid math expression. */
  printNodes(nodes: readonly Node[]): string
}

type Operator = '+' | '-' | '*' | '/'

type Expression =
  | { readonly kind: 'value'; readonly dimension: Dimension }
  | { readonly kind: 'constant'; readonly value: number; readonly text: string }
  | { readonly kind: 'opaque'; readonly text: string }
  | { readonly kind: 'group'; readonly inner: Expression }
  | { readonly kind: 'math'; readonly name: string; readonly args: readonly Expression[] }
  | {
      readonly kind: 'binary'
      readonly operator: Operator
      readonly left: Expression
      readonly right: Expression
    }

/** A sum of terms, unit → coefficient (`''` for a plain number). */
type Linear = ReadonlyMap<string, number>

const CONSTANTS: ReadonlyMap<string, number> = new Map([
  ['infinity', Number.POSITIVE_INFINITY],
  ['-infinity', Number.NEGATIVE_INFINITY],
  ['nan', Number.NaN],
  ['pi', Math.PI],
  ['e', Math.E],
])

const isOperator = (node: Node | undefined, operators: string): boolean =>
  node !== undefined &&
  (node.type === 'word' || node.type === 'div') &&
  operators.includes(node.value)

interface Cursor {
  readonly nodes: readonly Node[]
  index: number
}

const peek = (cursor: Cursor): Node | undefined => cursor.nodes[cursor.index]
const next = (cursor: Cursor): Node | undefined => cursor.nodes[cursor.index++]

function cursorOver(nodes: readonly Node[]): Cursor {
  return {
    nodes: nodes.filter((node) => node.type !== 'space' && node.type !== 'comment'),
    index: 0,
  }
}

function splitArguments(nodes: readonly Node[]): Node[][] {
  const args: Node[][] = [[]]
  for (const node of nodes) {
    if (node.type === 'div' && node.value === ',') args.push([])
    else args[args.length - 1]?.push(node)
  }
  return args
}

function parseArguments(
  name: string,
  nodes: readonly Node[],
  hooks: MathHooks,
): Expression[] | undefined {
  const args = (name === 'calc' ? [[...nodes]] : splitArguments(nodes)).map((arg) => {
    const cursor = cursorOver(arg)
    const expression = parseSum(cursor, hooks)
    return peek(cursor) === undefined ? expression : undefined
  })
  const arity = name === 'clamp' ? args.length === 3 : args.length >= 1
  return arity && args.every((arg) => arg !== undefined) ? (args as Expression[]) : undefined
}

function parseSum(cursor: Cursor, hooks: MathHooks): Expression | undefined {
  let left = parseProduct(cursor, hooks)
  while (left !== undefined && isOperator(peek(cursor), '+-')) {
    const operator = next(cursor)?.value as Operator
    const right = parseProduct(cursor, hooks)
    left = right === undefined ? undefined : { kind: 'binary', operator, left, right }
  }
  return left
}

function parseProduct(cursor: Cursor, hooks: MathHooks): Expression | undefined {
  let left = parseAtom(cursor, hooks)
  while (left !== undefined && isOperator(peek(cursor), '*/')) {
    const operator = next(cursor)?.value as Operator
    const right = parseAtom(cursor, hooks)
    left = right === undefined ? undefined : { kind: 'binary', operator, left, right }
  }
  return left
}

function parseAtom(cursor: Cursor, hooks: MathHooks): Expression | undefined {
  const node = next(cursor)
  if (node === undefined || isOperator(node, '+-*/')) return undefined
  if (node.type === 'function') {
    const name = node.value.toLowerCase()
    if (name === '') {
      const inner = cursorOver(node.nodes)
      const expression = parseSum(inner, hooks)
      return expression && peek(inner) === undefined
        ? { kind: 'group', inner: expression }
        : undefined
    }
    if (MATH_FUNCTIONS.has(name)) {
      const args = parseArguments(name, node.nodes, hooks)
      return args && { kind: 'math', name, args }
    }
  }
  if (node.type === 'word') {
    const dimension = parseDimension(node.value)
    if (dimension !== undefined) return { kind: 'value', dimension: hooks.convert(dimension) }
    const lower = node.value.toLowerCase()
    const constant = CONSTANTS.get(lower)
    if (constant !== undefined)
      return { kind: 'constant', value: constant, text: lower === 'nan' ? 'NaN' : lower }
  }
  return { kind: 'opaque', text: hooks.printNode(node) }
}

const isPureNumber = (linear: Linear): boolean => linear.size === 1 && linear.has('')

function scale(linear: Linear, factor: number): Linear {
  return new Map([...linear].map(([unit, coefficient]) => [unit, coefficient * factor]))
}

function add(left: Linear, right: Linear, sign: number): Linear | undefined {
  if (isPureNumber(left) !== isPureNumber(right)) return undefined
  const sum = new Map(left)
  for (const [unit, coefficient] of right) sum.set(unit, (sum.get(unit) ?? 0) + sign * coefficient)
  return sum
}

function combine(operator: Operator, left: Linear, right: Linear): Linear | undefined {
  if (operator === '+' || operator === '-') return add(left, right, operator === '+' ? 1 : -1)
  if (operator === '/')
    return isPureNumber(right) ? scale(left, 1 / (right.get('') ?? 1)) : undefined
  if (isPureNumber(left)) return scale(right, left.get('') ?? 1)
  return isPureNumber(right) ? scale(left, right.get('') ?? 1) : undefined
}

// min/max/clamp fold only when every argument is one term of the same unit.
function evaluateComparison(name: string, args: readonly Linear[]): Linear | undefined {
  const [unit = '', ...others] = new Set(args.flatMap((arg) => [...arg.keys()]))
  if (others.length > 0 || args.some((arg) => arg.size !== 1)) return undefined
  const values = args.map((arg) => arg.get(unit) ?? 0)
  const [low = 0, preferred = 0, high = 0] = values
  const value =
    name === 'min'
      ? Math.min(...values)
      : name === 'max'
        ? Math.max(...values)
        : Math.max(low, Math.min(preferred, high))
  return new Map([[unit, value]])
}

function evaluate(expression: Expression): Linear | undefined {
  switch (expression.kind) {
    case 'value':
      return new Map([[expression.dimension.unit, expression.dimension.value]])
    case 'constant':
      return new Map([['', expression.value]])
    case 'opaque':
      return undefined
    case 'group':
      return evaluate(expression.inner)
    case 'math': {
      const args = expression.args.map(evaluate)
      if (!args.every((arg) => arg !== undefined)) return undefined
      return expression.name === 'calc' ? args[0] : evaluateComparison(expression.name, args)
    }
    case 'binary': {
      const left = evaluate(expression.left)
      const right = evaluate(expression.right)
      return left && right && combine(expression.operator, left, right)
    }
  }
}

function printCoefficient(coefficient: number, unit: string): string {
  if (Number.isFinite(coefficient)) return formatNumber(coefficient) + unit
  const text = Number.isNaN(coefficient) ? 'NaN' : 'infinity'
  return unit === '' ? text : `${text} * 1${unit}`
}

// N12: a folded result is one dimension when it has one unit. Mixed units stay a calc() with
// terms sorted by unit, so `calc(100% - 1rem)` and `calc(-16px + 100%)` print the same.
// Infinite and NaN results stay calc(), which keeps `calc(infinity * 1px)` apart from 9999px.
// N14 needs no rule of its own: `calc(1/2 * 100%)` folds to the single term 50%.
function printLinear(linear: Linear): Dimension | string {
  const terms = [...linear].filter(([, coefficient]) => coefficient !== 0)
  const [only] = terms
  if (terms.length === 0)
    return { value: 0, unit: linear.has('px') ? 'px' : ([...linear.keys()].sort()[0] ?? '') }
  if (terms.length === 1 && only !== undefined && Number.isFinite(only[1]))
    return { value: only[1], unit: only[0] }
  const body = terms
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([unit, coefficient], index) => {
      const term = printCoefficient(Math.abs(coefficient), unit)
      if (index === 0) return coefficient < 0 ? `-${term}` : term
      return `${coefficient < 0 ? '-' : '+'} ${term}`
    })
    .join(' ')
  return `calc(${body})`
}

function printFolded(result: Dimension | string): string {
  return typeof result === 'string' ? result : formatDimension(result)
}

// Arguments are separated by commas, so each one folds on its own even when the function can't.
function printFoldable(expression: Expression): string {
  const folded = evaluate(expression)
  return folded === undefined ? printExpression(expression) : printFolded(printLinear(folded))
}

function printExpression(expression: Expression): string {
  switch (expression.kind) {
    case 'value':
      return formatDimension(expression.dimension)
    case 'constant':
    case 'opaque':
      return expression.text
    case 'group':
      return `(${printExpression(expression.inner)})`
    case 'math': {
      const folded = evaluate(expression)
      if (folded !== undefined) return printFolded(printLinear(folded))
      return `${expression.name}(${expression.args.map(printFoldable).join(',')})`
    }
    case 'binary':
      return `${printExpression(expression.left)} ${expression.operator} ${printExpression(expression.right)}`
  }
}

/**
 * Normal form of `calc()`, `min()`, `max()` or `clamp()` with arguments `nodes`. A result that
 * folds to one finite dimension is returned as a {@link Dimension}, so the caller can apply its own
 * context rules (N11); anything else is the printed function.
 */
export function normalizeMath(
  name: string,
  nodes: readonly Node[],
  hooks: MathHooks,
): Dimension | string {
  const args = parseArguments(name, nodes, hooks)
  if (args === undefined) return `${name}(${hooks.printNodes(nodes)})`
  const expression: Expression = { kind: 'math', name, args }
  const folded = evaluate(expression)
  return folded === undefined ? printExpression(expression) : printLinear(folded)
}
