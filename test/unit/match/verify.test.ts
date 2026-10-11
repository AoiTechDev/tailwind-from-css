// SPEC §5.7 on a hand-written design system: what verify accepts, replaces and gives up on.
import { describe, expect, it } from 'vitest'
import {
  createMatcher,
  type Match,
  type MatchDeclaration,
  matchInput,
} from '../../../src/match/exact.ts'
import { type VerifyBlock, verify } from '../../../src/match/verify.ts'
import type { CandidateAst } from '../../../src/tailwind/adapter.ts'
import { buildUtilityIndex } from '../../../src/tailwind/index-builder.ts'
import type { Declaration } from '../../../src/types.ts'
import { ast, type FakeDesignInput, fakeDesign, property, rule } from '../../helpers/fake-design.ts'

const OPTIONS = { rootFontSize: 16 } as const

const escapeClass = (className: string): string =>
  className.replaceAll(/[^\w-]/g, (char) => `\\${char}`)

/** A class compiled to one rule: `.class` + `suffix` (`:hover`), with `declarations`. */
const compiled = (
  className: string,
  declarations: string[],
  suffix = '',
  conditions: string[] = [],
  properties = [] as ReturnType<typeof property>[],
): CandidateAst =>
  ast([rule(`.${escapeClass(className)}${suffix}`, declarations, conditions)], properties)

const TRANSLATE = 'translate: var(--tw-tx) var(--tw-ty)'
const TRANSLATE_VARIABLES = [property('--tw-tx', '0'), property('--tw-ty', '0')]

const input: FakeDesignInput = {
  candidates: {
    'p-4': compiled('p-4', ['padding: 16px']),
    'text-red': compiled('text-red', ['color: red']),
    'text-red-loud': compiled('text-red-loud', ['color: red', 'font-weight: 700']),
    '[padding-top:13px]': compiled('[padding-top:13px]', ['padding-top: 13px']),
    '[padding-right:13px]': compiled('[padding-right:13px]', ['padding-right: 13px']),
    '[padding-bottom:13px]': compiled('[padding-bottom:13px]', ['padding-bottom: 13px']),
    '[padding-left:13px]': compiled('[padding-left:13px]', ['padding-left: 13px']),
    '[color:red]': compiled('[color:red]', ['color: red']),
    '[color:blue]': compiled('[color:blue]', ['color: red']),
    'tx-1': compiled('tx-1', ['--tw-tx: 4px', TRANSLATE], '', [], TRANSLATE_VARIABLES),
    '[&:hover]:ty-1': compiled(
      '[&:hover]:ty-1',
      ['--tw-ty: 4px', TRANSLATE],
      ':hover',
      [],
      TRANSLATE_VARIABLES,
    ),
    '[&:hover]:[translate:0_4px]': compiled(
      '[&:hover]:[translate:0_4px]',
      ['translate: 0 4px'],
      ':hover',
    ),
    'md:text-red': compiled('md:text-red', ['color: red'], '', ['@media (width >= 768px)']),
    'md:[color:red]': compiled('md:[color:red]', ['color: red'], '', ['@media (width >= 768px)']),
    'tw-prefixed!': compiled('tw-prefixed!', ['color: red!']),
  },
}

const design = fakeDesign(input)
const matcher = createMatcher(design, buildUtilityIndex(design, OPTIONS), { important: 'suffix' })

function block(
  declarations: Declaration[],
  matches: Match[],
  selector = '&',
  variants: string[] = [],
): VerifyBlock {
  return {
    context: { selector, conditions: [] },
    variants,
    declarations: matchInput(declarations, OPTIONS),
    matches,
  }
}

const match = (className: string, declarations: number[]): Match => ({
  className,
  kind: 'named',
  declarations,
})

const names = (matches: readonly Match[]): string[] => matches.map((entry) => entry.className)

describe('verify', () => {
  it('accepts classes whose effective declarations equal the block', () => {
    const blocks = [block([{ property: 'color', value: 'red' }], [match('text-red', [0])])]
    expect(verify(matcher, blocks)).toEqual({ matches: [blocks[0]?.matches], issues: [] })
  })

  it('replaces a class with a wrong value by arbitrary properties (TFC501)', () => {
    const result = verify(matcher, [
      block([{ property: 'padding', value: '13px' }], [match('p-4', [0, 1, 2, 3])]),
    ])
    expect(names(result.matches[0] ?? [])).toEqual([
      '[padding-bottom:13px]',
      '[padding-left:13px]',
      '[padding-right:13px]',
      '[padding-top:13px]',
    ])
    expect(result.matches[0]?.every((entry) => entry.kind === 'arbitrary-property')).toBe(true)
    expect(result.issues).toEqual(
      [0, 1, 2, 3].map((declaration) => ({ block: 0, declaration, code: 'TFC501' })),
    )
  })

  it('replaces every class of a block that sets more than the block (TFC501)', () => {
    const result = verify(matcher, [
      block([{ property: 'color', value: 'red' }], [match('text-red-loud', [0])]),
    ])
    expect(names(result.matches[0] ?? [])).toEqual(['[color:red]'])
    expect(result.issues).toEqual([{ block: 0, declaration: 0, code: 'TFC501' }])
  })

  it('gives up on a declaration whose arbitrary property is wrong too (TFC502)', () => {
    const wrong = verify(matcher, [
      block([{ property: 'color', value: 'blue' }], [match('text-red', [0])]),
    ])
    expect(wrong.matches).toEqual([[]])
    expect(wrong.issues).toEqual([
      { block: 0, declaration: 0, code: 'TFC501' },
      { block: 0, declaration: 0, code: 'TFC502' },
    ])
    const unencodable = verify(matcher, [
      block([{ property: 'color', value: 'a`b' }], [match('text-red', [0])]),
    ])
    expect(unencodable.matches).toEqual([[]])
    expect(unencodable.issues.map((issue) => issue.code)).toEqual(['TFC501', 'TFC502'])
  })

  it('removes an arbitrary property that is wrong without replacing it', () => {
    const result = verify(matcher, [
      block(
        [{ property: 'color', value: 'blue' }],
        [{ className: '[color:blue]', kind: 'arbitrary-property', declarations: [0] }],
      ),
    ])
    expect(result.matches).toEqual([[]])
    expect(result.issues.map((issue) => issue.code)).toEqual(['TFC501', 'TFC502'])
  })

  it('falls back without TFC501 when only another context makes a block wrong (ADR-0013)', () => {
    const translate = (value: string): Declaration[] => [{ property: 'translate', value }]
    const result = verify(matcher, [
      block(translate('4px 0'), [match('tx-1', [0])]),
      block(translate('0 4px'), [match('[&:hover]:ty-1', [0])], '&:hover', ['[&:hover]']),
    ])
    expect(result.matches.map(names)).toEqual([['tx-1'], ['[&:hover]:[translate:0_4px]']])
    expect(result.issues).toEqual([])
  })

  it('replaces, then removes, classes that land in a context no block has', () => {
    const replaced = verify(matcher, [
      block([{ property: 'color', value: 'red' }], [match('md:text-red', [0])]),
    ])
    expect(replaced.matches.map(names)).toEqual([['[color:red]']])
    expect(replaced.issues.map((issue) => issue.code)).toEqual(['TFC501'])
    // A chain that doesn't produce the block's context can't be repaired.
    const removed = verify(matcher, [
      block([{ property: 'color', value: 'red' }], [match('md:text-red', [0])], '&', ['md']),
    ])
    expect(removed.matches).toEqual([[]])
    expect(removed.issues.map((issue) => issue.code)).toEqual(['TFC501', 'TFC502'])
  })

  it('checks importance', () => {
    const declarations: MatchDeclaration[] = matchInput(
      [{ property: 'color', value: 'red' }],
      OPTIONS,
    )
    const result = verify(matcher, [
      {
        context: { selector: '&', conditions: [] },
        variants: [],
        declarations,
        matches: [match('tw-prefixed!', [0])],
      },
    ])
    expect(names(result.matches[0] ?? [])).toEqual(['[color:red]'])
  })
})
