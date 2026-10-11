import { toDeclarations } from '../../src/css/declarations.ts'
import { createMatcher, matchDeclarations, matchInput } from '../../src/match/exact.ts'
import {
  createVariantResolver,
  type VariantResult,
  variantChain,
} from '../../src/match/variants.ts'
import { type VerifyBlock, type VerifyResult, verify } from '../../src/match/verify.ts'
import type { TailwindDesignSystem } from '../../src/tailwind/adapter.ts'
import { buildUtilityIndex } from '../../src/tailwind/index-builder.ts'

/** One block of an element: declarations as CSS text, in a context. */
export interface BlockInput {
  readonly css: string
  readonly selector?: string
  readonly conditions?: readonly string[]
}

/** What the pipeline made of an element's blocks. */
export interface PipelineResult {
  readonly chains: readonly VariantResult[]
  readonly verified: VerifyResult
  /** Every class, in Tailwind's order. */
  readonly classes: readonly string[]
}

const OPTIONS = { rootFontSize: 16 } as const

/**
 * Context → variants → match → verify for the blocks of one element, as the converter will run
 * them (SPEC §5.3–§5.7). A block whose context has no chain (`TFC303`) gets no classes.
 */
export function createPipeline(
  design: TailwindDesignSystem,
  important: 'suffix' | 'prefix' = 'suffix',
): (blocks: readonly BlockInput[]) => PipelineResult {
  const index = buildUtilityIndex(design, OPTIONS)
  const matcher = createMatcher(design, index, { important })
  const resolver = createVariantResolver(design, index)
  return (blocks) => {
    const chains: VariantResult[] = []
    const verifyBlocks: VerifyBlock[] = blocks.map((block) => {
      const context = { selector: block.selector ?? '&', conditions: [...(block.conditions ?? [])] }
      const declarations = matchInput(toDeclarations(block.css).declarations, OPTIONS)
      const chain = variantChain(
        resolver,
        context,
        new Set(declarations.map((declaration) => declaration.property)),
      )
      chains.push(chain)
      const variants = 'code' in chain ? undefined : chain.variants
      const matches =
        variants === undefined ? [] : matchDeclarations(matcher, declarations, variants).matches
      return { context, variants: variants ?? [], declarations, matches }
    })
    const verified = verify(matcher, verifyBlocks)
    const names = verified.matches.flat().map((match) => match.className)
    const orders = design.classOrder(names)
    const classes = names
      .map((name, position) => ({ name, order: orders[position] ?? -1n }))
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.name < b.name ? -1 : 1))
      .map((entry) => entry.name)
    return { chains, verified, classes }
  }
}
