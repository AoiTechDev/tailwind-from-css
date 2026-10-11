import { TfcError } from '../errors.ts'

/** A candidate Tailwind lists, with the modifiers it accepts (`text-sm` → `tight`, `snug` …). */
export interface ClassListEntry {
  /** Ready-to-use candidate, with the theme prefix applied (`tw:flex` under `prefix(tw)`). */
  readonly name: string
  readonly modifiers: readonly string[]
}

/** One declaration of a compiled rule. */
export interface CandidateDeclaration {
  readonly property: string
  readonly value: string
  readonly important: boolean
}

/** A style rule of a compiled candidate, with CSS nesting resolved. */
export interface CandidateRule {
  /** Full selector, e.g. `.hover\:flex:hover`. */
  readonly selector: string
  /** Enclosing at-rules, outermost first, e.g. `['@media (hover: hover)']`. */
  readonly conditions: readonly string[]
  /** In source order; a later declaration of the same property wins. */
  readonly declarations: readonly CandidateDeclaration[]
}

/** An `@property` registration emitted with a candidate. Descriptor values are kept verbatim. */
export interface PropertyRule {
  /** The registered custom property, e.g. `--tw-border-style`. */
  readonly name: string
  readonly syntax: string | undefined
  readonly inherits: boolean | undefined
  readonly initialValue: string | undefined
}

/** What one candidate compiles to. */
export interface CandidateAst {
  readonly rules: readonly CandidateRule[]
  readonly properties: readonly PropertyRule[]
}

/** A variant Tailwind knows, built-in or custom. */
export interface VariantEntry {
  readonly name: string
  /** Accepts an arbitrary value: `min-[600px]`, `data-[state=open]`. */
  readonly isArbitrary: boolean
  /** Named values of a functional variant (`aria-checked` → `checked`). */
  readonly values: readonly string[]
  readonly hasDash: boolean
  /** Selectors or at-rules the variant applies, e.g. `['@media (hover: hover) { &:hover }']`. */
  selectors(options: { modifier?: string; value?: string }): string[]
}

/** A stylesheet loaded for `@import`. `base` is the directory its own imports resolve from. */
export interface LoadedStylesheet {
  path: string
  base: string
  content: string
}

/** A module loaded for `@plugin` or `@config`: its default export, or the namespace without one. */
export interface LoadedModule {
  path: string
  base: string
  module: unknown
}

/** How `@import`, `@plugin` and `@config` in the entry CSS are resolved. */
export interface LoadDesignSystemOptions {
  /** Directory the entry CSS's own imports resolve from. */
  base: string
  loadStylesheet(id: string, base: string): Promise<LoadedStylesheet>
  loadModule(id: string, base: string, resourceHint: 'plugin' | 'config'): Promise<LoadedModule>
}

/**
 * The loaded design system, behind a small interface that is stable across Tailwind versions.
 * This is the only view of Tailwind the rest of the library gets.
 */
export interface TailwindDesignSystem {
  /** Installed `tailwindcss` version. */
  readonly version: string
  /** The `prefix()` of the entry CSS, without the colon, or `null`. */
  readonly prefix: string | null
  /** Every named and bare candidate, negatives included, in Tailwind's order. */
  classList(): ClassListEntry[]
  /** Compiles each candidate on its own. `null` for a candidate that doesn't compile. */
  toAst(candidates: readonly string[]): (CandidateAst | null)[]
  /** Tailwind's sort key for each candidate, `null` for one that doesn't compile. */
  classOrder(candidates: readonly string[]): (bigint | null)[]
  variants(): VariantEntry[]
  /** Roots of functional utilities (`p`, `-mt`, `text` …), sorted. */
  functionalRoots(): string[]
  /** Value of a theme variable, by its unprefixed name (`--color-red-500`). */
  themeValue(name: string): string | undefined
}

type RawNode =
  | { kind: 'rule'; selector: string; nodes: RawNode[] }
  | { kind: 'at-rule'; name: string; params: string; nodes: RawNode[] }
  | { kind: 'declaration'; property: string; value: string | undefined; important: boolean }
  | { kind: 'context' | 'at-root'; nodes: RawNode[] }
  | { kind: 'comment' }

interface RawDesignSystem {
  theme: { prefix: string | null }
  utilities: { keys(kind: 'functional'): string[] }
  getClassList(): [string, { modifiers: string[] }][]
  getVariants(): VariantEntry[]
  candidatesToAst(candidates: string[]): RawNode[][]
  getClassOrder(candidates: string[]): [string, bigint | null][]
  getVariantOrder?(): ReadonlyMap<unknown, number>
  parseCandidate?(candidate: string): unknown
  resolveThemeValue(path: string): string | undefined
}

interface RawTailwind {
  __unstable__loadDesignSystem(
    css: string,
    options: LoadDesignSystemOptions,
  ): Promise<RawDesignSystem>
}

// SPEC §10: peer range ^4.2.0. Prereleases of a supported minor count as supported, and so do
// insiders builds (0.0.0-insiders.<sha>), which the weekly compatibility job installs.
const SUPPORTED_VERSION = /^4\.(?:[2-9]|\d{2,})\.\d+(?:-.+)?$|^0\.0\.0-insiders\./

/**
 * Loads Tailwind's design system for an entry stylesheet and checks that the installed
 * `tailwindcss` provides everything the engine uses.
 *
 * @throws {TfcError} `TFC901` when `tailwindcss` can't be imported, `TFC902` when its version is
 * outside `^4.2.0` or an internal API is missing, `TFC903` when the entry CSS fails to load.
 * @example
 * ```ts
 * const design = await loadDesignSystem('@import "tailwindcss";', {
 *   base: process.cwd(),
 *   loadStylesheet,
 *   loadModule,
 * })
 * design.toAst(['p-4'])
 * ```
 */
export async function loadDesignSystem(
  css: string,
  options: LoadDesignSystemOptions,
): Promise<TailwindDesignSystem> {
  const { version, tailwind } = await importTailwind()
  let raw: RawDesignSystem
  try {
    raw = await tailwind.__unstable__loadDesignSystem(css, {
      base: options.base,
      loadStylesheet: options.loadStylesheet,
      loadModule: options.loadModule,
    })
  } catch (error) {
    if (error instanceof TfcError) throw error
    throw new TfcError('TFC903', `The Tailwind entry CSS failed to load: ${messageOf(error)}`, {
      cause: error,
    })
  }
  assertDesignSystem(raw, version)
  return wrap(raw, version)
}

async function importTailwind(): Promise<{ version: string; tailwind: RawTailwind }> {
  let version: unknown
  let tailwind: Record<string, unknown>
  try {
    const manifest = await import('tailwindcss/package.json', { with: { type: 'json' } })
    version = (manifest.default as { version?: unknown }).version
    tailwind = await import('tailwindcss')
  } catch (error) {
    throw new TfcError(
      'TFC901',
      `tailwindcss could not be imported. Install it next to tailwind-from-css: ${messageOf(error)}`,
      { cause: error },
    )
  }
  if (typeof version !== 'string' || !SUPPORTED_VERSION.test(version)) {
    throw new TfcError(
      'TFC902',
      `tailwindcss ${String(version)} is installed, but tailwind-from-css needs ^4.2.0.`,
    )
  }
  if (typeof tailwind.__unstable__loadDesignSystem !== 'function') {
    throw missingApi('__unstable__loadDesignSystem', version)
  }
  return { version, tailwind: tailwind as unknown as RawTailwind }
}

const REQUIRED_METHODS = [
  'getClassList',
  'getVariants',
  'candidatesToAst',
  'getClassOrder',
  'resolveThemeValue',
] as const

function assertDesignSystem(raw: RawDesignSystem, version: string): void {
  const record = raw as unknown as Record<string, unknown>
  for (const method of REQUIRED_METHODS) {
    if (typeof record[method] !== 'function') throw missingApi(method, version)
  }
  if (typeof raw.utilities?.keys !== 'function') throw missingApi('utilities.keys', version)
  if (typeof raw.theme !== 'object' || raw.theme === null) throw missingApi('theme', version)
}

function missingApi(name: string, version: string): TfcError {
  return new TfcError(
    'TFC902',
    `tailwindcss ${version} lacks ${name}, which tailwind-from-css needs. ` +
      'Please report this with your tailwindcss version.',
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function wrap(raw: RawDesignSystem, version: string): TailwindDesignSystem {
  const parse = memoizeVariantOrder(raw)
  const prefix = raw.theme.prefix ?? null
  const withPrefix =
    prefix === null ? (name: string) => name : (name: string) => `${prefix}:${name}`
  return {
    version,
    prefix,
    classList: () =>
      raw.getClassList().map(([name, meta]) => ({
        name: withPrefix(name),
        modifiers: meta.modifiers,
      })),
    toAst: (candidates) => {
      parse(candidates)
      return raw
        .candidatesToAst([...candidates])
        .map((nodes) => (nodes.length === 0 ? null : flatten(nodes)))
    },
    classOrder: (candidates) => {
      parse(candidates)
      return raw.getClassOrder([...candidates]).map(([, order]) => order)
    },
    variants: () => raw.getVariants(),
    functionalRoots: () => [...new Set(raw.utilities.keys('functional'))].sort(),
    themeValue: (name) => raw.resolveThemeValue(name),
  }
}

/**
 * Tailwind (4.2.0 to 4.3.3) compiles every candidate of `candidatesToAst`/`getClassOrder` on
 * its own, and each compile calls `getVariantOrder()`, which sorts every variant parsed so far.
 * Once the variant index has parsed a few hundred variants, each compile costs ≈ 0.2 ms more
 * (the class list then takes 4 s instead of 0.2 s). The order is kept until a compile asks for a
 * variant it doesn't rank yet; ranks only order variants against each other, so a kept order
 * that ranks every variant asked for gives the same output. Parsing a batch's candidates first
 * (Tailwind caches parses) registers all their variants, so a batch recomputes the order at most
 * once. Returns that parse step.
 */
function memoizeVariantOrder(raw: RawDesignSystem): (candidates: readonly string[]) => void {
  const compute = raw.getVariantOrder?.bind(raw)
  const parseCandidate = raw.parseCandidate?.bind(raw)
  const parse = (candidates: readonly string[]): void => {
    if (parseCandidate !== undefined) for (const candidate of candidates) parseCandidate(candidate)
  }
  if (compute === undefined) return () => {}
  let order: ReadonlyMap<unknown, number> | undefined
  const view = {
    get(variant: unknown): number | undefined {
      order ??= compute()
      if (!order.has(variant)) order = compute()
      return order.get(variant)
    },
  }
  raw.getVariantOrder = () => view as unknown as ReadonlyMap<unknown, number>
  return parse
}

interface MutableRule {
  selector: string
  conditions: string[]
  declarations: CandidateDeclaration[]
}

/**
 * Flattens Tailwind's AST into style rules with full selectors. Tailwind 4.2 returns variants as
 * nested rules (`.x { &:hover { @media (hover: hover) { … } } }`); 4.3 flattens most of them but
 * still nests rules inside plugin and `@utility` bodies.
 */
function flatten(nodes: readonly RawNode[]): CandidateAst {
  const ast = { rules: [] as MutableRule[], properties: [] as PropertyRule[] }
  visit(nodes, null, [], ast)
  return ast
}

function visit(
  nodes: readonly RawNode[],
  selector: string | null,
  conditions: string[],
  ast: { rules: MutableRule[]; properties: PropertyRule[] },
): void {
  // Declarations that follow a nested rule start a new rule, so source order is kept.
  let current: MutableRule | null = null
  for (const node of nodes) {
    switch (node.kind) {
      case 'declaration':
        if (selector === null || node.value === undefined) break
        if (current === null) {
          current = { selector, conditions, declarations: [] }
          ast.rules.push(current)
        }
        current.declarations.push({
          property: node.property,
          value: node.value,
          important: node.important,
        })
        break
      case 'rule':
        visit(
          node.nodes,
          selector === null ? node.selector : nest(node.selector, selector),
          conditions,
          ast,
        )
        current = null
        break
      case 'at-rule':
        if (node.name === '@property' && selector === null) {
          ast.properties.push(propertyRule(node.params, node.nodes))
        } else {
          const condition = node.params === '' ? node.name : `${node.name} ${node.params}`
          visit(node.nodes, selector, [...conditions, condition], ast)
          current = null
        }
        break
      case 'context':
        visit(node.nodes, selector, conditions, ast)
        current = null
        break
      case 'at-root':
        visit(node.nodes, null, [], ast)
        current = null
        break
      case 'comment':
        break
    }
  }
}

function propertyRule(name: string, nodes: readonly RawNode[]): PropertyRule {
  const descriptors = new Map<string, string>()
  for (const node of nodes) {
    if (node.kind === 'declaration' && node.value !== undefined) {
      descriptors.set(node.property, node.value)
    }
  }
  const inherits = descriptors.get('inherits')
  return {
    name,
    syntax: descriptors.get('syntax'),
    inherits: inherits === undefined ? undefined : inherits === 'true',
    initialValue: descriptors.get('initial-value'),
  }
}

/**
 * Resolves a nested selector against its parent, like CSS nesting: in each selector of the list,
 * every `&` outside strings and escapes becomes the parent (wrapped in `:is()` when the parent is
 * a list), and a selector without `&` becomes a descendant of the parent.
 */
function nest(selector: string, parent: string): string {
  const replacement = splitList(parent).length > 1 ? `:is(${parent})` : parent
  return splitList(selector)
    .map((part) => {
      let out = ''
      let found = false
      scan(part, (char, _index, plain) => {
        if (plain && char === '&') {
          out += replacement
          found = true
        } else {
          out += char
        }
      })
      return found ? out : `${replacement} ${part}`
    })
    .join(', ')
}

/** Splits a selector list at its top-level commas and trims each selector. */
function splitList(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  scan(selector, (char, index, plain) => {
    if (!plain) return
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === ',' && depth === 0) {
      parts.push(selector.slice(start, index).trim())
      start = index + 1
    }
  })
  parts.push(selector.slice(start).trim())
  return parts
}

/**
 * Walks a selector, calling `visit` with each character, or each escape sequence as one unit.
 * `plain` is false for escapes and for characters inside quoted strings.
 */
function scan(text: string, visit: (char: string, index: number, plain: boolean) => void): void {
  let quote: string | null = null
  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string
    if (char === '\\') {
      visit(text.slice(index, index + 2), index, false)
      index++
    } else if (quote !== null) {
      if (char === quote) quote = null
      visit(char, index, false)
    } else {
      if (char === '"' || char === "'") quote = char
      visit(char, index, quote === null)
    }
  }
}
