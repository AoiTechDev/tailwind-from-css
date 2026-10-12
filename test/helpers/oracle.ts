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

/** An entry stylesheet and the directory its imports resolve from. */
interface Entry {
  readonly css: string
  readonly base: string
}

const DEFAULT_ENTRY: Entry = { css: '@import "tailwindcss";', base: REPO_ROOT }
const oracles = new Map<string, Promise<Canonicalize>>()

/**
 * Tailwind's own `canonicalizeCandidates` on the default theme, or on `entry`. A test oracle
 * only: the library never calls it.
 */
export function canonicalizer(entry: Entry = DEFAULT_ENTRY): Promise<Canonicalize> {
  const key = JSON.stringify([entry.css, entry.base])
  let oracle = oracles.get(key)
  if (oracle === undefined) {
    oracle = __unstable__loadDesignSystem(entry.css, {
      base: entry.base,
      loadStylesheet,
      loadModule: loadModule as never,
    }).then((design) => design.canonicalizeCandidates.bind(design))
    oracles.set(key, oracle)
  }
  return oracle
}
