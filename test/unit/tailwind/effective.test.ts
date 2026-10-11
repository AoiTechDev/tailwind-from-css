import { describe, expect, it } from 'vitest'
import type { NormalDeclaration } from '../../../src/css/normalize/index.ts'
import {
  BASE_CONTEXT,
  type Context,
  compileCandidates,
  contextKey,
  effectiveDeclarations,
  normalizeContext,
} from '../../../src/tailwind/effective.ts'
import { ast, type FakeDesignInput, fakeDesign, property, rule } from '../../helpers/fake-design.ts'

const OPTIONS = { rootFontSize: 16 } as const

const print = (declarations: readonly NormalDeclaration[]): string[] =>
  declarations.map(
    (declaration) =>
      `${declaration.property}: ${declaration.value}${declaration.important ? ' !important' : ''}`,
  )

function effective(
  input: FakeDesignInput,
  candidates: readonly string[],
  context: Context = BASE_CONTEXT,
  rootFontSize: number | false = 16,
): string[] {
  return print(effectiveDeclarations(fakeDesign(input), candidates, context, { rootFontSize }))
}

const HOVER: Context = { selector: '&:hover', conditions: ['@media (hover: hover)'] }

describe('contexts', () => {
  it('normalizes the selector and the conditions', () => {
    expect(
      normalizeContext(
        { selector: '&:HOVER', conditions: ['@media (hover:hover)', '@media (min-width: 48rem)'] },
        OPTIONS,
      ),
    ).toEqual({
      selector: '&:hover',
      conditions: ['@media (hover: hover) and (width >= 768px)'],
    })
    expect(normalizeContext(BASE_CONTEXT, OPTIONS)).toEqual(BASE_CONTEXT)
  })

  it('gives equal contexts equal keys and different contexts different keys', () => {
    const key = (context: Context) => contextKey(normalizeContext(context, OPTIONS))
    expect(key({ selector: '&:hover', conditions: ['@media (hover: hover)'] })).toBe(
      key({ selector: '&:hover', conditions: ['@media (hover:hover)'] }),
    )
    expect(key(HOVER)).not.toBe(key({ selector: '&:hover', conditions: [] }))
    expect(key({ selector: '&', conditions: ['@media print'] })).not.toBe(
      key({ selector: '&', conditions: ['@media screen'] }),
    )
  })
})

describe('compileCandidates', () => {
  const design = fakeDesign({
    candidates: {
      'p-4': ast([rule('.p-4', ['padding: 1rem'])]),
      'hover:flex': ast([rule('.hover\\:flex:hover', ['display: flex'], ['@media (hover:hover)'])]),
      'w-1/2': ast([rule('.w-1\\/2', ['width: 50%'])]),
      'space-x-2': ast([rule(':where(.space-x-2 > :not(:last-child))', ['margin-left: 1px'])]),
      odd: ast([rule('.other', ['color: red'])]),
    },
  })

  it('records each rule with its normalized context and specificity', () => {
    const [p4, hover, half, space, odd, missing] = compileCandidates(
      design,
      ['p-4', 'hover:flex', 'w-1/2', 'space-x-2', 'odd', 'missing'],
      OPTIONS,
    )
    expect(p4?.rules.map((compiled) => compiled.context)).toEqual([BASE_CONTEXT])
    expect(p4?.rules[0]?.specificity).toEqual([0, 1, 0])
    expect(p4?.order).toBe(0n)
    expect(hover?.rules[0]?.context).toEqual(HOVER)
    expect(hover?.rules[0]?.specificity).toEqual([0, 2, 0])
    expect(half?.rules[0]?.context).toEqual(BASE_CONTEXT)
    expect(space?.rules[0]?.context).toEqual({
      selector: ':where(& > :not(:last-child))',
      conditions: [],
    })
    expect(space?.rules[0]?.specificity).toEqual([0, 0, 0])
    expect(odd?.rules[0]?.context).toBeUndefined()
    expect(missing).toBeNull()
  })
})

describe('rule selection (SPEC §5.6 step 1)', () => {
  const input: FakeDesignInput = {
    candidates: {
      'hover:flex': ast([
        rule('.hover\\:flex:hover', ['display: flex'], ['@media (hover: hover)']),
      ]),
      container: ast([
        rule('.container', ['width: 100%']),
        rule('.container', ['max-width: 40rem'], ['@media (width >= 40rem)']),
      ]),
      stray: ast([rule('.elsewhere', ['color: red']), rule('.stray', ['color: blue'])]),
    },
  }

  it('keeps only rules whose selector and conditions normalize to the context', () => {
    expect(effective(input, ['hover:flex'], HOVER)).toEqual(['display: flex'])
    expect(
      effective(input, ['hover:flex'], {
        selector: '&:HOVER',
        conditions: ['@media (hover:hover)'],
      }),
    ).toEqual(['display: flex'])
    expect(effective(input, ['hover:flex'])).toEqual([])
    expect(effective(input, ['hover:flex'], { selector: '&:hover', conditions: [] })).toEqual([])
  })

  it('splits a candidate with several contexts', () => {
    expect(effective(input, ['container'])).toEqual(['width: 100%'])
    expect(
      effective(input, ['container'], { selector: '&', conditions: ['@media (min-width: 640px)'] }),
    ).toEqual(['max-width: 640px'])
  })

  it("ignores rules that don't select the candidate's class, and unknown candidates", () => {
    expect(effective(input, ['stray', 'unknown'])).toEqual(['color: srgb(0 0 255 / 1)'])
  })
})

describe('cascade order (SPEC §5.6 step 2)', () => {
  const input: FakeDesignInput = {
    candidates: {
      'text-lime!': ast([rule('.text-lime\\!', ['color: lime!'])]),
      'text-red': ast([rule('.text-red', ['color: red'])]),
      'text-blue': ast([rule('.text-blue', ['color: blue'])]),
      twice: ast([rule('.twice', ['color: red', 'color: blue'])]),
      'm-0': ast([rule('.m-0', ['margin: 0'])]),
      'mt-1': ast([rule('.mt-1', ['margin-top: 4px'])]),
    },
  }

  it('lets the later class order win at equal specificity, whatever the input order', () => {
    expect(effective(input, ['text-blue', 'text-red'])).toEqual(['color: srgb(0 0 255 / 1)'])
    expect(effective(input, ['text-red', 'text-blue'])).toEqual(['color: srgb(0 0 255 / 1)'])
  })

  it('lets !important win over a later class', () => {
    expect(effective(input, ['text-lime!', 'text-blue'])).toEqual([
      'color: srgb(0 255 0 / 1) !important',
    ])
  })

  it('lets the later declaration of a rule win', () => {
    expect(effective(input, ['twice'])).toEqual(['color: srgb(0 0 255 / 1)'])
  })

  it('cascades longhands, so a shorthand and a later longhand combine', () => {
    expect(effective(input, ['mt-1', 'm-0'])).toEqual([
      'margin-bottom: 0',
      'margin-left: 0',
      'margin-right: 0',
      'margin-top: 4px',
    ])
  })
})

describe('theme variables (SPEC §5.6 step 3)', () => {
  const input: FakeDesignInput = {
    theme: {
      '--spacing': '0.25rem',
      '--color-ink': '#123456',
      '--color-alias': 'var(--color-ink)',
      '--font-sans': 'Inter, sans-serif',
      '--default-font-family': '--theme(--font-sans, initial)',
      '--text-sm': '0.875rem',
      '--text-sm--line-height': 'calc(1.25 / 0.875)',
    },
    candidates: {
      'p-4': ast([rule('.p-4', ['padding: calc(var(--spacing) * 4)'])]),
      'text-alias': ast([rule('.text-alias', ['color: var(--color-alias)'])]),
      'font-default': ast([rule('.font-default', ['font-family: var(--default-font-family)'])]),
      'text-sm': ast([
        rule('.text-sm', [
          'font-size: var(--text-sm)',
          'line-height: var(--tw-leading, var(--text-sm--line-height))',
        ]),
      ]),
      'text-fallback': ast([rule('.text-fallback', ['color: var(--color-ink, red)'])]),
    },
  }

  it('substitutes theme values and folds the result', () => {
    expect(effective(input, ['p-4'])).toEqual([
      'padding-bottom: 16px',
      'padding-left: 16px',
      'padding-right: 16px',
      'padding-top: 16px',
    ])
  })

  it('resolves theme values that refer to other theme variables', () => {
    expect(effective(input, ['text-alias'])).toEqual(['color: srgb(18 52 86 / 1)'])
    expect(effective(input, ['font-default'])).toEqual(['font-family: Inter,sans-serif'])
  })

  it('uses the theme value, not the fallback, of a defined theme variable', () => {
    expect(effective(input, ['text-fallback'])).toEqual(['color: srgb(18 52 86 / 1)'])
  })

  it("falls back from an unset --tw-* variable to the theme (text-sm's line-height)", () => {
    expect(effective(input, ['text-sm'])).toEqual(['font-size: 14px', 'line-height: 1.4286'])
  })

  it('keeps rem apart from px when rootFontSize is false', () => {
    expect(effective(input, ['p-4'], BASE_CONTEXT, false)).toContain('padding-top: 1rem')
  })
})

describe('--tw-* variables (SPEC §5.6 steps 3 and 4)', () => {
  const layers = 'var(--tw-inset-shadow), var(--tw-ring-shadow), var(--tw-shadow)'
  const input: FakeDesignInput = {
    theme: { '--spacing': '0.25rem', '--color-red-500': 'oklch(63.7% 0.237 25.331)' },
    candidates: {
      'shadow-xs': ast(
        [
          rule('.shadow-xs', [
            '--tw-shadow: 0 1px 2px 0 var(--tw-shadow-color, rgb(0 0 0 / 0.05))',
            `box-shadow: ${layers}`,
          ]),
        ],
        [
          property('--tw-shadow', '0 0 #0000'),
          property('--tw-shadow-color'),
          property('--tw-inset-shadow', '0 0 #0000'),
          property('--tw-ring-shadow', '0 0 #0000'),
        ],
      ),
      'shadow-red-500': ast([rule('.shadow-red-500', ['--tw-shadow-color: var(--color-red-500)'])]),
      border: ast(
        [rule('.border', ['border-style: var(--tw-border-style)', 'border-width: 1px'])],
        [property('--tw-border-style', 'solid')],
      ),
      'border-dashed': ast([
        rule('.border-dashed', ['--tw-border-style: dashed', 'border-style: dashed']),
      ]),
      'leading-6': ast(
        [rule('.leading-6', ['--tw-leading: calc(var(--spacing) * 6)'])],
        [property('--tw-leading')],
      ),
      'text-sm': ast([rule('.text-sm', ['line-height: var(--tw-leading, calc(1.25 / 0.875))'])]),
      filter: ast([rule('.filter', ['filter: var(--tw-blur,) var(--tw-sepia,)'])]),
      'blur-sm': ast([rule('.blur-sm', ['--tw-blur: blur(8px)'])]),
      missing: ast([rule('.missing', ['color: var(--tw-missing)'])]),
      cycle: ast([
        rule('.cycle', ['--tw-a: var(--tw-b)', '--tw-b: var(--tw-a)', 'color: var(--tw-a)']),
      ]),
      'cycle-fallback': ast([
        rule('.cycle-fallback', [
          '--tw-a: var(--tw-b)',
          '--tw-b: var(--tw-a)',
          '--tw-c: var(--tw-missing)',
          'color: var(--tw-a, red)',
          'background-color: var(--tw-c, blue)',
        ]),
      ]),
      'before:flex': ast(
        [rule('.before\\:flex::before', ['content: var(--tw-content)', 'display: flex'])],
        [property('--tw-content', '""')],
      ),
      quoted: ast([rule('.quoted', ['content: "var(--tw-content)"'])]),
      'odd-references': ast([
        rule('.odd-references', [
          'color: var(oops)',
          'content: var(--tw-unset, "a\\)b" ")")',
          'width: var(--tw-unclosed',
        ]),
      ]),
      'ring-inset': ast([rule('.ring-inset', ['--tw-ring-inset: inset'])]),
      ring: ast([
        rule('.ring', ['box-shadow: var(--tw-ring-inset,) 0 0 0 1px var(--tw-ring-color, red)']),
      ]),
    },
  }

  it('drops the no-op layers of shadow-xs (its visible layer is all that is left)', () => {
    expect(effective(input, ['shadow-xs'])).toEqual(['box-shadow: 0 1px 2px 0 srgb(0 0 0 / 0.05)'])
  })

  it('uses a --tw-* value set by another class of the same set', () => {
    expect(effective(input, ['shadow-xs', 'shadow-red-500'])).toEqual([
      'box-shadow: 0 1px 2px 0 oklch(0.637 0.237 25.331 / 1)',
    ])
    expect(effective(input, ['text-sm', 'leading-6'])).toEqual(['line-height: 24px'])
    expect(effective(input, ['filter', 'blur-sm'])).toEqual(['filter: blur(8px)'])
    expect(effective(input, ['ring', 'ring-inset'])).toEqual([
      'box-shadow: inset 0 0 0 1px srgb(255 0 0 / 1)',
    ])
  })

  it('uses the @property initial value of an unset variable (border → solid)', () => {
    expect(effective(input, ['border'])).toEqual([
      'border-bottom-style: solid',
      'border-bottom-width: 1px',
      'border-left-style: solid',
      'border-left-width: 1px',
      'border-right-style: solid',
      'border-right-width: 1px',
      'border-top-style: solid',
      'border-top-width: 1px',
    ])
    expect(effective(input, ['border', 'border-dashed'])).toContain('border-top-style: dashed')
  })

  it('uses the fallback when the variable is registered without an initial value', () => {
    expect(effective(input, ['text-sm'])).toEqual(['line-height: 1.4286'])
  })

  it('drops guaranteed-invalid declarations: no value, no fallback, or a cycle', () => {
    expect(effective(input, ['missing'])).toEqual([])
    expect(effective(input, ['filter'])).toEqual([])
    expect(effective(input, ['cycle'])).toEqual([])
  })

  it('uses the fallback of a variable whose own value is guaranteed-invalid', () => {
    expect(effective(input, ['cycle-fallback'])).toEqual([
      'background-color: srgb(0 0 255 / 1)',
      'color: srgb(255 0 0 / 1)',
    ])
  })

  it('drops the --tw-* declarations themselves', () => {
    expect(effective(input, ['shadow-red-500', 'blur-sm', 'leading-6'])).toEqual([])
  })

  it("resolves before:'s content to its @property initial value", () => {
    expect(effective(input, ['before:flex'], { selector: '&::before', conditions: [] })).toEqual([
      'content: ""',
      'display: flex',
    ])
  })

  it('keeps references it cannot read and reads fallbacks with escapes and strings', () => {
    expect(effective(input, ['odd-references'])).toEqual([
      'color: var(oops)',
      'content: "a)b" ")"',
      'width: var(--tw-unclosed',
    ])
  })

  it('leaves var() inside strings alone', () => {
    expect(effective(input, ['quoted'])).toEqual(['content: "var(--tw-content)"'])
  })
})

describe('other variables (SPEC §5.6 step 3)', () => {
  const input: FakeDesignInput = {
    candidates: {
      'p-(--gap)': ast([rule('.p-\\(--gap\\)', ['padding: var(--gap)'])]),
      '[--gap:2px]': ast([rule('.\\[--gap\\:2px\\]', ['--gap: 2px'])]),
      'text-(--ink)': ast([rule('.text-\\(--ink\\)', ['color: var(--ink, var(--tw-x, red))'])]),
    },
  }

  it('keeps user variables as written and keeps their own declarations', () => {
    expect(effective(input, ['p-(--gap)', '[--gap:2px]'])).toEqual([
      '--gap: 2px',
      'padding: var(--gap)',
    ])
    expect(effective(input, ['text-(--ink)'])).toEqual([
      'color: var(--ink,var(--tw-x,srgb(255 0 0 / 1)))',
    ])
  })
})

describe('prefix(tw) (SPEC §5.6, RESEARCH §3.4)', () => {
  const input: FakeDesignInput = {
    prefix: 'tw',
    theme: {
      '--color-brand': '#123456',
      '--text-sm': '0.875rem',
      '--text-sm--line-height': 'calc(1.25 / 0.875)',
    },
    candidates: {
      'tw:text-brand': ast([rule('.tw\\:text-brand', ['color: var(--tw-color-brand)'])]),
      'tw:text-sm': ast([
        rule('.tw\\:text-sm', [
          'font-size: var(--tw-text-sm)',
          'line-height: var(--tw-leading, var(--tw-text-sm--line-height))',
        ]),
      ]),
      'tw:plain': ast([rule('.tw\\:plain', ['color: var(--color-brand)'])]),
    },
  }

  it('reads a prefixed variable as a theme variable before treating it as internal', () => {
    expect(effective(input, ['tw:text-brand'])).toEqual(['color: srgb(18 52 86 / 1)'])
    expect(effective(input, ['tw:text-sm'])).toEqual(['font-size: 14px', 'line-height: 1.4286'])
  })

  it('does not read an unprefixed variable as a theme variable', () => {
    expect(effective(input, ['tw:plain'])).toEqual(['color: var(--color-brand)'])
  })
})

describe('Tailwind versions', () => {
  it('gives m-0 the same declarations on 4.3.0 (calc) and 4.3.1 (0px)', () => {
    const before = effective(
      {
        theme: { '--spacing': '0.25rem' },
        candidates: { 'm-0': ast([rule('.m-0', ['margin: calc(var(--spacing) * 0)'])]) },
      },
      ['m-0'],
    )
    const after = effective({ candidates: { 'm-0': ast([rule('.m-0', ['margin: 0px'])]) } }, [
      'm-0',
    ])
    expect(before).toEqual(after)
    expect(after).toEqual([
      'margin-bottom: 0',
      'margin-left: 0',
      'margin-right: 0',
      'margin-top: 0',
    ])
  })
})
