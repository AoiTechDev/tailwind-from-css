import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../helpers/design-system.ts'
import { type ExportDocs, exportDocs } from '../helpers/public-docs.ts'

// The built declaration file carries the same comments (checked by test/e2e/pack.test.ts).
const EXPORTS = exportDocs(resolve(REPO_ROOT, 'src', 'index.ts'))
const named = (kind: ExportDocs['kind']): string[] =>
  EXPORTS.filter((entry) => entry.kind === kind).map((entry) => entry.name)

describe('public TSDoc', () => {
  it('finds the root exports', () => {
    expect(named('function')).toEqual([
      'convertCss',
      'convertStyles',
      'createConverter',
      'pruneStyles',
    ])
    expect(named('class')).toEqual(['TfcError'])
    expect(named('type')).toEqual(expect.arrayContaining(['ConversionResult', 'TfcErrorCode']))
  })

  it('documents every export', () => {
    expect(EXPORTS.filter((entry) => entry.documentation.trim() === '').map((e) => e.name)).toEqual(
      [],
    )
  })

  it('gives every function @throws and @example', () => {
    const missing = EXPORTS.filter((entry) => entry.kind === 'function').flatMap((entry) =>
      ['throws', 'example']
        .filter((tag) => !entry.tags.includes(tag))
        .map((tag) => `${entry.name} @${tag}`),
    )
    expect(missing).toEqual([])
  })

  it('gives every class an @example', () => {
    expect(
      EXPORTS.filter((entry) => entry.kind === 'class' && !entry.tags.includes('example')).map(
        (entry) => entry.name,
      ),
    ).toEqual([])
  })
})
