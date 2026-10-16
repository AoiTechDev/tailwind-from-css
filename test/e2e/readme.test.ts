import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..', '..')
const LIBRARY = pathToFileURL(join(ROOT, 'dist', 'index.js')).href
const DOCUMENTS = ['README.md', 'docs/errors.md']

const TAG = '<!-- test -->'
const TAGGED_FENCE = /^<!-- test -->\n(?:\n)?```(js|ts)\n([\s\S]*?)^```$/gm
const OWN_LINE_OUTPUT = /^\s*\/\/ '(.*)'\s*$/
const TRAILING_OUTPUT = /^(\s*)(\S.*?)\s*\/\/ '(.*)'\s*$/
const RESULT_MARKER = '@@readme-checks@@'

interface Example {
  document: string
  /** 1-based line of the first code line in the document. */
  line: number
  lang: 'js' | 'ts'
  code: string
}

interface Check {
  line: number
  expected: string
  actual: unknown
}

const read = (document: string): string => readFileSync(join(ROOT, document), 'utf8')

function examplesOf(document: string): Example[] {
  const text = read(document)
  return [...text.matchAll(TAGGED_FENCE)].map((match) => ({
    document,
    line:
      text.slice(0, match.index).split('\n').length + (match[0].startsWith(`${TAG}\n\n`) ? 3 : 2),
    lang: match[1] as Example['lang'],
    code: match[2] ?? '',
  }))
}

const unquote = (text: string): string => text.replace(/\\(['\\])/g, '$1')

/**
 * Turns `expression // 'output'`, and an `// 'output'` line under an expression, into a call
 * that records the expression's value, and points the package import at `dist/`.
 */
function instrument({ line, code }: Example): { source: string; checks: number } {
  const lines = code.replace(/\n$/, '').split('\n')
  let checks = 0
  const checked = (indent: string, expression: string, expected: string, at: number): string =>
    `${indent}__check(${expression.replace(/;$/, '')}, ${JSON.stringify(unquote(expected))}, ${at})`
  for (const [index, text] of lines.entries()) {
    const ownLine = OWN_LINE_OUTPUT.exec(text)
    const previous = lines[index - 1]
    if (ownLine !== null && previous !== undefined) {
      const [, indent = '', expression = ''] = /^(\s*)(.*)$/.exec(previous) ?? []
      lines[index - 1] = checked(indent, expression, ownLine[1] ?? '', line + index - 1)
      lines[index] = ''
      checks += 1
      continue
    }
    const trailing = TRAILING_OUTPUT.exec(text)
    if (trailing !== null) {
      const [, indent = '', expression = '', expected = ''] = trailing
      lines[index] = checked(indent, expression, expected, line + index)
      checks += 1
    }
  }
  const source = [
    'const __checks = []',
    'const __check = (actual, expected, line) => { __checks.push({ line, expected, actual }) }',
    ...lines.map((text) => text.replace(/(['"])tailwind-from-css\1/g, JSON.stringify(LIBRARY))),
    `console.log(${JSON.stringify(RESULT_MARKER)} + JSON.stringify(__checks))`,
    '',
  ].join('\n')
  return { source, checks }
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

let directory = ''

beforeAll(() => {
  if (!existsSync(join(ROOT, 'dist', 'index.js'))) {
    throw new Error('dist/ is missing. Run `pnpm build` before the e2e tests.')
  }
  directory = mkdtempSync(join(tmpdir(), 'tfc-readme-'))
})

afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
})

describe.each(DOCUMENTS)('examples in %s', (document) => {
  const examples = examplesOf(document)

  it('tags only js and ts blocks, and some of them', () => {
    expect(read(document).split(TAG).length - 1).toBe(examples.length)
    expect(examples.length).toBeGreaterThan(0)
  })

  it.each(examples)('runs the example at $document:$line', (example) => {
    const name = `${example.document.replace(/\W/g, '-')}-${example.line}`
    const file = join(directory, `${name}.${example.lang === 'ts' ? 'mts' : 'mjs'}`)
    const { source, checks: outputComments } = instrument(example)
    writeFileSync(file, source)
    const stripTypes = example.lang === 'ts' && !process.features.typescript
    const run = spawnSync(
      process.execPath,
      [...(stripTypes ? ['--experimental-strip-types'] : []), file],
      { cwd: ROOT, encoding: 'utf8' },
    )
    expect(run.status, run.stderr).toBe(0)
    const report = run.stdout.split('\n').find((text) => text.startsWith(RESULT_MARKER))
    const checks = JSON.parse(report?.slice(RESULT_MARKER.length) ?? '[]') as Check[]
    expect(checks.length, 'output comments reached').toBe(outputComments)
    for (const { line, expected, actual } of checks) {
      const where = `${document}:${line}`
      expect(typeof actual, where).toBe('string')
      // `…` in an output comment stands for text left out; whitespace is then insignificant.
      if (expected.includes('…')) {
        const pattern = collapse(expected).split('…').map(escapeRegExp).join('.*')
        expect(collapse(String(actual)), where).toMatch(new RegExp(`^${pattern}$`))
      } else {
        expect(actual, where).toBe(expected)
      }
    }
  })
})
