import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKFLOWS = resolve(import.meta.dirname, '..', '..', '.github', 'workflows')
const read = (name: string): string => readFileSync(resolve(WORKFLOWS, name), 'utf8')
const workflows = readdirSync(WORKFLOWS)
  .filter((name) => name.endsWith('.yml'))
  .sort()

describe('workflows', () => {
  it('include ci, release, nightly and tailwind-insiders', () => {
    expect(workflows).toEqual(['ci.yml', 'nightly.yml', 'release.yml', 'tailwind-insiders.yml'])
  })

  it.each(workflows)('%s uses no npm token', (name) => {
    expect(read(name)).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN/)
  })

  it.each(workflows)('%s pins every action to a commit SHA', (name) => {
    const uses = [...read(name).matchAll(/uses:\s*(\S+)/g)].map((match) => match[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const action of uses) expect(action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
  })
})

describe('release.yml', () => {
  const release = read('release.yml')

  it('publishes through npm trusted publishing on a GitHub-hosted runner', () => {
    expect(release).toMatch(/^\s+id-token: write$/m)
    expect(release).toMatch(/^\s+runs-on: ubuntu-latest$/m)
    expect(release).toMatch(/npm install -g npm@\^11\.5\.1/)
    expect(release).toMatch(/publish: pnpm changeset publish/)
  })

  it('checks the package before publishing', () => {
    expect(release).toMatch(/pnpm build && pnpm test && pnpm check:package/)
  })
})
