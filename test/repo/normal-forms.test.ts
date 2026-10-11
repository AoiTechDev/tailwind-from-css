import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

// The normal forms of SPEC §6. A new rule gets an ID there and a `describe('N<ID> …')` block here.
const NORMAL_FORMS = [
  'N01',
  'N02',
  'N03',
  'N10',
  'N11',
  'N12',
  'N13',
  'N14',
  'N15',
  'N16',
  'N20',
  'N21',
  'N22',
  'N23',
  'N30',
  'N31',
  'N32',
  'N33',
  'N40',
  'N41',
  'N42',
  'N43',
  'N50',
]

const TESTS = resolve(import.meta.dirname, '..', 'unit', 'css')
const DESCRIBE = /\bdescribe\(\s*['"`](N\d\d)\b/g

it('has one describe block per normal form, and none for unknown IDs', () => {
  const found = readdirSync(TESTS, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.test.ts'))
    .flatMap((file) => [...readFileSync(resolve(TESTS, file), 'utf8').matchAll(DESCRIBE)])
    .map((match) => match[1])
  expect([...found].sort()).toEqual(NORMAL_FORMS)
})
