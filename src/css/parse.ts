import postcss, {
  type AtRule,
  type ChildNode,
  type Container,
  CssSyntaxError,
  type Declaration as PostcssDeclaration,
  type Root,
  type Rule,
} from 'postcss'
import { diagnostic } from '../diagnostics.ts'
import type { Diagnostic, DiagnosticCode } from '../types.ts'
import { extractSubject, nestSelector, takesClasses } from './selector.ts'

/** A declaration of a stylesheet with its 1-based position. */
export interface StyleDeclaration {
  /** Lowercase, custom properties as written. */
  readonly property: string
  readonly value: string
  readonly important: boolean
  readonly line: number
  readonly column: number
}

/** The declarations of one rule for one selector of its list, with nesting resolved. */
export interface StyleRule {
  /** The full selector, `&` nesting resolved, whitespace collapsed. */
  readonly selector: string
  /** The element the declarations are for, in N50 form (SPEC §5.1). */
  readonly subject: string
  /** What the selector adds to the subject, relative to it: `&`, `&:hover::before`. */
  readonly transform: string
  /** At-rule conditions, outermost first: `@media (min-width: 768px)`. */
  readonly conditions: readonly string[]
  readonly declarations: readonly StyleDeclaration[]
}

/** A stylesheet split into rules that can become classes and CSS that stays CSS. */
export interface ParsedStylesheet {
  /** In source order. A rule with a selector list gives one entry per selector. */
  readonly rules: readonly StyleRule[]
  /** At-rules and rules whose subject takes no classes, printed inside their wrappers. */
  readonly passthroughCss: string
  /** `TFC101`–`TFC104`, sorted by position. */
  readonly diagnostics: readonly Diagnostic[]
}

/** An at-rule or rule that encloses passthrough CSS. */
interface Wrapper {
  readonly prelude: string
}

/** What the enclosing nodes contribute to a node. */
interface Scope {
  /** Full selectors of the enclosing rule, `undefined` outside any rule. */
  readonly selectors: readonly string[] | undefined
  readonly conditions: readonly string[]
  /** Every enclosing at-rule and rule, for passthrough at-rules. */
  readonly wrappers: readonly Wrapper[]
  /** Only the enclosing at-rules, for passthrough rules (their selectors are full). */
  readonly atRules: readonly Wrapper[]
  readonly depth: number
}

interface Passthrough {
  readonly wrappers: readonly Wrapper[]
  readonly lines: readonly string[]
}

interface Found {
  /** Offset in the original text, for sorting. */
  readonly at: number
  readonly diagnostic: Diagnostic
}

interface Collected {
  readonly rules: StyleRule[]
  readonly passthrough: Passthrough[]
  readonly found: Found[]
  readonly locate: (node: ChildNode) => Location
}

interface Location {
  readonly at: number
  readonly line: number
  readonly column: number
}

/** One repair of the text: `removed` characters at `at` replaced by `inserted`. */
interface Edit {
  readonly at: number
  readonly removed: number
  readonly inserted: string
  /** The removed text when it was content (`TFC102`) rather than a stray character. */
  readonly skipped: string
}

const CONDITIONS: ReadonlySet<string> = new Set([
  'media',
  'supports',
  'container',
  'starting-style',
])
const MAX_REPAIRS = 1000
// Real stylesheets nest a few levels; this bounds the recursion and the selector lengths.
const MAX_DEPTH = 256
const INDENT = '  '
const LINE_BREAK = /[\n\r\f]/
const STATEMENT_END = /[;{}]/
const BRACKET_END = /[;{}\n\r\f]/

const CLOSERS: Readonly<Record<string, string>> = { '(': ')', '[': ']' }

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1)
  }
  return starts
}

function offsetOf(starts: readonly number[], line: number, column: number): number {
  return (starts[line - 1] ?? 0) + column - 1
}

function positionOf(starts: readonly number[], at: number): { line: number; column: number } {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if ((starts[middle] as number) <= at) low = middle
    else high = middle - 1
  }
  return { line: low + 1, column: at - (starts[low] as number) + 1 }
}

// An offset in the repaired text, back in the original one (inserted text maps to its start).
function originalOffset(edits: readonly Edit[], at: number): number {
  let offset = at
  for (let index = edits.length - 1; index >= 0; index--) {
    const edit = edits[index] as Edit
    if (offset >= edit.at + edit.inserted.length) {
      offset += edit.removed - edit.inserted.length
    } else if (offset > edit.at) offset = edit.at
  }
  return offset
}

// Depth of unclosed `{` outside strings and comments, so one repair closes every open block.
function openBlocks(text: string): number {
  let depth = 0
  let quote = ''
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quote !== '') {
      if (char === '\\') index++
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 1
    } else if (char === '{') depth++
    else if (char === '}' && depth > 0) depth--
  }
  return depth
}

const insert = (at: number, inserted: string): Edit => ({
  at,
  removed: 0,
  inserted,
  skipped: '',
})

function endOf(text: string, from: number, pattern: RegExp): number {
  const found = text.slice(from).search(pattern)
  return found === -1 ? text.length : from + found
}

/**
 * The repair for a syntax error, close to what browsers recover: close what's unclosed, drop a
 * stray `}`, `:` or `@`, add a missed `;`, and skip an unknown word up to the end of its
 * statement. `undefined` for an error this doesn't know.
 */
function repairOf(text: string, error: CssSyntaxError): Edit | undefined {
  if (error.line === undefined || error.column === undefined) return undefined
  const at = offsetOf(lineStarts(text), error.line, error.column)
  // postcss 8.5 names the word: "Unknown word color".
  const reason = error.reason.startsWith('Unknown word') ? 'Unknown word' : error.reason
  switch (reason) {
    case 'Unclosed block':
      return insert(text.length, '}'.repeat(Math.max(1, openBlocks(text))))
    case 'Unclosed comment':
      return insert(text.length, '*/')
    case 'Unclosed string':
      return insert(endOf(text, at + 1, LINE_BREAK), text[at] ?? '"')
    case 'Unclosed bracket':
      return insert(endOf(text, at + 1, BRACKET_END), CLOSERS[text[at] ?? ''] ?? ')')
    case 'Missed semicolon':
      return insert(at, ';')
    case 'Unexpected }':
    case 'Double colon':
    case 'At-rule without name':
      return { at, removed: 1, inserted: '', skipped: '' }
    case 'Unknown word': {
      const end = endOf(text, at, STATEMENT_END)
      const removed = Math.max(1, end - at + (text[end] === ';' ? 1 : 0))
      return { at, removed, inserted: '', skipped: text.slice(at, at + removed).trim() || ' ' }
    }
    default:
      return undefined
  }
}

interface Parsed {
  readonly root: Root
  readonly edits: readonly Edit[]
}

// SPEC §5.1: postcss first; on a syntax error, repair the text and parse again.
function parseLeniently(css: string): Parsed | undefined {
  let text = css
  const edits: Edit[] = []
  for (;;) {
    try {
      return { root: postcss.parse(text), edits }
    } catch (error) {
      if (!(error instanceof CssSyntaxError) || edits.length === MAX_REPAIRS) return undefined
      const edit = repairOf(text, error)
      if (edit === undefined) return undefined
      text = text.slice(0, edit.at) + edit.inserted + text.slice(edit.at + edit.removed)
      edits.push(edit)
    }
  }
}

const preludeOf = (node: AtRule): string =>
  node.params === '' ? `@${node.name}` : `@${node.name} ${node.params}`

function printNode(node: ChildNode): string[] {
  switch (node.type) {
    case 'decl':
      return [`${node.prop}: ${node.value.trim()}${node.important ? ' !important' : ''};`]
    case 'rule':
      return printBlock(node.selector, node)
    case 'atrule':
      return node.nodes === undefined ? [`${preludeOf(node)};`] : printBlock(preludeOf(node), node)
    default:
      return []
  }
}

function printBlock(prelude: string, container: Container): string[] {
  const body = (container.nodes ?? []).flatMap(printNode).map((line) => INDENT + line)
  return [`${prelude} {`, ...body, '}']
}

// Adjacent passthrough blocks share the wrappers they have in common.
function printPassthrough(items: readonly Passthrough[]): string {
  const lines: string[] = []
  const open: Wrapper[] = []
  for (const item of items) {
    let common = 0
    while (common < open.length && open[common]?.prelude === item.wrappers[common]?.prelude)
      common++
    while (open.length > common) {
      open.pop()
      lines.push(`${INDENT.repeat(open.length)}}`)
    }
    if (open.length === 0 && lines.length > 0) lines.push('')
    for (const wrapper of item.wrappers.slice(common)) {
      lines.push(`${INDENT.repeat(open.length)}${wrapper.prelude} {`)
      open.push(wrapper)
    }
    for (const line of item.lines) lines.push(INDENT.repeat(open.length) + line)
  }
  while (open.length > 0) {
    open.pop()
    lines.push(`${INDENT.repeat(open.length)}}`)
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

function note(
  collected: Collected,
  location: Location,
  code: DiagnosticCode,
  message: string,
): void {
  const text = `${message} (${location.line}:${location.column})`
  collected.found.push({ at: location.at, diagnostic: diagnostic(code, text) })
}

function styleDeclaration(node: PostcssDeclaration, location: Location): StyleDeclaration {
  const property = node.prop.startsWith('--') ? node.prop : node.prop.toLowerCase()
  return {
    property,
    // Custom properties keep their whitespace in postcss, but CSS trims it.
    value: node.value.trim(),
    important: node.important,
    line: location.line,
    column: location.column,
  }
}

// The declarations of a container, as one rule per selector of the enclosing rule.
function flush(
  collected: Collected,
  scope: Scope,
  container: Container,
  run: readonly PostcssDeclaration[],
): void {
  if (scope.selectors === undefined) {
    for (const node of run) {
      const message = `The declaration "${node.prop}: ${node.value}" is outside any rule and was skipped.`
      note(collected, collected.locate(node), 'TFC102', message)
    }
    return
  }
  if (run.length === 0) return
  const declarations = run.map((node) => styleDeclaration(node, collected.locate(node)))
  const passthrough: string[] = []
  for (const selector of scope.selectors) {
    const split = extractSubject(selector)
    if (split !== undefined && takesClasses(split.subject)) {
      collected.rules.push({
        selector,
        subject: split.subject,
        transform: split.transform,
        conditions: scope.conditions,
        declarations,
      })
      continue
    }
    passthrough.push(selector)
    note(
      collected,
      collected.locate(container as ChildNode),
      'TFC104',
      `The rule "${selector}" has no element to put classes on and was moved to passthroughCss.`,
    )
  }
  if (passthrough.length === 0) return
  collected.passthrough.push({
    wrappers: scope.atRules,
    lines: [
      `${passthrough.join(', ')} {`,
      ...run.flatMap(printNode).map((line) => INDENT + line),
      '}',
    ],
  })
}

function walk(collected: Collected, scope: Scope, container: Container): void {
  if (scope.depth > MAX_DEPTH) throw new RangeError(`Nested deeper than ${MAX_DEPTH} levels.`)
  let run: PostcssDeclaration[] = []
  for (const node of container.nodes ?? []) {
    if (node.type === 'comment') continue
    if (node.type === 'decl') {
      run.push(node)
      continue
    }
    flush(collected, scope, container, run)
    run = []
    if (node.type === 'rule') walkRule(collected, scope, node)
    else walkAtRule(collected, scope, node)
  }
  flush(collected, scope, container, run)
}

function nestedSelectors(
  selector: string,
  parents: readonly string[] | undefined,
): string[] | undefined {
  if (parents === undefined) return nestSelector(selector)
  const selectors: string[] = []
  for (const parent of parents) {
    const nested = nestSelector(selector, parent)
    if (nested === undefined) return undefined
    selectors.push(...nested)
  }
  return selectors
}

function walkRule(collected: Collected, scope: Scope, node: Rule): void {
  const selectors = nestedSelectors(node.selector, scope.selectors)
  if (selectors === undefined) {
    collected.passthrough.push({ wrappers: scope.wrappers, lines: printNode(node) })
    note(
      collected,
      collected.locate(node),
      'TFC104',
      `The selector "${node.selector}" can't be read and the rule was moved to passthroughCss.`,
    )
    return
  }
  const wrapper = { prelude: selectors.join(', ') }
  walk(
    collected,
    { ...scope, selectors, wrappers: [...scope.wrappers, wrapper], depth: scope.depth + 1 },
    node,
  )
}

function walkAtRule(collected: Collected, scope: Scope, node: AtRule): void {
  const name = node.name.toLowerCase()
  if (node.nodes !== undefined && (CONDITIONS.has(name) || name === 'layer')) {
    const wrapper = { prelude: preludeOf(node) }
    const condition = node.params === '' ? `@${name}` : `@${name} ${node.params}`
    walk(
      collected,
      {
        selectors: scope.selectors,
        conditions: name === 'layer' ? scope.conditions : [...scope.conditions, condition],
        wrappers: [...scope.wrappers, wrapper],
        atRules: [...scope.atRules, wrapper],
        depth: scope.depth + 1,
      },
      node,
    )
    return
  }
  collected.passthrough.push({ wrappers: scope.wrappers, lines: printNode(node) })
  note(
    collected,
    collected.locate(node),
    'TFC103',
    `The at-rule "${preludeOf(node)}" was moved to passthroughCss.`,
  )
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const compareFound = (a: Found, b: Found): number =>
  a.at - b.at ||
  compareText(a.diagnostic.code, b.diagnostic.code) ||
  compareText(a.diagnostic.message, b.diagnostic.message)

/**
 * Reads a stylesheet into rules that can become classes (SPEC §5.1). `@layer` is flattened;
 * `@media`, `@supports`, `@container` and `@starting-style` become conditions; `&` nesting is
 * resolved and selector lists are split; each selector is split into its subject and transform.
 * Other at-rules (`TFC103`) and rules whose subject takes no classes (`TFC104`) go to
 * `passthroughCss`. Syntax errors are repaired like browsers recover (skipped words are
 * `TFC102`); what can't be repaired gives `TFC101` and nothing else. Never throws.
 *
 * @example
 * parseStylesheet('.btn:hover { color: red }').rules[0]
 * // { selector: '.btn:hover', subject: '.btn', transform: '&:hover', conditions: [], declarations: [{ property: 'color', value: 'red', important: false, line: 1, column: 13 }] }
 */
export function parseStylesheet(css: string): ParsedStylesheet {
  const parsed = parseLeniently(css)
  if (parsed === undefined) {
    const failed = diagnostic('TFC101', 'The stylesheet could not be parsed.')
    return { rules: [], passthroughCss: '', diagnostics: [failed] }
  }
  const original = lineStarts(css)
  const locate = (node: ChildNode): Location => {
    const at = originalOffset(parsed.edits, node.source?.start?.offset ?? 0)
    return { at, ...positionOf(original, at) }
  }
  const collected: Collected = { rules: [], passthrough: [], found: [], locate }
  parsed.edits.forEach((edit, index) => {
    if (edit.skipped === '') return
    const at = originalOffset(parsed.edits.slice(0, index), edit.at)
    const message = `Skipped "${edit.skipped}", which isn't valid CSS.`
    note(collected, { at, ...positionOf(original, at) }, 'TFC102', message)
  })
  try {
    walk(
      collected,
      { selectors: undefined, conditions: [], wrappers: [], atRules: [], depth: 0 },
      parsed.root,
    )
  } catch (error) {
    // Nesting deeper than MAX_DEPTH, or than the call stack in a passthrough block.
    if (!(error instanceof RangeError)) throw error
    const failed = diagnostic('TFC101', 'The stylesheet is nested too deeply to be parsed.')
    return { rules: [], passthroughCss: '', diagnostics: [failed] }
  }
  return {
    rules: collected.rules,
    passthroughCss: printPassthrough(collected.passthrough),
    diagnostics: collected.found.sort(compareFound).map((found) => found.diagnostic),
  }
}
