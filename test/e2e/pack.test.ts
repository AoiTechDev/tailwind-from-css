import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..', '..')
const MAX_UNPACKED_BYTES = 250_000
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare']

interface PackResult {
  filename: string
  unpackedSize: number
  files: { path: string }[]
}

const run = (command: string, args: string[], cwd: string): string =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// npm is a .cmd shim on Windows, which execFile can only start through cmd.exe; quoting keeps
// cmd from treating the ^ of a semver range as its escape character.
const IS_WINDOWS = process.platform === 'win32'
const npm = (args: string[], cwd: string): string =>
  execFileSync('npm', IS_WINDOWS ? args.map((arg) => `"${arg}"`) : args, {
    cwd,
    encoding: 'utf8',
    shell: IS_WINDOWS,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

function pack(args: string[]): PackResult {
  const [result] = JSON.parse(npm(['pack', '--json', ...args], ROOT)) as PackResult[]
  if (result === undefined) throw new Error('npm pack returned nothing')
  return result
}

beforeAll(() => {
  if (!existsSync(join(ROOT, 'dist', 'index.js'))) {
    throw new Error('dist/ is missing. Run `pnpm build` before the e2e tests.')
  }
})

describe('packed tarball', () => {
  const dryRun = (): PackResult => pack(['--dry-run'])

  it('contains only dist, README, LICENSE, CHANGELOG and package.json', () => {
    const paths = dryRun().files.map((file) => file.path)
    const allowed = new Set(['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md'])
    expect(paths.filter((path) => !path.startsWith('dist/') && !allowed.has(path))).toEqual([])
    expect(paths).toEqual(
      expect.arrayContaining([
        'package.json',
        'README.md',
        'LICENSE',
        'dist/index.js',
        'dist/index.d.ts',
        'dist/cli.js',
      ]),
    )
  })

  it(`stays within ${MAX_UNPACKED_BYTES} bytes unpacked`, () => {
    expect(dryRun().unpackedSize).toBeLessThanOrEqual(MAX_UNPACKED_BYTES)
  })

  it('has no install scripts', () => {
    const { scripts = {} } = readJson<{ scripts?: Record<string, string> }>(
      join(ROOT, 'package.json'),
    )
    expect(Object.keys(scripts).filter((name) => INSTALL_SCRIPTS.includes(name))).toEqual([])
  })

  it('ships the CLI with a shebang', () => {
    expect(readFileSync(join(ROOT, 'dist', 'cli.js'), 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/)
  })
})

// Installs from the registry, so it runs on CI (and locally with CI=1).
describe.runIf(process.env.CI)('installed tarball', () => {
  let project = ''

  beforeAll(() => {
    project = mkdtempSync(join(tmpdir(), 'tfc-pack-'))
    const { filename } = pack(['--pack-destination', project])
    const { peerDependencies } = readJson<{ peerDependencies: { tailwindcss: string } }>(
      join(ROOT, 'package.json'),
    )
    writeFileSync(join(project, 'package.json'), '{ "name": "tfc-pack-test", "private": true }\n')
    npm(
      [
        'install',
        '--no-audit',
        '--no-fund',
        `./${filename}`,
        `tailwindcss@${peerDependencies.tailwindcss}`,
      ],
      project,
    )
  })

  afterAll(() => {
    if (project) rmSync(project, { recursive: true, force: true })
  })

  const probe = "x.TfcError && new x.TfcError('TFC904', 'probe').code"

  it('can be imported', () => {
    const script = `import('tailwind-from-css').then((x) => console.log(${probe}))`
    expect(run(process.execPath, ['-e', script], project).trim()).toBe('TFC904')
  })

  it('can be required', () => {
    const script = `const x = require('tailwind-from-css'); console.log(${probe})`
    expect(run(process.execPath, ['-e', script], project).trim()).toBe('TFC904')
  })

  it('runs the CLI', () => {
    const cli = join(project, 'node_modules', 'tailwind-from-css', 'dist', 'cli.js')
    const { version } = readJson<{ version: string }>(join(ROOT, 'package.json'))
    expect(run(process.execPath, [cli, '--version'], project).trim()).toBe(version)
  })
})
