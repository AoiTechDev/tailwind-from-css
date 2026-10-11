import { describe, expect, it } from 'vitest'
import { normalizeConditions } from '../../../src/css/conditions.ts'

const conditions = (...list: string[]): string[] => normalizeConditions(list, { rootFontSize: 16 })

describe('N30 media range syntax', () => {
  it('reads min-/max- features as ranges', () => {
    expect(conditions('@media (min-width: 768px)')).toEqual(['@media (width >= 768px)'])
    expect(conditions('@media (max-width:767px)')).toEqual(['@media (width <= 767px)'])
    expect(conditions('@media (min-height: 100px)')).toEqual(['@media (height >= 100px)'])
    expect(conditions('@media (min-aspect-ratio: 16/9)')).toEqual([
      '@media (aspect-ratio >= 16 / 9)',
    ])
  })

  it('makes the classic and the range form of md equal', () => {
    expect(conditions('@media (min-width: 768px)')).toEqual(conditions('@media (width >= 48rem)'))
    expect(conditions('@media (768px <= width)')).toEqual(conditions('@media (width >= 768px)'))
    expect(conditions('@media (768px < width)')).toEqual(['@media (width > 768px)'])
    expect(conditions('@media (WIDTH=500PX)')).toEqual(['@media (width = 500px)'])
  })

  it('splits a two-sided range into two terms', () => {
    expect(conditions('@media (400px <= width <= 700px)')).toEqual(
      conditions('@media (min-width: 400px) and (max-width: 700px)'),
    )
    expect(conditions('@media (400px < width < 700px)')).toEqual([
      '@media (width < 700px) and (width > 400px)',
    ])
  })

  it('keeps max-width apart from Tailwind max-*, which is width < X', () => {
    expect(conditions('@media (max-width: 768px)')).not.toEqual(
      conditions('@media (width < 48rem)'),
    )
    expect(conditions('@media (min-width: 768px)')).not.toEqual(
      conditions('@media (width > 768px)'),
    )
  })

  it('keeps other features as name: value', () => {
    expect(conditions('@media (prefers-color-scheme: DARK)')).toEqual([
      '@media (prefers-color-scheme: dark)',
    ])
    expect(conditions('@media (min-resolution: 2dppx)')).toEqual(['@media (resolution >= 2dppx)'])
    expect(conditions('@media (hover)')).toEqual(['@media (hover)'])
    expect(conditions('@media (min-foo: 1px)')).toEqual(['@media (min-foo: 1px)'])
  })
})

describe('N31 media lengths in px at 16px', () => {
  it('converts rem and em with 16, whatever the root font size', () => {
    expect(conditions('@media (min-width: 48rem)')).toEqual(['@media (width >= 768px)'])
    expect(conditions('@media (min-width: 40em)')).toEqual(['@media (width >= 640px)'])
    expect(normalizeConditions(['@media (min-width: 48rem)'], { rootFontSize: 10 })).toEqual([
      '@media (width >= 768px)',
    ])
    expect(normalizeConditions(['@media (min-width: 48rem)'], { rootFontSize: false })).toEqual([
      '@media (width >= 768px)',
    ])
    expect(conditions('@media (min-width: 0px)')).toEqual(conditions('@media (min-width: 0)'))
  })

  it('uses the root font size for container queries and keeps em there', () => {
    expect(conditions('@container (width >= 28rem)')).toEqual(['@container (width >= 448px)'])
    expect(normalizeConditions(['@container (width >= 28rem)'], { rootFontSize: false })).toEqual([
      '@container (width >= 28rem)',
    ])
    expect(conditions('@container (min-width: 2em)')).toEqual(['@container (width >= 2em)'])
  })

  it('keeps different lengths apart', () => {
    expect(conditions('@media (min-width: 48rem)')).not.toEqual(
      conditions('@media (min-width: 767px)'),
    )
    expect(conditions('@media (min-width: 1vw)')).toEqual(['@media (width >= 1vw)'])
  })
})

describe('N32 media types', () => {
  it('drops only, all and, and screen and', () => {
    expect(conditions('@media only screen and (min-width: 48rem)')).toEqual([
      '@media (width >= 768px)',
    ])
    expect(conditions('@media all and (hover: hover)')).toEqual(['@media (hover: hover)'])
    expect(conditions('@media screen and (prefers-reduced-motion: reduce)')).toEqual([
      '@media (prefers-reduced-motion: reduce)',
    ])
  })

  it('drops a condition that always holds', () => {
    expect(conditions('@media all')).toEqual([])
    expect(conditions('@media all', '@supports (display: grid)')).toEqual([
      '@supports (display: grid)',
    ])
  })

  it('keeps print, a bare screen, and negated queries', () => {
    expect(conditions('@media print')).toEqual(['@media print'])
    expect(conditions('@media only print and (min-width: 1px)')).toEqual([
      '@media print and (width >= 1px)',
    ])
    expect(conditions('@media screen')).toEqual(['@media screen'])
    expect(conditions('@media not all and (monochrome)')).toEqual([
      '@media not all and (monochrome)',
    ])
    expect(conditions('@media not (hover: hover)')).toEqual(['@media not (hover: hover)'])
    expect(conditions('@media print')).not.toEqual(conditions('@media screen'))
  })

  it('sorts query lists and conditions it cannot split', () => {
    expect(conditions('@media print, (min-width: 640px)')).toEqual([
      '@media (width >= 640px), print',
    ])
    expect(conditions('@media (hover: hover) or (pointer: fine)')).toEqual([
      '@media (hover: hover) or (pointer: fine)',
    ])
    expect(conditions('@media ((min-width: 1px) and (hover))')).toEqual([
      '@media ((width >= 1px) and (hover))',
    ])
    expect(conditions('@media (not (hover))')).toEqual(['@media (not (hover))'])
  })
})

describe('preludes it cannot read (property-test seeds)', () => {
  it.each([
    '@media a,"',
    '@media a,[',
    '@media a, ,',
    '@media , a',
    '@media (a',
    '@media a)',
    '@supports (content: ";")',
  ])('%j stays verbatim and stable', (condition) => {
    const once = conditions(condition)
    expect(once).toEqual([condition])
    expect(conditions(...once)).toEqual(once)
  })
})

describe('N33 nested conditions', () => {
  it('merges nested media into one sorted conjunction', () => {
    expect(conditions('@media (min-width: 600px)', '@media (max-width: 900px)')).toEqual(
      conditions('@media (min-width:600px) and (max-width:900px)'),
    )
    expect(conditions('@media (max-width: 900px)', '@media (min-width: 600px)')).toEqual([
      '@media (width <= 900px) and (width >= 600px)',
    ])
    expect(conditions('@media print', '@media (min-width: 40em)')).toEqual([
      '@media print and (width >= 640px)',
    ])
    expect(conditions('@media (hover: hover)', '@media (hover: hover)')).toEqual([
      '@media (hover: hover)',
    ])
  })

  it('ignores the nesting order of different at-rules', () => {
    expect(conditions('@supports (display:grid)', '@media (hover: hover)')).toEqual(
      conditions('@media (hover: hover)', '@supports (display: grid)'),
    )
    expect(conditions('@starting-style', '@media print')).toEqual([
      '@media print',
      '@starting-style',
    ])
  })

  it('merges supports conjunctions and normalizes their declarations', () => {
    expect(
      conditions('@supports (Display:grid)', '@supports (gap: 1px) and selector(:has(a))'),
    ).toEqual(['@supports (display: grid) and (gap: 1px) and selector(:has(a))'])
    expect(conditions('@supports not (display: grid)')).toEqual(['@supports not (display: grid)'])
  })

  it('merges container size queries of the same container only', () => {
    expect(
      conditions('@container sidebar (min-width: 400px)', '@container sidebar (max-width: 600px)'),
    ).toEqual(['@container sidebar (width <= 600px) and (width >= 400px)'])
    expect(conditions('@container a (width > 1px)', '@container b (width > 1px)')).toEqual([
      '@container a (width > 1px)',
      '@container b (width > 1px)',
    ])
    expect(conditions('@container (width > 1px)', '@container style(--x: Y)')).toEqual([
      '@container (width > 1px)',
      '@container style(--x: Y)',
    ])
    expect(conditions('@container not (width > 1px)')).toEqual(['@container not (width > 1px)'])
    expect(conditions('@container Card')).toEqual(['@container Card'])
  })

  it('keeps conflicting media types and negations apart', () => {
    expect(conditions('@media print', '@media speech')).toEqual(['@media print', '@media speech'])
    expect(conditions('@media not (hover: hover)', '@media (hover: hover)')).toEqual([
      '@media (hover: hover)',
      '@media not (hover: hover)',
    ])
  })

  it('keeps other at-rules and bare text with whitespace collapsed', () => {
    expect(conditions('@LAYER  base /* c */')).toEqual(['@layer base'])
    expect(conditions('  something   else ')).toEqual(['something else'])
  })
})
