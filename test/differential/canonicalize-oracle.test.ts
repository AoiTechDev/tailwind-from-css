// ADR-0003, TESTING §2.5: Tailwind's `canonicalizeCandidates` (rem, collapse) as an oracle over
// every golden element. When it returns a shorter equivalent class list than ours (fewer classes,
// or as many in fewer characters), the element must be listed in `known-differences.json`: the
// classes of ours it replaces, what it puts instead, and reason codes explained under `reasons`.
// Entries are keyed `<suite>/<case>` or `<suite>/<case>.css <subject>`. Tailwind's side and
// stale entries are checked only on the pinned Tailwind version, since other versions
// canonicalize differently. Slow (≈ 1 min), so it runs as `pnpm test:differential` and nightly.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createConverter } from '../../src/converter.ts'
import type { Converter, StyleInput } from '../../src/types.ts'
import { REPO_ROOT } from '../helpers/design-system.ts'
import {
  GOLDEN,
  goldenCases,
  goldenSuites,
  INPUT,
  STYLESHEET,
  suiteOptions,
} from '../helpers/golden.ts'
import { canonicalizer } from '../helpers/oracle.ts'

interface KnownDifference {
  /** Our classes that Tailwind replaces, in our order. */
  readonly ours: string
  /** What Tailwind puts instead, in its order. */
  readonly tailwind: string
  /** Keys of `reasons`. */
  readonly reasons: readonly string[]
}

interface KnownDifferences {
  readonly reasons: Readonly<Record<string, string>>
  readonly differences: Readonly<Record<string, KnownDifference>>
}

interface Difference {
  readonly key: string
  readonly ours: string
  readonly tailwind: string
}

const KNOWN: KnownDifferences = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'known-differences.json'), 'utf8'),
)
const PINNED: string = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'))
  .devDependencies.tailwindcss

const shorter = (canonical: readonly string[], ours: readonly string[]): boolean =>
  canonical.length < ours.length ||
  (canonical.length === ours.length && canonical.join(' ').length < ours.join(' ').length)

function elements(converter: Converter, suite: string, name: string): [string, string[]][] {
  if (name.endsWith(STYLESHEET)) {
    const css = readFileSync(resolve(GOLDEN, suite, name), 'utf8')
    return converter
      .convertCss(css)
      .rules.map((rule) => [`${suite}/${name} ${rule.subject}`, [...rule.result.classes]])
  }
  const input: StyleInput | StyleInput[] = JSON.parse(
    readFileSync(resolve(GOLDEN, suite, `${name}${INPUT}`), 'utf8'),
  )
  return [[`${suite}/${name}`, [...converter.convertStyles(input).classes]]]
}

const matched = new Set<string>()
const ran = new Set<string>()
let pinned = true

for (const suite of goldenSuites()) {
  const names = [
    ...goldenCases(suite, INPUT),
    ...goldenCases(suite, STYLESHEET).map((name) => `${name}${STYLESHEET}`),
  ]

  describe(suite, () => {
    let converter: Converter
    let canonicalize: Awaited<ReturnType<typeof canonicalizer>>
    beforeAll(async () => {
      converter = await createConverter(suiteOptions(suite))
      canonicalize = await canonicalizer(converter.options.tailwind)
      pinned &&= converter.tailwindVersion === PINNED
    }, 60_000)

    it.each(names)('%s', (name) => {
      const rem = converter.options.rootFontSize === false ? 16 : converter.options.rootFontSize
      ran.add(`${suite}/${name}`)
      const unlisted: Difference[] = []
      for (const [key, classes] of elements(converter, suite, name)) {
        if (classes.length === 0) continue
        const canonical = canonicalize(classes, { rem, collapse: true })
        if (!shorter(canonical, classes)) continue
        const difference = {
          key,
          ours: classes.filter((className) => !canonical.includes(className)).join(' '),
          tailwind: canonical.filter((className) => !classes.includes(className)).join(' '),
        }
        const known = KNOWN.differences[key]
        const listed =
          known?.ours === difference.ours && (!pinned || known.tailwind === difference.tailwind)
        if (listed) matched.add(key)
        else unlisted.push(difference)
      }
      expect(unlisted).toEqual([])
    })
  })
}

// Runs after the suites above (tests in one file run in order).
describe('known-differences.json', () => {
  it('lists no stale entries for the cases that ran', () => {
    if (!pinned) return
    const stale = Object.keys(KNOWN.differences).filter(
      (key) => ran.has(key.split(' ')[0] as string) && !matched.has(key),
    )
    expect(stale).toEqual([])
  })

  it('explains every entry with known reasons', () => {
    for (const text of Object.values(KNOWN.reasons)) expect(text.trim()).not.toBe('')
    for (const [key, entry] of Object.entries(KNOWN.differences)) {
      expect(entry.reasons.length, key).toBeGreaterThan(0)
      for (const reason of entry.reasons) expect(KNOWN.reasons, key).toHaveProperty(reason)
    }
  })
})
