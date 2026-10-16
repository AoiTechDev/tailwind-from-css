// Every Tailwind behavior the engine relies on (RESEARCH §3, the research probes), asserted against
// the installed tailwindcss. CI runs this on 4.2.0, latest and insiders.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { TfcError } from '../../src/errors.ts'
import type { TailwindDesignSystem } from '../../src/tailwind/adapter.ts'
import { designSystem, FIXTURES, loadEntry, REPO_ROOT } from '../helpers/design-system.ts'
import { canonicalizer } from '../helpers/oracle.ts'
import { css, declarations, versionAtLeast } from '../helpers/print.ts'

const INSTALLED_VERSION: string = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'node_modules', 'tailwindcss', 'package.json'), 'utf8'),
).version

let ds: TailwindDesignSystem

beforeAll(async () => {
  ds = await designSystem()
})

describe('loadDesignSystem', () => {
  it('reports the installed version and no prefix', () => {
    expect(ds.version).toBe(INSTALLED_VERSION)
    expect(ds.prefix).toBeNull()
  })

  it('throws TFC903 with the cause when an @import is missing', async () => {
    const loading = loadEntry('@import "./missing-import.css";', resolve(FIXTURES, 'loader'))
    await expect(loading).rejects.toBeInstanceOf(TfcError)
    await expect(loading).rejects.toMatchObject({ code: 'TFC903', cause: expect.any(Error) })
  })

  it('throws TFC903 with the cause when a plugin fails', async () => {
    const loading = loadEntry('@plugin "./broken-plugin.mjs";', resolve(FIXTURES, 'loader'))
    await expect(loading).rejects.toMatchObject({ code: 'TFC903', cause: expect.any(Error) })
  })

  it('throws TFC903 when Tailwind rejects the entry CSS', async () => {
    const loading = loadEntry('@import "tailwindcss";\n.a { @apply tfc-unknown-utility; }')
    await expect(loading).rejects.toMatchObject({ code: 'TFC903', cause: expect.any(Error) })
  })

  it('resolves relative and package imports, @plugin and @config', async () => {
    const loaded = await loadEntry(
      [
        '@import "tailwindcss";',
        '@import "./entry.css";',
        '@import "tfc-style-export";',
        '@import "tfc-style-field";',
        '@import "@tfc/themes/ocean";',
        '@plugin "./plugin.mjs";',
        '@plugin "./plugin.cjs";',
        '@plugin "tfc-esm-plugin";',
        '@config "./config.mjs";',
      ].join('\n'),
      resolve(FIXTURES, 'loader'),
    )
    expect(css(loaded, 'text-relative')).toBe('.text-relative { color: var(--color-relative); }')
    expect(loaded.themeValue('--color-relative')).toBe('#010203')
    expect(loaded.themeValue('--spacing-relative')).toBe('3px')
    expect(loaded.themeValue('--color-from-style-export')).toBe('#0a0b0c')
    expect(loaded.themeValue('--color-from-style-field')).toBe('#101112')
    expect(loaded.themeValue('--color-from-pattern')).toBe('#131415')
    expect(css(loaded, 'tfc-esm')).toBe('.tfc-esm { text-wrap: stable; }')
    expect(css(loaded, 'tfc-cjs')).toBe('.tfc-cjs { text-wrap: nowrap; }')
    expect(css(loaded, 'tfc-from-package')).toBe('.tfc-from-package { text-wrap: pretty; }')
    expect(css(loaded, 'text-legacy')).toBe('.text-legacy { color: #abcdef; }')
  })
})

describe('classList (probe1, probe3)', () => {
  it('lists every named and bare candidate, negatives included', () => {
    const names = ds.classList().map((entry) => entry.name)
    expect(names.length).toBeGreaterThan(22_000)
    expect(names).toEqual(expect.arrayContaining(['flex', 'p-4', '-mt-4', 'w-1/2', 'bg-red-500']))
    expect(new Set(names).size).toBe(names.length)
  })

  it('lists the modifiers a candidate accepts', () => {
    const textSm = ds.classList().find((entry) => entry.name === 'text-sm')
    expect(textSm?.modifiers).toEqual(expect.arrayContaining(['tight', 'snug', 'relaxed']))
  })

  it('every listed candidate compiles (probe7)', { timeout: 60_000 }, () => {
    const names = ds.classList().map((entry) => entry.name)
    const asts = ds.toAst(names)
    expect(asts).toHaveLength(names.length)
    expect(names.filter((_, index) => asts[index] === null)).toEqual([])
  })
})

describe('toAst', () => {
  it('returns null for candidates that do not compile', () => {
    expect(ds.toAst(['foo-bar', 'flex', 'tw:flex'])).toEqual([null, expect.any(Object), null])
  })

  it('flattens variants into a full selector and conditions, outermost first', () => {
    expect(css(ds, 'hover:underline')).toBe(
      '@media (hover: hover) { .hover\\:underline:hover { text-decoration-line: underline; } }',
    )
    expect(css(ds, 'md:flex')).toBe('@media (width >= 48rem) { .md\\:flex { display: flex; } }')
    expect(css(ds, 'md:hover:flex')).toBe(
      '@media (width >= 48rem) { @media (hover: hover) { .md\\:hover\\:flex:hover { display: flex; } } }',
    )
    expect(css(ds, 'hover:focus:flex')).toBe(
      '@media (hover: hover) { .hover\\:focus\\:flex:hover:focus { display: flex; } }',
    )
    // Insiders (after 4.3.3) writes the class inside the `:is()`; N50 makes both shapes equal.
    expect([
      '@media (hover: hover) { .group-hover\\:flex:is(:where(.group):hover *) { display: flex; } }',
      '@media (hover: hover) { :is(:where(.group):hover .group-hover\\:flex) { display: flex; } }',
    ]).toContain(css(ds, 'group-hover:flex'))
    expect([
      '.peer-checked\\:flex:is(:where(.peer):checked ~ *) { display: flex; }',
      ':is(:where(.peer):checked ~ .peer-checked\\:flex) { display: flex; }',
    ]).toContain(css(ds, 'peer-checked:flex'))
    expect(css(ds, '*:flex')).toBe(':is(.\\*\\:flex > *) { display: flex; }')
    expect(css(ds, 'starting:flex')).toBe('@starting-style { .starting\\:flex { display: flex; } }')
    expect(css(ds, '@md:flex')).toBe(
      '@container (width >= 28rem) { .\\@md\\:flex { display: flex; } }',
    )
    expect(css(ds, 'print:flex')).toBe('@media print { .print\\:flex { display: flex; } }')
  })

  it('keeps one rule per selector a variant emits', () => {
    const [ast] = ds.toAst(['not-hover:flex'])
    expect(ast?.rules.map((rule) => rule.conditions)).toEqual([[], ['@media not (hover: hover)']])
  })

  it('marks important declarations, suffix and prefix form (probe4)', () => {
    expect(css(ds, 'p-4!')).toBe('.p-4\\! { padding: calc(var(--spacing) * 4) !important; }')
    expect(css(ds, '!p-4')).toBe('.\\!p-4 { padding: calc(var(--spacing) * 4) !important; }')
  })

  it('returns @property registrations separately', () => {
    const [ast] = ds.toAst(['border'])
    expect(ast?.properties).toEqual([
      { name: '--tw-border-style', syntax: '"*"', inherits: false, initialValue: 'solid' },
    ])
    const [leading] = ds.toAst(['leading-5'])
    expect(leading?.properties).toEqual([
      { name: '--tw-leading', syntax: '"*"', inherits: false, initialValue: undefined },
    ])
  })
})

describe('variant order (Tailwind compiles each candidate with getVariantOrder)', () => {
  it('gives the same ASTs and order after many variants were parsed', async () => {
    const parsed = await loadEntry('@import "tailwindcss";')
    const fresh = await loadEntry('@import "tailwindcss";')
    const probes = parsed
      .variants()
      .flatMap((entry) => [entry.name, ...entry.values.map((value) => `${entry.name}-${value}`)])
      .map((variant) => `${variant}:[--tfc-probe:0]`)
    parsed.toAst(probes)
    const candidates = [
      'p-4',
      'md:hover:p-4',
      'hover:md:p-4',
      'max-lg:md:flex',
      'dark:group-hover:focus:bg-red-500/50',
      'not-hover:p-1',
      '*:p-2',
      '@md:p-3',
      'data-[state=open]:underline',
      'before:[&:hover]:p-1',
    ]
    for (const list of [candidates, [...candidates].reverse()]) {
      expect(parsed.toAst(list)).toEqual(fresh.toAst(list))
      expect(parsed.classOrder(list)).toEqual(fresh.classOrder(list))
    }
  })
})

describe('RESEARCH §3.4 facts (probe4–7)', () => {
  it('bare spacing accepts any multiple of 0.25', () => {
    for (const value of ['13', '0.75', '2.25', '3.25']) {
      expect(declarations(ds, `p-${value}`)).toEqual([`padding: calc(var(--spacing) * ${value})`])
    }
    expect(ds.toAst(['p-0.3', 'p-0.125', 'w-3.33'])).toEqual([null, null, null])
    expect(declarations(ds, 'p-px')).toEqual(['padding: 1px'])
  })

  it('any fraction compiles to calc(a / b * 100%)', () => {
    expect(declarations(ds, 'w-1/2')).toEqual(['width: calc(1 / 2 * 100%)'])
    expect(declarations(ds, 'w-7/12')).toEqual(['width: calc(7 / 12 * 100%)'])
    expect(declarations(ds, 'w-13/17')).toEqual(['width: calc(13 / 17 * 100%)'])
  })

  it('bare integers compile', () => {
    expect(declarations(ds, 'z-37')).toEqual(['z-index: 37'])
  })

  it('before: and after: inject content: var(--tw-content) before the utility', () => {
    expect(css(ds, "before:[content:'']")).toBe(
      ".before\\:\\[content\\:\\'\\'\\]::before { content: var(--tw-content); content: ''; }",
    )
    const [ast] = ds.toAst(["after:content-['x']"])
    expect(ast && declarations(ds, "after:content-['x']")).toEqual([
      "--tw-content: 'x'",
      'content: var(--tw-content)',
    ])
    expect(ast?.properties).toEqual([
      { name: '--tw-content', syntax: '"*"', inherits: false, initialValue: '""' },
    ])
  })

  it('border sets border-style through a --tw-* variable with an @property initial value', () => {
    expect(declarations(ds, 'border')).toEqual([
      'border-style: var(--tw-border-style)',
      'border-width: 1px',
    ])
  })

  it('shadow-xs composes five layers; the others default to 0 0 #0000', () => {
    expect(declarations(ds, 'shadow-xs')).toEqual([
      '--tw-shadow: 0 1px 2px 0 var(--tw-shadow-color, rgb(0 0 0 / 0.05))',
      'box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)',
    ])
    const [ast] = ds.toAst(['shadow-xs'])
    const initial = Object.fromEntries(
      (ast?.properties ?? []).map((property) => [property.name, property.initialValue]),
    )
    for (const layer of [
      'inset-shadow',
      'inset-ring-shadow',
      'ring-offset-shadow',
      'ring-shadow',
    ]) {
      expect(initial[`--tw-${layer}`]).toBe('0 0 #0000')
    }
  })

  it('an opacity modifier becomes color-mix in oklab', () => {
    expect(declarations(ds, 'bg-red-500/50')).toEqual([
      'background-color: color-mix(in oklab, var(--color-red-500) 50%, transparent)',
    ])
  })

  it('classOrder sorts hover before md and arbitrary [&:hover] last (cascade hazard)', () => {
    expect(
      ds.classOrder([
        'md:text-red-500',
        'hover:text-blue-500',
        'md:hover:text-green-500',
        'hover:md:text-green-500',
        'text-black',
        '[&:hover]:text-white',
        'foo-bar',
      ]),
    ).toEqual([2n, 1n, 4n, 3n, 0n, 5n, null])
  })

  it('a prefixed candidate does not compile without prefix()', () => {
    expect(ds.toAst(['tw:flex'])).toEqual([null])
  })

  it('\\_ stays a literal underscore, _ becomes a space', () => {
    expect(declarations(ds, "[content:'a\\_b']")).toEqual(["content: 'a_b'"])
    expect(declarations(ds, "[content:'a_b']")).toEqual(["content: 'a b'"])
    expect(declarations(ds, '[font-family:My\\_Font]')).toEqual(['font-family: My_Font'])
  })
})

describe('compiled values (probe1, probe2)', () => {
  it.each([
    ['p-4', ['padding: calc(var(--spacing) * 4)']],
    ['-mt-4', ['margin-top: calc(var(--spacing) * -4)']],
    ['opacity-50', ['opacity: 50%']],
    [
      'text-sm',
      ['font-size: var(--text-sm)', 'line-height: var(--tw-leading, var(--text-sm--line-height))'],
    ],
    [
      'leading-5',
      ['--tw-leading: calc(var(--spacing) * 5)', 'line-height: calc(var(--spacing) * 5)'],
    ],
    ['size-4', ['width: calc(var(--spacing) * 4)', 'height: calc(var(--spacing) * 4)']],
    ['rounded-full', ['border-radius: calc(infinity * 1px)']],
    ['font-sans', ['font-family: var(--font-sans)']],
    [
      'tracking-tight',
      ['--tw-tracking: var(--tracking-tight)', 'letter-spacing: var(--tracking-tight)'],
    ],
    ['duration-150', ['--tw-duration: 150ms', 'transition-duration: 150ms']],
    ['grid-cols-3', ['grid-template-columns: repeat(3, minmax(0, 1fr))']],
    ['aspect-video', ['aspect-ratio: var(--aspect-video)']],
    ['mx-auto', ['margin-inline: auto']],
    ['ml-auto', ['margin-left: auto']],
    ['text-white', ['color: var(--color-white)']],
  ])('%s', (candidate, expected) => {
    expect(declarations(ds, candidate)).toEqual(expected)
  })

  it('zero spacing is 0px from 4.3.1, calc(var(--spacing) * 0) before', () => {
    const zero = versionAtLeast(ds.version, '4.3.1') ? '0px' : 'calc(var(--spacing) * 0)'
    expect(declarations(ds, 'm-0')).toEqual([`margin: ${zero}`])
    expect(declarations(ds, 'inset-0')).toEqual([`inset: ${zero}`])
    expect(declarations(ds, '*:first:pt-0')).toEqual([`padding-top: ${zero}`])
  })

  it('transition lists its properties and reads timing from --tw-* with theme fallbacks', () => {
    const [property, timing, duration] = declarations(ds, 'transition')
    expect(property).toMatch(/^transition-property: color, background-color, /)
    expect(timing).toBe(
      'transition-timing-function: var(--tw-ease, var(--default-transition-timing-function))',
    )
    expect(duration).toBe(
      'transition-duration: var(--tw-duration, var(--default-transition-duration))',
    )
  })
})

describe('arbitrary values and variants (probe5)', () => {
  it.each([
    ["content-['hello_world']", ["--tw-content: 'hello world'", 'content: var(--tw-content)']],
    ['bg-[url(/img/a_b.png)]', ['background-image: url(/img/a_b.png)']],
    ["bg-[url('/img/a_b.png')]", ["background-image: url('/img/a_b.png')"]],
    ['text-[var(--x)]', ['color: var(--x)']],
    ['text-(--x)', ['color: var(--x)']],
    ['text-(length:--x)', ['font-size: var(--x)']],
    ['text-[length:var(--x)]', ['font-size: var(--x)']],
    ['text-[color:var(--x)]', ['color: var(--x)']],
    ['bg-(--x)', ['background-color: var(--x)']],
    ['mt-[13px]', ['margin-top: 13px']],
    ['text-[#abc]', ['color: #abc']],
    ['[--my-var:3px]', ['--my-var: 3px']],
    ["[grid-template-areas:'a_b'_'c_d']", ["grid-template-areas: 'a b' 'c d'"]],
    ['grid-cols-[1fr_2fr]', ['grid-template-columns: 1fr 2fr']],
    ['grid-cols-[1fr,2fr]', ['grid-template-columns: 1fr,2fr']],
    ["[font-family:'Open_Sans',sans-serif]", ["font-family: 'Open Sans',sans-serif"]],
    ["font-['Open_Sans',sans-serif]", ["font-family: 'Open Sans',sans-serif"]],
    ['[transform:matrix(1,0,0,1,0,-10)]', ['transform: matrix(1,0,0,1,0,-10)']],
    [
      'shadow-[0_1px_2px_rgb(0_0_0/0.1)]',
      [
        '--tw-shadow: 0 1px 2px var(--tw-shadow-color, rgb(0 0 0/0.1))',
        'box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)',
      ],
    ],
    ['[transition:opacity_150ms_ease-in-out]', ['transition: opacity 150ms ease-in-out']],
    ['[margin:0_auto]', ['margin: 0 auto']],
    ['[width:calc(100%-2rem)]', ['width: calc(100% - 2rem)']],
    ['w-[calc(100%-2rem)]', ['width: calc(100% - 2rem)']],
    ['w-[calc(100%_-_2rem)]', ['width: calc(100% - 2rem)']],
    ['[color:rgb(0_0_0_/_0.5)]', ['color: rgb(0 0 0 / 0.5)']],
    ['text-[rgb(0,0,0,0.5)]', ['color: rgb(0,0,0,0.5)']],
    ['[--foo:bar_baz]', ['--foo: bar baz']],
    [
      '[mask-image:linear-gradient(to_bottom,black,transparent)]',
      ['mask-image: linear-gradient(to bottom,black,transparent)'],
    ],
    ['bg-[#ff000080]', ['background-color: #ff000080']],
    ['text-[14px]/[20px]', ['font-size: 14px', 'line-height: 20px']],
    ['text-[14px]/5', ['font-size: 14px', 'line-height: calc(var(--spacing) * 5)']],
  ])('%s', (candidate, expected) => {
    expect(declarations(ds, candidate)).toEqual(expected)
  })

  it.each([
    ['[&_p]:flex', '.\\[\\&_p\\]\\:flex p { display: flex; }'],
    [
      '[&:nth-child(2n+1)]:flex',
      '.\\[\\&\\:nth-child\\(2n\\+1\\)\\]\\:flex:nth-child(2n+1) { display: flex; }',
    ],
    [
      '[&[data-state=open]]:flex',
      '.\\[\\&\\[data-state\\=open\\]\\]\\:flex[data-state=open] { display: flex; }',
    ],
    [
      'data-[state=open]:flex',
      '.data-\\[state\\=open\\]\\:flex[data-state="open"] { display: flex; }',
    ],
    [
      'aria-[sort=ascending]:flex',
      '.aria-\\[sort\\=ascending\\]\\:flex[aria-sort="ascending"] { display: flex; }',
    ],
    [
      '[@supports(display:grid)]:flex',
      '@supports (display:grid) { .\\[\\@supports\\(display\\:grid\\)\\]\\:flex { display: flex; } }',
    ],
    [
      'supports-[display:grid]:flex',
      '@supports (display:grid) { .supports-\\[display\\:grid\\]\\:flex { display: flex; } }',
    ],
    ['max-[600px]:flex', '@media (width < 600px) { .max-\\[600px\\]\\:flex { display: flex; } }'],
    ['min-[600px]:flex', '@media (width >= 600px) { .min-\\[600px\\]\\:flex { display: flex; } }'],
    [
      '[@media(min-width:600px)_and_(max-width:900px)]:flex',
      '@media (min-width:600px) and (max-width:900px) { .\\[\\@media\\(min-width\\:600px\\)_and_\\(max-width\\:900px\\)\\]\\:flex { display: flex; } }',
    ],
    ['dark:flex', '@media (prefers-color-scheme: dark) { .dark\\:flex { display: flex; } }'],
  ])('%s', (candidate, expected) => {
    expect(css(ds, candidate)).toBe(expected)
  })

  // Selector whitespace is the normalizer's job (SPEC §6), so the adapter passes it through.
  it('[&>p]:flex prints the combinator with spaces from 4.3, as written before', () => {
    const child = versionAtLeast(ds.version, '4.3.0') ? ' > p' : '>p'
    expect(css(ds, '[&>p]:flex')).toBe(`.\\[\\&\\>p\\]\\:flex${child} { display: flex; }`)
  })
})

describe('variants (probe4)', () => {
  it('lists static, functional and breakpoint variants', () => {
    const names = ds.variants().map((variant) => variant.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'hover',
        'focus',
        'first',
        'before',
        'after',
        'not',
        'has',
        'aria',
        'data',
        'nth',
        'supports',
        'min',
        'max',
        'sm',
        'md',
        'lg',
        'xl',
        '2xl',
        '@min',
        '@max',
        'dark',
        'starting',
        'print',
        'motion-safe',
        'contrast-more',
        'forced-colors',
        'pointer-fine',
      ]),
    )
    expect(new Set(names).size).toBe(names.length)
  })

  it('exposes the selectors of static variants', () => {
    const byName = new Map(ds.variants().map((variant) => [variant.name, variant]))
    expect(byName.get('hover')?.selectors({})).toEqual(['@media (hover: hover) { &:hover }'])
    expect(byName.get('md')?.selectors({})).toEqual(['@media (width >= 48rem)'])
    expect(byName.get('dark')?.selectors({})).toEqual(['@media (prefers-color-scheme: dark)'])
    expect(byName.get('aria')?.values).toEqual(
      expect.arrayContaining(['checked', 'disabled', 'expanded']),
    )
    expect(byName.get('min')?.isArbitrary).toBe(true)
  })
})

describe('themeValue (probe7)', () => {
  it.each([
    ['--color-red-500', 'oklch(63.7% 0.237 25.331)'],
    ['--spacing', '0.25rem'],
    ['--breakpoint-md', '48rem'],
    ['--text-sm--line-height', 'calc(1.25 / 0.875)'],
    ['--aspect-video', '16 / 9'],
    ['--color-white', '#fff'],
  ])('%s = %s', (name, value) => {
    expect(ds.themeValue(name)).toBe(value)
  })

  it('is undefined for an unknown variable', () => {
    expect(ds.themeValue('--tfc-unknown')).toBeUndefined()
  })
})

describe('functionalRoots', () => {
  it('lists functional utility roots, sorted, negatives included', () => {
    const roots = ds.functionalRoots()
    expect(roots).toEqual(expect.arrayContaining(['p', 'mt', '-mt', 'text', 'bg', 'w', 'z']))
    expect(roots).toEqual([...roots].sort())
    expect(roots).not.toContain('sr-only')
  })
})

describe('fixtures', () => {
  it('custom theme: --color-*: initial leaves only the custom colors', async () => {
    const theme = await designSystem('custom-theme')
    const names = theme.classList().map((entry) => entry.name)
    expect(names).toEqual(expect.arrayContaining(['text-brand', 'bg-ink']))
    expect(names).not.toContain('text-red-500')
    expect(theme.toAst(['text-red-500'])).toEqual([null])
    expect(declarations(theme, 'text-brand')).toEqual(['color: var(--color-brand)'])
    expect(theme.themeValue('--color-brand')).toBe('#123456')
    expect(theme.themeValue('--spacing')).toBe('0.5rem')
    expect(css(theme, 'tablet:flex')).toBe(
      '@media (width >= 40rem) { .tablet\\:flex { display: flex; } }',
    )
  })

  it('prefix(tw): only prefixed candidates compile, and classList returns them prefixed', async () => {
    const prefixed = await designSystem('prefix')
    expect(prefixed.prefix).toBe('tw')
    const names = prefixed.classList().map((entry) => entry.name)
    expect(names).toEqual(expect.arrayContaining(['tw:flex', 'tw:-mt-4', 'tw:text-brand']))
    expect(names.every((name) => name.startsWith('tw:'))).toBe(true)
    expect(prefixed.toAst(['flex'])).toEqual([null])
    expect(css(prefixed, 'tw:hover:flex')).toBe(
      '@media (hover: hover) { .tw\\:hover\\:flex:hover { display: flex; } }',
    )
    expect(prefixed.classOrder(['tw:flex', 'flex'])).toEqual([0n, null])
    // Theme variables get the prefix too, so they share the --tw-* namespace with Tailwind's
    // internal variables. themeValue takes the unprefixed name.
    expect(declarations(prefixed, 'tw:text-brand')).toEqual(['color: var(--tw-color-brand)'])
    expect(prefixed.themeValue('--color-brand')).toBe('#123456')
  })

  it.each(['plugin-esm', 'plugin-cjs'] as const)(
    '%s: plugin utilities and variants',
    async (name) => {
      const plugin = await designSystem(name)
      const names = plugin.classList().map((entry) => entry.name)
      const variants = plugin.variants().map((variant) => variant.name)
      if (name === 'plugin-esm') {
        expect(names).toEqual(expect.arrayContaining(['tfc-card', 'tfc-tab-2', 'tfc-tab-4']))
        expect(variants).toContain('tfc-hocus')
        expect(css(plugin, 'tfc-card')).toBe(
          '.tfc-card { border-radius: 12px; } .tfc-card:hover { border-radius: 16px; }',
        )
        expect(css(plugin, 'tfc-tab-4')).toBe('.tfc-tab-4 { tab-size: 4; }')
        expect(css(plugin, 'tfc-hocus:flex')).toBe(
          '.tfc-hocus\\:flex:hover { display: flex; } .tfc-hocus\\:flex:focus { display: flex; }',
        )
      } else {
        expect(names).toContain('tfc-legacy')
        expect(variants).toContain('tfc-optional')
        expect(css(plugin, 'tfc-legacy')).toBe('.tfc-legacy { text-wrap: balance; }')
        expect(css(plugin, 'tfc-optional:flex')).toBe(
          '.tfc-optional\\:flex:optional { display: flex; }',
        )
      }
    },
  )

  it('@custom-variant: selector, block and overridden variants', async () => {
    const custom = await designSystem('custom-variant')
    const byName = new Map(custom.variants().map((variant) => [variant.name, variant]))
    expect(byName.get('dark')?.selectors({})).toEqual(['&:where(.dark, .dark *)'])
    expect(byName.get('fine-pointer')?.selectors({})).toEqual(['@media (pointer: fine)'])
    expect(css(custom, 'dark:flex')).toBe('.dark\\:flex:where(.dark, .dark *) { display: flex; }')
    expect(css(custom, 'theme-midnight:flex')).toBe(
      '.theme-midnight\\:flex:where([data-theme="midnight"] *) { display: flex; }',
    )
    expect(css(custom, 'fine-pointer:flex')).toBe(
      '@media (pointer: fine) { .fine-pointer\\:flex { display: flex; } }',
    )
    expect(css(custom, 'md:fine-pointer:flex')).toBe(
      '@media (width >= 48rem) { @media (pointer: fine) { .md\\:fine-pointer\\:flex { display: flex; } } }',
    )
  })

  it('@utility: static, nested and functional utilities', async () => {
    const utility = await designSystem('utility')
    const names = utility.classList().map((entry) => entry.name)
    expect(names).toEqual(expect.arrayContaining(['content-auto', 'scrollbar-hidden']))
    expect(utility.functionalRoots()).toContain('tfc-tab')
    expect(css(utility, 'content-auto')).toBe('.content-auto { content-visibility: auto; }')
    expect(css(utility, 'scrollbar-hidden')).toBe(
      '.scrollbar-hidden { scrollbar-width: none; } .scrollbar-hidden::-webkit-scrollbar { display: none; }',
    )
    expect(css(utility, 'tfc-tab-3')).toBe('.tfc-tab-3 { tab-size: 3; }')
    expect(css(utility, 'hover:scrollbar-hidden')).toBe(
      '@media (hover: hover) { .hover\\:scrollbar-hidden:hover { scrollbar-width: none; } } ' +
        '@media (hover: hover) { .hover\\:scrollbar-hidden:hover::-webkit-scrollbar { display: none; } }',
    )
  })
})

// RESEARCH §3.2: canonicalizeCandidates is a correct but conservative equivalence oracle. These rows
// record what it does and does not find; the engine must cover the gaps itself.
// The first call per option set fills Tailwind's caches and takes seconds (RESEARCH §3.3).
describe('canonicalizeCandidates oracle (probe2)', { timeout: 30_000 }, () => {
  let canonicalize: Awaited<ReturnType<typeof canonicalizer>>

  beforeAll(async () => {
    canonicalize = await canonicalizer()
  })

  it.each([
    [['[padding:16px]'], {}, 'p-[16px]'],
    [['[padding:16px]'], { rem: 16 }, 'p-4'],
    [['[padding:13px]'], { rem: 16 }, 'p-[13px]'],
    [['[width:50%]'], { rem: 16 }, 'w-[50%]'],
    [['[opacity:0.5]'], {}, 'opacity-[0.5]'],
    [['[opacity:50%]'], {}, 'opacity-50'],
    [['[color:#ef4444]'], {}, 'text-[#ef4444]'],
    [['[background-color:oklch(0.637_0.237_25.331)]'], {}, 'bg-[oklch(0.637_0.237_25.331)]'],
    [['[color:#ffffff]'], {}, 'text-[#ffffff]'],
    [['[color:#fff]'], {}, 'text-white'],
    [['[color:rgb(0,0,0)]'], {}, 'text-[rgb(0,0,0)]'],
    [['[margin:0_auto]'], {}, 'm-[0_auto]'],
    [['[margin-left:auto]', '[margin-right:auto]'], { collapse: true }, 'ml-auto mr-auto'],
    [
      ['[margin-left:auto]', '[margin-right:auto]'],
      { collapse: true, logicalToPhysical: true },
      'mx-auto',
    ],
    [
      ['[font-size:0.875rem]', '[line-height:1.25rem]'],
      { rem: 16, collapse: true },
      'text-[0.875rem] leading-5',
    ],
    [['[border-width:1px]'], {}, '[border-width:1px]'],
    [['[border-radius:9999px]'], {}, 'rounded-[9999px]'],
    [['[@media(min-width:768px)]:[display:flex]'], { rem: 16 }, '[@media(min-width:768px)]:flex'],
    [['[@media(prefers-color-scheme:dark)]:[display:flex]'], {}, 'dark:flex'],
    [['[&:hover]:[display:flex]'], {}, '[&:hover]:flex'],
    [['[&:focus]:[display:flex]'], {}, 'focus:flex'],
    [['[&:first-child]:[display:flex]'], {}, 'first:flex'],
    [['[&::before]:[content:""]'], {}, '[&::before]:[content:""]'],
    [['[box-shadow:0_1px_2px_0_rgb(0_0_0/0.05)]'], {}, '[box-shadow:0_1px_2px_0_rgb(0_0_0/0.05)]'],
    [['[top:0]', '[right:0]', '[bottom:0]', '[left:0]'], { collapse: true }, 'inset-0'],
    [['[width:1rem]', '[height:1rem]'], { collapse: true, rem: 16 }, 'size-4'],
    [['[grid-template-columns:repeat(3,minmax(0,1fr))]'], {}, 'grid-cols-3'],
    [['[aspect-ratio:16/9]'], {}, 'aspect-video'],
  ])('%j %j → %s', (candidates, options, expected) => {
    expect(canonicalize(candidates, options).join(' ')).toBe(expected)
  })

  it('matches font-sans only when the stack is the installed theme value, spaces as _', () => {
    const stack = ds.themeValue('--font-sans')?.replace(/\s+/g, ' ').replaceAll(' ', '_')
    expect(canonicalize([`[font-family:${stack}]`]).join(' ')).toBe('font-sans')
  })
})
