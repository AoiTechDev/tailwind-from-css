import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { TfcError } from '../../../src/errors.ts'
import { loadModule, loadStylesheet, loadStylesheetOrOwn } from '../../../src/tailwind/loader.ts'

const ROOT = resolve(import.meta.dirname, '..', '..', '..')
const FIXTURES = resolve(ROOT, 'test', 'fixtures', 'loader')
const TAILWIND = realpathSync(resolve(ROOT, 'node_modules', 'tailwindcss'))

async function rejection(promise: Promise<unknown>): Promise<TfcError> {
  const error = await promise.then(
    () => expect.unreachable('expected a rejection'),
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(TfcError)
  return error as TfcError
}

describe('loadStylesheet', () => {
  it('resolves a relative file against the base and returns its directory as the new base', async () => {
    const sheet = await loadStylesheet('./partials/colors.css', FIXTURES)
    const path = join(FIXTURES, 'partials', 'colors.css')
    expect(sheet).toEqual({ path, base: dirname(path), content: readFileSync(path, 'utf8') })
  })

  it('adds the .css extension when it is missing', async () => {
    const sheet = await loadStylesheet('./partials/spacing', FIXTURES)
    expect(sheet.path).toBe(join(FIXTURES, 'partials', 'spacing.css'))
  })

  it('accepts an absolute path', async () => {
    const path = join(FIXTURES, 'partials', 'colors.css')
    expect((await loadStylesheet(path, ROOT)).path).toBe(path)
  })

  it('resolves tailwindcss through the style export condition', async () => {
    const sheet = await loadStylesheet('tailwindcss', FIXTURES)
    expect(sheet.path).toBe(join(TAILWIND, 'index.css'))
    expect(sheet.base).toBe(TAILWIND)
    expect(sheet.content).toContain('@layer theme')
  })

  it('resolves an exported subpath of a package', async () => {
    expect((await loadStylesheet('tailwindcss/theme.css', FIXTURES)).path).toBe(
      join(TAILWIND, 'theme.css'),
    )
    expect((await loadStylesheet('tailwindcss/theme', FIXTURES)).path).toBe(
      join(TAILWIND, 'theme.css'),
    )
  })

  it('prefers the style condition over import', async () => {
    const sheet = await loadStylesheet('tfc-style-export', FIXTURES)
    expect(sheet.path).toBe(join(FIXTURES, 'node_modules', 'tfc-style-export', 'theme.css'))
    expect(
      (await loadStylesheet('tfc-style-export/extra.css', FIXTURES)).path.endsWith('extra.css'),
    ).toBe(true)
  })

  it('falls back to the style field of a package without exports', async () => {
    const sheet = await loadStylesheet('tfc-style-field', FIXTURES)
    expect(sheet.path).toBe(join(FIXTURES, 'node_modules', 'tfc-style-field', 'dist', 'main.css'))
  })

  it('resolves subpath patterns of a scoped package, longest prefix first', async () => {
    const themes = join(FIXTURES, 'node_modules', '@tfc', 'themes')
    expect((await loadStylesheet('@tfc/themes/ocean', FIXTURES)).path).toBe(
      join(themes, 'ocean.css'),
    )
    expect((await loadStylesheet('@tfc/themes/colors/sand', FIXTURES)).path).toBe(
      join(themes, 'colors', 'sand.css'),
    )
  })

  it('takes the first array target that matches a condition', async () => {
    const sheet = await loadStylesheet('tfc-edge-exports', FIXTURES)
    expect(sheet.path).toBe(join(FIXTURES, 'node_modules', 'tfc-edge-exports', 'main.css'))
  })

  it('falls back to index.css and plain subpaths in a package without exports or style', async () => {
    const plain = join(FIXTURES, 'node_modules', 'tfc-plain')
    expect((await loadStylesheet('tfc-plain', FIXTURES)).path).toBe(join(plain, 'index.css'))
    expect((await loadStylesheet('tfc-plain/sub/file', FIXTURES)).path).toBe(
      join(plain, 'sub', 'file.css'),
    )
  })

  it('finds packages in node_modules of parent directories', async () => {
    const sheet = await loadStylesheet('tfc-style-export', join(FIXTURES, 'partials'))
    expect(sheet.path).toBe(join(FIXTURES, 'node_modules', 'tfc-style-export', 'theme.css'))
  })

  it('throws TFC903 with a cause for a missing relative file', async () => {
    const error = await rejection(loadStylesheet('./partials/does-not-exist.css', FIXTURES))
    expect(error.code).toBe('TFC903')
    expect(error.cause).toBeInstanceOf(Error)
  })

  it('throws TFC903 for a missing package', async () => {
    expect((await rejection(loadStylesheet('tfc-not-installed', FIXTURES))).code).toBe('TFC903')
  })

  it.each([
    'tfc-style-export/secret.css',
    'tfc-edge-exports/private/key.css',
    'tfc-edge-exports/missing.css',
    'tfc-plain/sub/none',
  ])('throws TFC903 for %s: not exported, excluded, missing file', async (id) => {
    expect((await rejection(loadStylesheet(id, FIXTURES))).code).toBe('TFC903')
  })
})

// SPEC §3.4: the default base (cwd) of a bundled function may have no tailwindcss.
describe('loadStylesheetOrOwn', () => {
  const empty = mkdtempSync(join(tmpdir(), 'tfc-no-tailwind-'))
  afterAll(() => rmSync(empty, { recursive: true, force: true }))

  it('falls back to the tailwindcss this package imports', async () => {
    expect((await rejection(loadStylesheet('tailwindcss', empty))).code).toBe('TFC903')
    expect((await loadStylesheetOrOwn('tailwindcss', empty)).path).toBe(join(TAILWIND, 'index.css'))
    expect((await loadStylesheetOrOwn('tailwindcss/theme.css', empty)).path).toBe(
      join(TAILWIND, 'theme.css'),
    )
  })

  it('loads from the base when it can, and never falls back for other imports', async () => {
    expect(await loadStylesheetOrOwn('./partials/colors.css', FIXTURES)).toEqual(
      await loadStylesheet('./partials/colors.css', FIXTURES),
    )
    expect((await rejection(loadStylesheetOrOwn('./missing.css', empty))).code).toBe('TFC903')
    expect((await rejection(loadStylesheetOrOwn('tailwindcss-x', empty))).code).toBe('TFC903')
  })
})

describe('loadModule', () => {
  it('imports an ESM plugin and returns its default export', async () => {
    const loaded = await loadModule('./plugin.mjs', FIXTURES, 'plugin')
    expect(loaded.path).toBe(join(FIXTURES, 'plugin.mjs'))
    expect(loaded.base).toBe(FIXTURES)
    expect(loaded.module).toBeTypeOf('function')
  })

  it('imports a CommonJS plugin through Node interop', async () => {
    const loaded = await loadModule('./plugin.cjs', FIXTURES, 'plugin')
    expect(loaded.module).toBeTypeOf('function')
  })

  it('imports an ESM-only package through its import condition', async () => {
    const loaded = await loadModule('tfc-esm-plugin', FIXTURES, 'plugin')
    expect(loaded.path).toBe(join(FIXTURES, 'node_modules', 'tfc-esm-plugin', 'index.js'))
    expect(loaded.module).toBeTypeOf('function')
  })

  it('imports a JavaScript config', async () => {
    const loaded = await loadModule('./config.mjs', FIXTURES, 'config')
    expect(loaded.module).toEqual({ theme: { extend: { colors: { legacy: '#abcdef' } } } })
  })

  // Vitest transforms TypeScript itself, so this passes on any Node. Plain Node needs 22.18 or
  // later, which strips types; older versions get TFC903 with a hint.
  it('imports a TypeScript config', async () => {
    const loaded = await loadModule('./config.ts', FIXTURES, 'config')
    expect(loaded.module).toEqual({ theme: { extend: { colors: { typed: '#fedcba' } } } })
  })

  it('throws TFC903 for a missing module', async () => {
    const error = await rejection(loadModule('./nope.mjs', FIXTURES, 'plugin'))
    expect(error.code).toBe('TFC903')
    expect(error.cause).toBeInstanceOf(Error)
  })

  it('throws TFC903 with the original error when the module throws on import', async () => {
    const error = await rejection(loadModule('./broken-plugin.mjs', FIXTURES, 'plugin'))
    expect(error.code).toBe('TFC903')
    expect((error.cause as Error).message).toBe('broken plugin')
  })
})
