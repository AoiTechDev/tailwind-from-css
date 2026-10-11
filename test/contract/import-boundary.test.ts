import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { posix, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..', '..')

const COMMENT = /\/\*[\s\S]*?\*\/|(^|[^:\\])\/\/.*$/gm
// `(?<!@)` skips a CSS `@import` inside a string (the default entry CSS).
const SPECIFIER =
  /(?<!@)\b(?:import|export)\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]|\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function importsOf(source: string): string[] {
  const code = source.replace(COMMENT, '$1')
  return [...code.matchAll(SPECIFIER)].map((match) => match[1] ?? match[2] ?? '')
}

const isTailwind = (specifier: string): boolean =>
  specifier === 'tailwindcss' ||
  specifier.startsWith('tailwindcss/') ||
  specifier.startsWith('@tailwindcss/')

const isNodeBuiltin = (specifier: string): boolean =>
  specifier.startsWith('node:') || builtinModules.includes(specifier.split('/')[0] ?? '')

/** `path` is repo-relative with forward slashes, e.g. `src/css/parse.ts`. */
function violations(path: string, imports: string[]): string[] {
  const found: string[] = []
  for (const specifier of imports) {
    if (isTailwind(specifier) && path !== 'src/tailwind/adapter.ts') {
      found.push(`${path} imports ${specifier}: only src/tailwind/adapter.ts may import Tailwind`)
    }
    if (isNodeBuiltin(specifier) && path !== 'src/tailwind/loader.ts' && path !== 'src/cli.ts') {
      found.push(`${path} imports ${specifier}: only the loader and the CLI may import Node`)
    }
    if (path.startsWith('src/css/') && specifier.startsWith('.')) {
      const target = posix.join(posix.dirname(path), specifier)
      if (target.startsWith('src/match/') || target.startsWith('src/tailwind/')) {
        found.push(`${path} imports ${specifier}: src/css must not depend on ${target}`)
      }
    }
  }
  return found
}

const sourceFiles = readdirSync(resolve(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.ts'))
  .map((file) => `src/${file.replaceAll('\\', '/')}`)
  .sort()

describe('import extraction', () => {
  it('finds static, type-only, re-export, dynamic and require specifiers', () => {
    const source = [
      "import a from 'a'",
      "import type { B } from 'b'",
      "import {\n  c,\n  d as e,\n} from 'c'",
      "import 'd'",
      "export * from 'e'",
      "export type * from 'f'",
      "export { g } from 'g'",
      "const h = await import('h')",
      "const i = require('i')",
      "// import nope from 'commented'",
      "/* import nope from 'block-commented' */",
      "const url = 'https://example.com'",
      `const css = '@import "tailwindcss";'`,
    ].join('\n')
    expect(importsOf(source)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])
  })
})

describe('boundary rules', () => {
  it('allows Tailwind only in the adapter', () => {
    expect(violations('src/tailwind/adapter.ts', ['tailwindcss'])).toEqual([])
    expect(violations('src/match/exact.ts', ['tailwindcss'])).toHaveLength(1)
    expect(violations('src/converter.ts', ['tailwindcss/package.json'])).toHaveLength(1)
    expect(violations('src/tailwind/loader.ts', ['@tailwindcss/node'])).toHaveLength(1)
  })

  it('allows Node built-ins only in the loader and the CLI', () => {
    expect(violations('src/tailwind/loader.ts', ['node:fs', 'node:module'])).toEqual([])
    expect(violations('src/cli.ts', ['node:util', 'node:process'])).toEqual([])
    expect(violations('src/tailwind/adapter.ts', ['node:path'])).toHaveLength(1)
    expect(violations('src/css/parse.ts', ['fs'])).toHaveLength(1)
    expect(violations('src/report.ts', ['node:crypto'])).toHaveLength(1)
  })

  it('keeps src/css independent of src/match and src/tailwind', () => {
    expect(violations('src/css/parse.ts', ['./selector.ts', '../types.ts'])).toEqual([])
    expect(violations('src/css/parse.ts', ['../match/exact.ts'])).toHaveLength(1)
    expect(violations('src/css/normalize/colors.ts', ['../../tailwind/adapter.ts'])).toHaveLength(1)
    expect(violations('src/match/exact.ts', ['../tailwind/effective.ts'])).toEqual([])
  })
})

describe('source tree', () => {
  it('contains the public entry point', () => {
    expect(sourceFiles).toContain('src/index.ts')
  })

  it('respects every import boundary', () => {
    const found = sourceFiles.flatMap((path) =>
      violations(path, importsOf(readFileSync(resolve(ROOT, path), 'utf8'))),
    )
    expect(found).toEqual([])
  })
})
