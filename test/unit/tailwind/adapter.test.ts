import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TfcError } from '../../../src/errors.ts'
import type { TailwindDesignSystem } from '../../../src/tailwind/adapter.ts'
import { printRules } from '../../helpers/print.ts'

// A stand-in for Tailwind, so the error paths and AST shapes of other versions can be exercised.
// The contract suite covers the real thing.

const options = {
  base: '/project',
  loadStylesheet: () => Promise.reject(new Error('unused')),
  loadModule: () => Promise.reject(new Error('unused')),
}

function fakeDesignSystem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    theme: { prefix: null },
    utilities: { keys: () => ['p', 'mt', '-mt', 'p'] },
    getClassList: () => [['flex', { modifiers: [] }]],
    getVariants: () => [],
    candidatesToAst: (candidates: string[]) => candidates.map(() => []),
    getClassOrder: (candidates: string[]) => candidates.map((name) => [name, 0n]),
    resolveThemeValue: () => undefined,
    ...overrides,
  }
}

// Mocks only apply to modules imported after a reset, so the adapter and the TfcError class it
// throws are imported fresh, together.
async function freshAdapter(
  manifest: () => Record<string, unknown>,
  tailwind: Record<string, unknown> = {},
) {
  vi.resetModules()
  vi.doMock('tailwindcss/package.json', manifest)
  vi.doMock('tailwindcss', () => tailwind)
  const { loadDesignSystem } = await import('../../../src/tailwind/adapter.ts')
  const { TfcError } = await import('../../../src/errors.ts')
  return { loadDesignSystem, TfcError }
}

let FreshTfcError: typeof TfcError

async function load(
  version: string,
  tailwind: Record<string, unknown> = {
    __unstable__loadDesignSystem: async () => fakeDesignSystem(),
  },
): Promise<TailwindDesignSystem> {
  const fresh = await freshAdapter(() => ({ default: { version } }), tailwind)
  FreshTfcError = fresh.TfcError
  return fresh.loadDesignSystem('@import "tailwindcss";', options)
}

async function failure(loading: Promise<unknown>): Promise<TfcError> {
  const error = await loading.then(
    () => expect.unreachable('expected a rejection'),
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(FreshTfcError)
  return error as TfcError
}

afterEach(() => {
  vi.doUnmock('tailwindcss/package.json')
  vi.doUnmock('tailwindcss')
})

describe('capability checks', () => {
  it('throws TFC901 with the cause when tailwindcss cannot be imported', async () => {
    const fresh = await freshAdapter(() => {
      throw new Error("Cannot find package 'tailwindcss'")
    })
    FreshTfcError = fresh.TfcError
    const error = await failure(fresh.loadDesignSystem('', options))
    expect(error.code).toBe('TFC901')
    expect(error.cause).toBeInstanceOf(Error)
  })

  it.each(['4.2.0', '4.3.3', '4.10.0', '4.4.0-beta.1', '0.0.0-insiders.de2255b'])(
    'accepts %s',
    async (version) => {
      expect((await load(version)).version).toBe(version)
    },
  )

  it.each(['4.1.18', '4.0.0', '5.0.0', '3.4.19', '0.0.0-dev'])(
    'rejects %s with TFC902',
    async (version) => {
      const error = await failure(load(version))
      expect(error.code).toBe('TFC902')
      expect(error.message).toContain(version)
    },
  )

  it('throws TFC902 when the loader export is missing', async () => {
    const error = await failure(load('4.3.3', { __unstable__loadDesignSystem: undefined }))
    expect(error.code).toBe('TFC902')
    expect(error.message).toContain('__unstable__loadDesignSystem')
  })

  it.each(['getClassList', 'getVariants', 'candidatesToAst', 'getClassOrder', 'resolveThemeValue'])(
    'throws TFC902 naming %s when the design system lacks it',
    async (method) => {
      const tailwind = {
        __unstable__loadDesignSystem: async () => fakeDesignSystem({ [method]: undefined }),
      }
      const error = await failure(load('4.9.0', tailwind))
      expect(error.code).toBe('TFC902')
      expect(error.message).toContain(method)
      expect(error.message).toContain('4.9.0')
    },
  )

  it('throws TFC902 when utilities.keys or theme is missing', async () => {
    for (const overrides of [{ utilities: {} }, { theme: undefined }]) {
      const tailwind = {
        __unstable__loadDesignSystem: async () => fakeDesignSystem(overrides),
      }
      expect((await failure(load('4.3.3', tailwind))).code).toBe('TFC902')
    }
  })

  it('wraps a load failure in TFC903 with the cause', async () => {
    const cause = new Error('Cannot apply unknown utility class')
    const error = await failure(
      load('4.3.3', { __unstable__loadDesignSystem: () => Promise.reject(cause) }),
    )
    expect(error.code).toBe('TFC903')
    expect(error.cause).toBe(cause)
  })

  it('passes a TfcError from the loader through unchanged', async () => {
    let thrown: unknown
    const error = await failure(
      load('4.3.3', {
        __unstable__loadDesignSystem: () => {
          thrown = new FreshTfcError('TFC903', "Can't load @import")
          return Promise.reject(thrown)
        },
      }),
    )
    expect(error).toBe(thrown)
  })
})

describe('design system wrapper', () => {
  it('sorts and dedupes functional roots, aligns class order with the input', async () => {
    const design = await load('4.3.3')
    expect(design.functionalRoots()).toEqual(['-mt', 'mt', 'p'])
    expect(design.classOrder(['a', 'b'])).toEqual([0n, 0n])
    expect(design.prefix).toBeNull()
    expect(design.classList()).toEqual([{ name: 'flex', modifiers: [] }])
  })
})

/** Compiles one fake candidate whose Tailwind AST is `nodes`. */
async function flattened(nodes: unknown[]): Promise<ReturnType<TailwindDesignSystem['toAst']>[0]> {
  const design = await load('4.2.0', {
    __unstable__loadDesignSystem: async () => fakeDesignSystem({ candidatesToAst: () => [nodes] }),
  })
  return design.toAst(['x'])[0] ?? null
}

const decl = (property: string, value: string | undefined, important = false) => ({
  kind: 'declaration',
  property,
  value,
  important,
})
const rule = (selector: string, nodes: unknown[]) => ({ kind: 'rule', selector, nodes })
const atRule = (name: string, params: string, nodes: unknown[]) => ({
  kind: 'at-rule',
  name,
  params,
  nodes,
})

describe('AST flattening', () => {
  it('returns null for a candidate that compiles to nothing', async () => {
    expect(await flattened([])).toBeNull()
  })

  it('resolves 4.2-style nesting into selector and conditions', async () => {
    const ast = await flattened([
      rule('.md\\:hover\\:flex', [
        atRule('@media', '(width >= 48rem)', [
          rule('&:hover', [atRule('@media', '(hover: hover)', [decl('display', 'flex')])]),
        ]),
      ]),
    ])
    expect(ast && printRules(ast)).toBe(
      '@media (width >= 48rem) { @media (hover: hover) { .md\\:hover\\:flex:hover { display: flex; } } }',
    )
  })

  it('keeps source order when declarations follow a nested rule', async () => {
    const ast = await flattened([
      rule('.a', [
        decl('color', 'red'),
        rule('&:hover', [decl('color', 'blue')]),
        decl('top', '0'),
      ]),
    ])
    expect(ast && printRules(ast)).toBe(
      '.a { color: red; } .a:hover { color: blue; } .a { top: 0; }',
    )
  })

  it('resolves every & of a selector list, and a selector without & as a descendant', async () => {
    const ast = await flattened([
      rule('.a', [
        rule('&:hover, &:focus', [decl('color', 'red')]),
        rule('p, & > span', [decl('top', '0')]),
      ]),
    ])
    expect(ast?.rules.map((r) => r.selector)).toEqual(['.a:hover, .a:focus', '.a p, .a > span'])
  })

  it('wraps a parent selector list in :is()', async () => {
    const ast = await flattened([rule('.a, .b', [rule('&:hover', [decl('color', 'red')])])])
    expect(ast?.rules[0]?.selector).toBe(':is(.a, .b):hover')
  })

  it('leaves escaped & and & inside strings alone', async () => {
    const ast = await flattened([
      rule('.\\[\\&_p\\]\\:flex', [rule('& p[data-x="a&b"]', [decl('display', 'flex')])]),
    ])
    expect(ast?.rules[0]?.selector).toBe('.\\[\\&_p\\]\\:flex p[data-x="a&b"]')
  })

  it('does not split at commas inside :is() or attribute selectors', async () => {
    const ast = await flattened([rule('.a', [rule(':is(&, .b)[data-x=","]', [decl('top', '0')])])])
    expect(ast?.rules[0]?.selector).toBe(':is(.a, .b)[data-x=","]')
  })

  it('keeps an at-rule without params as its name and important flags', async () => {
    const ast = await flattened([
      rule('.a', [atRule('@starting-style', '', [decl('opacity', '0', true)])]),
    ])
    expect(ast && printRules(ast)).toBe('@starting-style { .a { opacity: 0 !important; } }')
  })

  it('collects @property registrations', async () => {
    const ast = await flattened([
      rule('.a', [decl('border-style', 'var(--tw-border-style)')]),
      atRule('@property', '--tw-border-style', [
        decl('syntax', '"*"'),
        decl('inherits', 'true'),
        decl('initial-value', 'solid'),
      ]),
      atRule('@property', '--tw-leading', [decl('syntax', '"*"')]),
    ])
    expect(ast?.properties).toEqual([
      { name: '--tw-border-style', syntax: '"*"', inherits: true, initialValue: 'solid' },
      { name: '--tw-leading', syntax: '"*"', inherits: undefined, initialValue: undefined },
    ])
  })

  it('drops comments, declarations without a value or outside a rule; unwraps context and at-root', async () => {
    const ast = await flattened([
      { kind: 'comment', value: 'x' },
      decl('color', 'red'),
      {
        kind: 'context',
        context: {},
        nodes: [
          rule('.a', [
            decl('--tw-sort', undefined),
            decl('color', 'red'),
            { kind: 'at-root', nodes: [rule('.b', [decl('top', '0')])] },
          ]),
        ],
      },
    ])
    expect(ast && printRules(ast)).toBe('.a { color: red; } .b { top: 0; }')
  })
})
