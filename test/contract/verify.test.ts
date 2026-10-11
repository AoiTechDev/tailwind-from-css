// SPEC §5.3–§5.7 against the installed Tailwind: blocks of one element → variants, classes, and
// verification of the whole class list. Ordinary conversions must verify without TFC501.
import { beforeAll, describe, expect, it } from 'vitest'
import type { TailwindDesignSystem } from '../../src/tailwind/adapter.ts'
import { designSystem, type TailwindFixture } from '../helpers/design-system.ts'
import { type BlockInput, createPipeline, type PipelineResult } from '../helpers/pipeline.ts'

function pipelineFor(fixture?: TailwindFixture) {
  let run: (blocks: readonly BlockInput[]) => PipelineResult
  beforeAll(async () => {
    const design: TailwindDesignSystem = await designSystem(fixture)
    run = createPipeline(design)
  })
  return {
    run: (blocks: readonly BlockInput[]) => run(blocks),
    /** Classes of a conversion that must verify cleanly. */
    classes: (blocks: readonly BlockInput[]): readonly string[] => {
      const result = run(blocks)
      expect(result.verified.issues).toEqual([])
      return result.classes
    },
  }
}

const HOVER_MEDIA = '@media (hover: hover)'
const MD = '@media (min-width: 768px)'

describe('default theme', () => {
  const { run, classes } = pipelineFor()

  it('puts each block behind its variant chain', () => {
    expect(classes([{ css: 'color: #fff' }, { selector: '&:hover', css: 'color: #000' }])).toEqual([
      'text-white',
      '[&:hover]:text-black',
    ])
    expect(
      classes([
        { css: 'color: #fff' },
        { selector: '&:hover', conditions: [HOVER_MEDIA], css: 'color: #000' },
      ]),
    ).toEqual(['text-white', 'hover:text-black'])
    expect(classes([{ css: 'padding: 13px' }, { conditions: [MD], css: 'padding: 16px' }])).toEqual(
      ['p-3.25', 'md:p-4'],
    )
    expect(classes([{ selector: '&:hover', conditions: [MD], css: 'margin: 0 auto' }])).toEqual([
      'md:[&:hover]:mt-0',
      'md:[&:hover]:mr-auto',
      'md:[&:hover]:mb-0',
      'md:[&:hover]:ml-auto',
    ])
    expect(classes([{ selector: '&:focus', css: 'padding: 16px !important' }])).toEqual([
      'focus:p-4!',
    ])
    expect(
      classes([{ selector: '&[data-state=open]', css: 'font-size: 14px; line-height: 24px' }]),
    ).toEqual(['data-[state=open]:text-sm/6'])
    expect(classes([{ conditions: ['@media (max-width: 767px)'], css: 'color: #ef4444' }])).toEqual(
      ['[@media(max-width:767px)]:text-[#ef4444]'],
    )
  })

  it('uses before: only where the block sets content', () => {
    expect(classes([{ selector: '&::before', css: 'content: "x"; color: #fff' }])).toEqual([
      'before:text-white',
      "before:content-['x']",
    ])
    expect(classes([{ selector: '&::before', css: 'color: #fff' }])).toEqual([
      '[&::before]:text-white',
    ])
  })

  it('falls back to arbitrary properties where another context changes a block (ADR-0013)', () => {
    expect(
      classes([{ css: 'translate: 4px 0' }, { selector: '&:hover', css: 'translate: 0 4px' }]),
    ).toEqual(['translate-x-1', '[&:hover]:[translate:0_4px]'])
    const shadow = '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)'
    expect(classes([{ css: 'box-shadow: 0 0 0 2px currentcolor' }])).toEqual(['ring-2'])
    expect(classes([{ selector: '&:hover', css: `box-shadow: ${shadow}` }])).toEqual([
      '[&:hover]:shadow',
    ])
    expect(
      classes([
        { css: 'box-shadow: 0 0 0 2px currentcolor' },
        { selector: '&:hover', css: `box-shadow: ${shadow}` },
      ]),
    ).toEqual([
      'ring-2',
      `[&:hover]:[box-shadow:${shadow.replaceAll(', ', ',').replaceAll(' ', '_')}]`,
    ])
  })

  it('leaves blocks whose context has no class unconverted (TFC303)', () => {
    const result = run([
      { css: 'color: #fff' },
      { selector: '&[data-x="a`b"]', css: 'color: #000' },
    ])
    expect(result.chains[1]).toEqual({ code: 'TFC303' })
    expect(result.classes).toEqual(['text-white'])
    expect(result.verified.issues).toEqual([])
  })
})

describe('custom theme', () => {
  const { classes } = pipelineFor('custom-theme')

  it('uses the custom breakpoints and colors', () => {
    expect(
      classes([{ conditions: ['@media (min-width: 640px)'], css: 'background-color: #123456' }]),
    ).toEqual(['sm:bg-brand'])
    expect(
      classes([{ selector: '&:hover', conditions: [HOVER_MEDIA], css: 'padding: 12px' }]),
    ).toEqual(['hover:p-1.5'])
  })
})

describe('custom variants', () => {
  const { classes } = pipelineFor('custom-variant')

  it('uses the custom variants', () => {
    expect(classes([{ selector: '&:where(.dark, .dark *)', css: 'color: #fff' }])).toEqual([
      'dark:text-white',
    ])
    expect(classes([{ conditions: ['@media (pointer: fine)'], css: 'padding: 16px' }])).toEqual([
      'fine-pointer:p-4',
    ])
    expect(
      classes([{ conditions: ['@media (prefers-color-scheme: dark)'], css: 'color: #fff' }]),
    ).toEqual(['[@media(prefers-color-scheme:dark)]:text-white'])
  })
})

describe('prefix(tw)', () => {
  const { classes } = pipelineFor('prefix')

  it('puts the prefix before the variants', () => {
    expect(
      classes([
        { css: 'color: #123456' },
        { selector: '&:hover', conditions: [HOVER_MEDIA], css: 'padding: 13px !important' },
        { selector: '&:focus', css: 'color: #ef4444' },
      ]),
    ).toEqual(['tw:text-brand', 'tw:hover:p-3.25!', 'tw:focus:text-[#ef4444]'])
  })
})
