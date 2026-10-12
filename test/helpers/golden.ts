import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ConverterOptions } from '../../src/types.ts'
import { FIXTURES, REPO_ROOT, type TailwindFixture } from './design-system.ts'

export const GOLDEN: string = resolve(REPO_ROOT, 'test', 'golden')
export const INPUT = '.input.json'
export const STYLESHEET = '.css'

interface SuiteConfig {
  /** Converter options; `tailwind.base` is relative to the suite directory. */
  readonly options?: ConverterOptions
  /** Loads `test/fixtures/tailwind/<fixture>/tailwind.css`, then `css`. */
  readonly fixture?: TailwindFixture
  /** Entry CSS, or CSS added after the fixture's. */
  readonly css?: string
  /** Directory `css` resolves from, relative to the suite directory. */
  readonly base?: string
}

/** Converter options of a golden suite, from its optional `_config.json`. */
export function suiteOptions(suite: string): ConverterOptions {
  const path = resolve(GOLDEN, suite, '_config.json')
  const config: SuiteConfig = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  const options = config.options ?? {}
  if (config.fixture === undefined) {
    if (config.css === undefined) return options
    return {
      ...options,
      tailwind: { css: config.css, base: resolve(GOLDEN, suite, config.base ?? '.') },
    }
  }
  return {
    ...options,
    tailwind: {
      css: `@import "./tailwind.css";\n${config.css ?? ''}`,
      base: resolve(FIXTURES, 'tailwind', config.fixture),
    },
  }
}

/** Suite directories, sorted. */
export const goldenSuites = (): string[] =>
  readdirSync(GOLDEN, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

/** Case names of a suite with the given input extension, sorted. */
export const goldenCases = (suite: string, extension: string): string[] =>
  readdirSync(resolve(GOLDEN, suite))
    .filter((file) => file.endsWith(extension))
    .map((file) => file.slice(0, -extension.length))
    .sort()
