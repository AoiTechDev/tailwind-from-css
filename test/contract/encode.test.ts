// SPEC §5.5: every value we encode must come back from Tailwind as the same normal declaration.
import { beforeAll, describe, expect, it } from 'vitest'
import { normalizeDeclarations, normalValuesEqual } from '../../src/css/normalize/index.ts'
import { arbitraryProperty, candidateName, encodeValue } from '../../src/match/encode.ts'
import type { TailwindDesignSystem } from '../../src/tailwind/adapter.ts'
import { BASE_CONTEXT, effectiveDeclarations } from '../../src/tailwind/effective.ts'
import { designSystem, type TailwindFixture } from '../helpers/design-system.ts'

const OPTIONS = { rootFontSize: 16 } as const

const CORPUS: readonly (readonly [string, string])[] = [
  ['border', '1px solid red'],
  ['margin', '0 auto'],
  ['inset', '0 auto auto 0'],
  ['color', 'rgb( 0 , 0 , 0 )'],
  ['color', 'rgb(0 0 0 / 0.5)'],
  ['color', 'color-mix(in oklab, red 50%, blue)'],
  ['color', 'var(--brand_color, #fff)'],
  ['width', 'calc(100% - 2rem)'],
  ['width', 'min(100%, 40rem)'],
  ['width', 'clamp(1rem, 2.5vw + 1rem, 3rem)'],
  ['transform', 'translate(calc(1px * 2), 0) rotate(45deg)'],
  ['filter', 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.1)) blur(4px)'],
  ['box-shadow', '0 1px 2px 0 rgb(0 0 0 / 0.05), inset 0 0 0 1px red'],
  ['clip-path', 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'],
  ['font-family', '"Helvetica Neue", Arial_Narrow, sans-serif'],
  ['font-feature-settings', '"liga" 1, "kern"'],
  ['background-image', 'url(a_b.png)'],
  ['background-image', 'url( "a_b.png" )'],
  ['background-image', 'linear-gradient(to right, red 0%, blue 100%), url(x_y.png)'],
  ['background', 'url(a_b.png) center / cover no-repeat'],
  ['mask-image', 'url("data:image/svg+xml;utf8,<svg></svg>")'],
  ['content', '"a b"'],
  ['content', '"a_b"'],
  ['content', '""'],
  ['content', `"it's"`],
  ['content', `'say "hi"'`],
  ['content', '"\\201C"'],
  ['content', 'attr(data-label)'],
  ['quotes', '"«" "»"'],
  ['grid-template-areas', '"head head" "side main"'],
  ['grid-template-columns', 'repeat(auto-fill, minmax(10rem, 1fr))'],
  ['grid-template-columns', '[full-start] 1fr [full-end]'],
  ['transition', 'opacity 150ms ease-in-out, transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)'],
  ['animation', 'spin 1s linear infinite'],
  ['--x', 'a b'],
  ['--x', 'a_b'],
  ['--my-shadow', '0 0 0 1px red'],
  ['-webkit-line-clamp', '3'],
]

function expectRoundTrip(design: TailwindDesignSystem, property: string, value: string): void {
  const encoded = encodeValue(value)
  expect(encoded, value).toBeDefined()
  const core = arbitraryProperty(property, encoded as string)
  for (const important of [false, 'suffix', 'prefix'] as const) {
    const candidate = candidateName(core, { prefix: design.prefix, important })
    const actual = effectiveDeclarations(design, [candidate], BASE_CONTEXT, OPTIONS)
    const wanted = normalizeDeclarations(
      [{ property, value, important: important !== false }],
      OPTIONS,
    )
    expect(actual.map((declaration) => declaration.property).sort(), candidate).toEqual(
      wanted.map((declaration) => declaration.property).sort(),
    )
    for (const declaration of actual) {
      const expected = wanted.find((other) => other.property === declaration.property)
      expect(normalValuesEqual(declaration.value, expected?.value ?? ''), candidate).toBe(true)
      expect(declaration.important, candidate).toBe(important !== false)
    }
  }
}

describe.each([
  ['default theme', undefined],
  ['custom theme', 'custom-theme'],
  ['prefix(tw)', 'prefix'],
] as const)('%s', (_, fixture: TailwindFixture | undefined) => {
  let design: TailwindDesignSystem

  beforeAll(async () => {
    design = await designSystem(fixture)
  })

  it.each(CORPUS)('[%s:%s] round-trips', (property, value) => {
    expectRoundTrip(design, property, value)
  })
})
