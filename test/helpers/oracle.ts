import { __unstable__loadDesignSystem } from 'tailwindcss'
import { loadModule, loadStylesheet } from '../../src/tailwind/loader.ts'
import { REPO_ROOT } from './design-system.ts'

/** Options of Tailwind's `canonicalizeCandidates`. */
export interface CanonicalizeOptions {
  rem?: number
  collapse?: boolean
  logicalToPhysical?: boolean
}

type Canonicalize = (candidates: string[], options?: CanonicalizeOptions) => string[]

let oracle: Promise<Canonicalize> | undefined

/**
 * Tailwind's own `canonicalizeCandidates` on the default theme. A test oracle only: the library
 * never calls it.
 */
export function canonicalizer(): Promise<Canonicalize> {
  oracle ??= __unstable__loadDesignSystem('@import "tailwindcss";', {
    base: REPO_ROOT,
    loadStylesheet,
    loadModule: loadModule as never,
  }).then((design) => design.canonicalizeCandidates.bind(design))
  return oracle
}
