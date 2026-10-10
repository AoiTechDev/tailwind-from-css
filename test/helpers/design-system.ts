import { resolve } from 'node:path'
import { loadDesignSystem, type TailwindDesignSystem } from '../../src/tailwind/adapter.ts'
import { loadModule, loadStylesheet } from '../../src/tailwind/loader.ts'

export const REPO_ROOT: string = resolve(import.meta.dirname, '..', '..')
export const FIXTURES: string = resolve(REPO_ROOT, 'test', 'fixtures')

/** Entry stylesheets in `test/fixtures/tailwind/<name>/tailwind.css`. */
export type TailwindFixture =
  | 'custom-theme'
  | 'prefix'
  | 'plugin-esm'
  | 'plugin-cjs'
  | 'custom-variant'
  | 'utility'

/** Loads `css` with the real Tailwind and the Node loader. Not cached. */
export function loadEntry(css: string, base: string = REPO_ROOT): Promise<TailwindDesignSystem> {
  return loadDesignSystem(css, { base, loadStylesheet, loadModule })
}

const cache = new Map<string, Promise<TailwindDesignSystem>>()

/** Shared design system: the default theme, or a fixture entry. Cached per test file. */
export function designSystem(fixture?: TailwindFixture): Promise<TailwindDesignSystem> {
  const key = fixture ?? 'default'
  let loading = cache.get(key)
  if (!loading) {
    loading =
      fixture === undefined
        ? loadEntry('@import "tailwindcss";')
        : loadEntry('@import "./tailwind.css";', resolve(FIXTURES, 'tailwind', fixture))
    cache.set(key, loading)
  }
  return loading
}
