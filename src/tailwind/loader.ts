import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TfcError } from '../errors.ts'
import type { LoadedModule, LoadedStylesheet } from './adapter.ts'

interface ResolveRules {
  /** `exports` conditions, besides `default`, in no particular order. */
  conditions: readonly string[]
  /** Extensions tried on a path without a match. */
  extensions: readonly string[]
  /** `package.json` field that names the entry when the package has no `exports`. */
  mainField: string
  /** Entry file when the package has neither `exports` nor the main field. */
  index: string
}

// Same rules as Tailwind's own Node loader: stylesheets resolve through the `style` condition and
// field, modules like Node's `import()`.
const CSS: ResolveRules = {
  conditions: ['style'],
  extensions: ['.css'],
  mainField: 'style',
  index: 'index.css',
}

const JS: ResolveRules = {
  conditions: ['node', 'import', 'module-sync'],
  extensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'],
  mainField: 'main',
  index: 'index.js',
}

/**
 * Loads a stylesheet for an `@import` in the Tailwind entry CSS: a relative or absolute path, or a
 * package (through its `style` export condition or `style` field, like `tailwindcss` itself).
 *
 * @throws {TfcError} `TFC903` when the stylesheet can't be found or read, with the cause attached.
 * @example
 * ```ts
 * await loadStylesheet('tailwindcss', process.cwd()) // → { path: '…/tailwindcss/index.css', … }
 * ```
 */
export async function loadStylesheet(id: string, base: string): Promise<LoadedStylesheet> {
  try {
    const path = resolveId(id, base, CSS)
    return { path, base: dirname(path), content: await readFile(path, 'utf8') }
  } catch (error) {
    throw new TfcError('TFC903', `Can't load @import "${id}" from ${base}: ${messageOf(error)}`, {
      cause: error,
    })
  }
}

/**
 * Loads a module for `@plugin` or `@config` with a dynamic `import()`, so ESM and CommonJS both
 * work. TypeScript files need a Node version that strips types (22.18 and later).
 *
 * @throws {TfcError} `TFC903` when the module can't be found or throws while loading, with the
 * cause attached.
 * @example
 * ```ts
 * await loadModule('./my-plugin.js', process.cwd(), 'plugin')
 * ```
 */
export async function loadModule(
  id: string,
  base: string,
  resourceHint: 'plugin' | 'config',
): Promise<LoadedModule> {
  let path: string
  let namespace: Record<string, unknown>
  try {
    path = resolveId(id, base, JS)
    namespace = await import(pathToFileURL(path).href)
  } catch (error) {
    const hint =
      /\.[mc]?ts$/.test(id) && !process.features.typescript
        ? ' TypeScript files need Node 22.18 or later.'
        : ''
    throw new TfcError(
      'TFC903',
      `Can't load @${resourceHint} "${id}" from ${base}: ${messageOf(error)}${hint}`,
      { cause: error },
    )
  }
  return { path, base: dirname(path), module: namespace.default ?? namespace }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveId(id: string, base: string, rules: ResolveRules): string {
  if (id.startsWith('.') || isAbsolute(id)) {
    const path = resolveFile(resolve(base, id), rules)
    if (path === null) throw new Error(`no file at ${resolve(base, id)}`)
    return path
  }
  return resolvePackage(id, base, rules)
}

/** The file itself, the file with one of the extensions, or the directory's index. */
function resolveFile(path: string, rules: ResolveRules): string | null {
  for (const candidate of [path, ...rules.extensions.map((extension) => path + extension)]) {
    if (isFile(candidate)) return candidate
  }
  const index = join(path, rules.index)
  return isFile(index) ? index : null
}

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false
}

const PACKAGE_NAME = /^(@[^/]+\/[^/]+|[^/]+)(\/.*)?$/

function resolvePackage(id: string, base: string, rules: ResolveRules): string {
  const [, name = id, rest = ''] = PACKAGE_NAME.exec(id) ?? []
  const subpath = `.${rest}`
  // Node's own lookup list: node_modules of base and every parent directory, then global folders.
  const lookup = createRequire(join(base, 'noop.js')).resolve.paths(name) ?? []
  const folder = lookup
    .map((directory) => join(directory, name))
    .find((directory) => existsSync(join(directory, 'package.json')))
  if (folder === undefined) throw new Error(`package "${name}" is not installed`)
  const root = realpathSync(folder)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >

  if (manifest.exports !== undefined && manifest.exports !== null) {
    const target = resolveExports(manifest.exports, subpath, rules.conditions)
    if (target === null) throw new Error(`"${subpath}" is not exported by "${name}"`)
    const path = resolve(root, target)
    if (!isFile(path))
      throw new Error(`"${name}" exports "${subpath}" as ${target}, a missing file`)
    return path
  }

  const main = manifest[rules.mainField]
  const entry =
    subpath !== '.'
      ? resolveFile(resolve(root, subpath), rules)
      : typeof main === 'string'
        ? resolveFile(resolve(root, main), rules)
        : resolveFile(join(root, rules.index), rules)
  if (entry === null) throw new Error(`no file for "${id}" in ${root}`)
  return entry
}

/** Node's `exports` resolution: exact keys, then the `*` pattern with the longest prefix. */
function resolveExports(
  exports: unknown,
  subpath: string,
  conditions: readonly string[],
): string | null {
  const map =
    typeof exports === 'object' &&
    exports !== null &&
    !Array.isArray(exports) &&
    Object.keys(exports).some((key) => key.startsWith('.'))
      ? (exports as Record<string, unknown>)
      : { '.': exports }

  if (Object.hasOwn(map, subpath)) return resolveTarget(map[subpath], '', conditions)

  let best: { key: string; match: string } | null = null
  for (const key of Object.keys(map)) {
    const star = key.indexOf('*')
    if (star === -1) continue
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    if (
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix) &&
      subpath.length >= key.length - 1 &&
      (best === null || prefix.length > best.key.indexOf('*'))
    ) {
      best = { key, match: subpath.slice(prefix.length, subpath.length - suffix.length) }
    }
  }
  return best === null ? null : resolveTarget(map[best.key], best.match, conditions)
}

function resolveTarget(
  target: unknown,
  match: string,
  conditions: readonly string[],
): string | null {
  if (typeof target === 'string') return target.replaceAll('*', match)
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = resolveTarget(item, match, conditions)
      if (resolved !== null) return resolved
    }
    return null
  }
  if (typeof target === 'object' && target !== null) {
    for (const [condition, value] of Object.entries(target)) {
      if (condition !== 'default' && !conditions.includes(condition)) continue
      const resolved = resolveTarget(value, match, conditions)
      if (resolved !== null) return resolved
    }
  }
  return null
}
