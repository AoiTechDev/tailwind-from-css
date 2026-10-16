import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SEVERITIES } from '../../src/diagnostics.ts'
import { TfcError } from '../../src/errors.ts'
import type { TfcErrorCode } from '../../src/types.ts'

// A Record so the type checker fails when TfcErrorCode gains or loses a code.
const ERROR_CODES: Record<TfcErrorCode, true> = {
  TFC901: true,
  TFC902: true,
  TFC903: true,
  TFC904: true,
}

const DOC = readFileSync(resolve(import.meta.dirname, '..', '..', 'docs', 'errors.md'), 'utf8')
const CODES = [...Object.keys(SEVERITIES), ...Object.keys(ERROR_CODES)].sort()

// GitHub's heading anchors: lowercase, punctuation dropped, spaces as hyphens.
const anchorOf = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replaceAll(' ', '-')

interface Section {
  anchor: string
  body: string
}

function sections(markdown: string): Section[] {
  const withoutFences = markdown.replace(/^```[\s\S]*?^```$/gm, (fence) =>
    fence.replace(/^#/gm, ' '),
  )
  const parts = withoutFences.split(/^#{2,3} (.+)$/m)
  const found: Section[] = []
  for (let index = 1; index < parts.length; index += 2) {
    found.push({ anchor: anchorOf(parts[index] ?? ''), body: parts[index + 1] ?? '' })
  }
  return found
}

describe('docs/errors.md', () => {
  const byAnchor = new Map(sections(DOC).map((section) => [section.anchor, section]))

  it('has one heading per diagnostic and error code, and none for unknown codes', () => {
    const codeAnchors = [...byAnchor.keys()].filter((anchor) => /^tfc\d/.test(anchor)).sort()
    expect(codeAnchors).toEqual(CODES.map((code) => code.toLowerCase()))
  })

  it('has no duplicate headings', () => {
    expect(byAnchor.size).toBe(sections(DOC).length)
  })

  it('gives every code an example', () => {
    const withoutExample = CODES.filter(
      (code) => !byAnchor.get(code.toLowerCase())?.body.includes('```'),
    )
    expect(withoutExample).toEqual([])
  })

  it.each(Object.keys(ERROR_CODES) as TfcErrorCode[])('is where TfcError %s links', (code) => {
    const { docsUrl } = new TfcError(code, 'probe')
    expect(docsUrl).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/main\/docs\/errors\.md#/)
    expect(byAnchor.has(docsUrl.slice(docsUrl.indexOf('#') + 1))).toBe(true)
  })
})
