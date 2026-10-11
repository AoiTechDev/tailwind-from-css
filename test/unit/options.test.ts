import { describe, expect, it } from 'vitest'
import { TfcError } from '../../src/errors.ts'
import { RELAXATION_NAMES, resolveOptions } from '../../src/options.ts'

const DEFAULTS = { base: '/project' }

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    return error instanceof TfcError ? error.code : 'not a TfcError'
  }
  return undefined
}

describe('resolveOptions', () => {
  it('applies every default', () => {
    expect(resolveOptions(undefined, DEFAULTS)).toEqual({
      mode: 'exact',
      relaxations: [],
      tailwind: { css: '@import "tailwindcss";', base: '/project' },
      rootFontSize: 16,
      tolerance: { colorDeltaE: 0.02, lengthPx: 2, lengthRatio: 0.1, breakpointPx: 16 },
      important: 'suffix',
    })
    expect(resolveOptions({}, DEFAULTS)).toEqual(resolveOptions(undefined, DEFAULTS))
  })

  it('keeps given values', () => {
    const resolved = resolveOptions(
      {
        tailwind: { css: '@import "./app.css";', base: '/elsewhere' },
        rootFontSize: false,
        tolerance: { lengthPx: 1 },
        important: 'prefix',
      },
      DEFAULTS,
    )
    expect(resolved.tailwind).toEqual({ css: '@import "./app.css";', base: '/elsewhere' })
    expect(resolved.rootFontSize).toBe(false)
    expect(resolved.tolerance).toEqual({
      colorDeltaE: 0.02,
      lengthPx: 1,
      lengthRatio: 0.1,
      breakpointPx: 16,
    })
    expect(resolved.important).toBe('prefix')
    expect(resolveOptions({ rootFontSize: 10, tailwind: {} }, DEFAULTS).rootFontSize).toBe(10)
  })

  it('treats undefined values as absent', () => {
    expect(resolveOptions({ mode: undefined, tolerance: undefined }, DEFAULTS)).toEqual(
      resolveOptions(undefined, DEFAULTS),
    )
  })

  it('freezes the result, nested objects included', () => {
    const resolved = resolveOptions({ relax: ['pill-radius'] }, DEFAULTS)
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.relaxations)).toBe(true)
    expect(Object.isFrozen(resolved.tailwind)).toBe(true)
    expect(Object.isFrozen(resolved.tolerance)).toBe(true)
  })

  it('does not keep references to the caller’s objects', () => {
    const relax: ['pill-radius'] = ['pill-radius']
    const resolved = resolveOptions({ relax }, DEFAULTS)
    relax.push('color-nearest' as never)
    expect(resolved.relaxations).toEqual(['pill-radius'])
  })
})

describe('mode presets (ADR-0004)', () => {
  it('exact has no relaxation, nearest has all of them, sorted by name', () => {
    expect(resolveOptions({ mode: 'exact' }, DEFAULTS).relaxations).toEqual([])
    expect(resolveOptions({ mode: 'nearest' }, DEFAULTS).relaxations).toEqual([
      'breakpoint-nearest',
      'color-nearest',
      'font-weight-nearest',
      'hover-media',
      'length-nearest',
      'logical-properties',
      'pill-radius',
      'text-line-height',
    ])
    expect([...RELAXATION_NAMES].sort()).toEqual(
      resolveOptions({ mode: 'nearest' }, DEFAULTS).relaxations,
    )
  })

  it('adds relaxations to the preset', () => {
    expect(
      resolveOptions({ relax: ['pill-radius', 'color-nearest', 'pill-radius'] }, DEFAULTS)
        .relaxations,
    ).toEqual(['color-nearest', 'pill-radius'])
  })

  it('removes relaxations with !name', () => {
    const resolved = resolveOptions({ mode: 'nearest', relax: ['!hover-media'] }, DEFAULTS)
    expect(resolved.relaxations).not.toContain('hover-media')
    expect(resolved.relaxations).toHaveLength(RELAXATION_NAMES.length - 1)
    expect(resolveOptions({ relax: ['!pill-radius'] }, DEFAULTS).relaxations).toEqual([])
  })

  it('applies relax entries in order', () => {
    expect(
      resolveOptions({ relax: ['pill-radius', '!pill-radius'] }, DEFAULTS).relaxations,
    ).toEqual([])
    expect(
      resolveOptions({ relax: ['!pill-radius', 'pill-radius'] }, DEFAULTS).relaxations,
    ).toEqual(['pill-radius'])
  })
})

describe('validation → TFC904', () => {
  const invalid: [string, unknown][] = [
    ['options that are not an object', 'exact'],
    ['null options', null],
    ['array options', []],
    ['an unknown key', { strict: true }],
    ['an unknown mode', { mode: 'fast' }],
    ['relax that is not an array', { relax: 'pill-radius' }],
    ['an unknown relaxation', { relax: ['hover'] }],
    ['an unknown negated relaxation', { relax: ['!nope'] }],
    ['a relaxation that is not a string', { relax: [1] }],
    ['tailwind that is not an object', { tailwind: '@import "tailwindcss";' }],
    ['an unknown tailwind key', { tailwind: { config: 'tailwind.config.js' } }],
    ['a tailwind css that is not a string', { tailwind: { css: 1 } }],
    ['an empty base', { tailwind: { base: '' } }],
    ['rootFontSize true', { rootFontSize: true }],
    ['rootFontSize 0', { rootFontSize: 0 }],
    ['a negative rootFontSize', { rootFontSize: -16 }],
    ['an infinite rootFontSize', { rootFontSize: Number.POSITIVE_INFINITY }],
    ['rootFontSize NaN', { rootFontSize: Number.NaN }],
    ['tolerance that is not an object', { tolerance: 2 }],
    ['an unknown tolerance key', { tolerance: { deltaE: 1 } }],
    ['a negative tolerance', { tolerance: { lengthPx: -1 } }],
    ['a tolerance that is a string', { tolerance: { colorDeltaE: '0.02' } }],
    ['an unknown important placement', { important: 'both' }],
  ]

  it.each(invalid)('rejects %s', (_, options) => {
    expect(codeOf(() => resolveOptions(options, DEFAULTS))).toBe('TFC904')
  })

  it('names the offending option in the message', () => {
    expect(() => resolveOptions({ tolerance: { lengthPx: -1 } }, DEFAULTS)).toThrow(
      /tolerance\.lengthPx/,
    )
    expect(() => resolveOptions({ relax: ['hover'] }, DEFAULTS)).toThrow(/"hover"/)
    expect(() => resolveOptions({ colour: 1 }, DEFAULTS)).toThrow(/colour/)
  })

  it('accepts zero tolerances', () => {
    expect(
      resolveOptions(
        { tolerance: { colorDeltaE: 0, lengthPx: 0, lengthRatio: 0, breakpointPx: 0 } },
        DEFAULTS,
      ).tolerance.lengthPx,
    ).toBe(0)
  })
})
