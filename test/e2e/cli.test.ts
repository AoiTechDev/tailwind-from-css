import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..', '..')
const CLI = join(ROOT, 'dist', 'cli.js')
const BUTTON = 'test/fixtures/cli/button.css'
const UNCONVERTED = 'test/fixtures/cli/unconverted.css'
const THEME = 'test/fixtures/tailwind/custom-theme/tailwind.css'
const MISSING_IMPORT = 'test/fixtures/loader/missing-import.css'

interface Run {
  status: number | null
  stdout: string
  stderr: string
}

function cli(args: string[], input?: string): Run {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input: input ?? '',
  })
  return { status, stdout, stderr }
}

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

const classesOf = (run: Run): string => {
  expect(run.status).toBe(0)
  return run.stdout.trim()
}

type Library = typeof import('../../src/index.ts')
let library: Library

beforeAll(async () => {
  if (!existsSync(CLI)) throw new Error('dist/ is missing. Run `pnpm build` before the e2e tests.')
  library = (await import(pathToFileURL(join(ROOT, 'dist', 'index.js')).href)) as Library
})

const BUTTON_TEXT = [
  '.btn { p-4 text-[#ef4444] [&:hover]:text-black }',
  '',
  '@keyframes spin {',
  '  to {',
  '    rotate: 360deg;',
  '  }',
  '}',
  '',
].join('\n')

describe('--version and --help', () => {
  it('prints the package version', () => {
    const { version } = JSON.parse(read('package.json')) as { version: string }
    const run = cli(['--version'])
    expect(run).toEqual({ status: 0, stdout: `${version}\n`, stderr: '' })
  })

  it('lists every flag and exit code', () => {
    const run = cli(['--help'])
    expect(run.status).toBe(0)
    for (const flag of [
      '--mode',
      '--relax',
      '--theme',
      '--root-font-size',
      '--format',
      '--fail-on-unconverted',
      '--print-config',
      '--version',
      '--help',
    ]) {
      expect(run.stdout).toContain(flag)
    }
    expect(run.stdout).toContain('hover-media')
    expect(run.stderr).toBe('')
  })
})

describe('input', () => {
  it('reads a file: one block per rule, then the passthrough CSS', () => {
    const run = cli([BUTTON])
    expect(run.status).toBe(0)
    expect(run.stdout).toBe(BUTTON_TEXT)
  })

  it('reads stdin when no file is given', () => {
    expect(cli([], read(BUTTON)).stdout).toBe(BUTTON_TEXT)
  })

  it('reads stdin for -', () => {
    expect(cli(['-'], read(BUTTON)).stdout).toBe(BUTTON_TEXT)
  })

  it('prints nothing for an empty stylesheet', () => {
    expect(cli([], '')).toEqual({ status: 0, stdout: '', stderr: '' })
  })

  it('stops quietly when the reader closes the pipe early', async () => {
    const child = spawn(process.execPath, [CLI, 'test/fixtures/perf/stylesheet-1000.css'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    child.stdout.destroy()
    const [code] = (await once(child, 'close')) as [number | null]
    expect(code).toBe(0)
  })
})

describe('--format text', () => {
  it('reports diagnostics on stderr with the file, line and column', () => {
    const { stderr } = cli([BUTTON])
    expect(stderr).toMatch(/^test\/fixtures\/cli\/button\.css:3:3: info TFC201: /m)
    expect(stderr).toMatch(/^test\/fixtures\/cli\/button\.css:7:3: info TFC301: /m)
    expect(stderr).toMatch(/^test\/fixtures\/cli\/button\.css: info TFC103: /m)
  })

  it('names stdin <stdin>', () => {
    expect(cli([], read(BUTTON)).stderr).toMatch(/^<stdin>:3:3: info TFC201: /m)
  })

  it('reports unconverted declarations once, without a duplicate diagnostic', () => {
    const run = cli([UNCONVERTED])
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('.card { p-2 }\n')
    expect(run.stderr).toBe('test/fixtures/cli/unconverted.css:3:3: unconverted TFC102: color: \n')
  })

  it('lists a rule’s reports in source order', () => {
    const css =
      '.a {\n  color: #123456;\n  background-image: url("a b.png");\n  width: 13.3px;\n}\n'
    const lines = cli([], css).stderr.trimEnd().split('\n')
    expect(lines.map((line) => /^<stdin>:(\d+:\d+): (\w+ TFC\d+)/.exec(line)?.slice(1))).toEqual([
      ['2:3', 'info TFC201'],
      ['3:3', 'unconverted TFC204'],
      ['4:3', 'info TFC201'],
    ])
  })
})

describe('--format json', () => {
  it('prints the CssConversionResult exactly', async () => {
    const run = cli(['--format', 'json', BUTTON])
    expect(run.status).toBe(0)
    expect(run.stderr).toBe('')
    const expected = await library.convertCss(read(BUTTON))
    expect(JSON.parse(run.stdout)).toEqual(JSON.parse(JSON.stringify(expected)))
  })

  it('applies the options', async () => {
    const css = '.a { font-weight: 650; padding: 17.5px }'
    const run = cli(['--format', 'json', '--mode', 'nearest'], css)
    const expected = await library.convertCss(css, { mode: 'nearest' })
    expect(JSON.parse(run.stdout)).toEqual(JSON.parse(JSON.stringify(expected)))
  })
})

describe('--mode and --relax', () => {
  const css = '.a { font-weight: 650; padding: 17.5px }'

  it('is exact by default', () => {
    expect(classesOf(cli([], css))).toBe('.a { p-[17.5px] font-[650] }')
  })

  it('--mode nearest snaps to the theme', () => {
    expect(classesOf(cli(['--mode', 'nearest'], css))).toBe('.a { p-4.5 font-bold }')
  })

  it('--relax adds a relaxation to the preset', () => {
    expect(classesOf(cli(['--relax', 'font-weight-nearest'], css))).toBe(
      '.a { p-[17.5px] font-bold }',
    )
  })

  it('--relax removes one with !', () => {
    const run = cli(['--mode', 'nearest', '--relax', '!font-weight-nearest,pill-radius'], css)
    expect(classesOf(run)).toBe('.a { p-4.5 font-[650] }')
  })
})

describe('--theme', () => {
  const css = '.brand { color: #123456; padding: 8px }'

  it('uses the default theme without it', () => {
    expect(classesOf(cli([], css))).toBe('.brand { p-2 text-[#123456] }')
  })

  it('converts with the classes of a custom theme', () => {
    expect(classesOf(cli(['--theme', THEME], css))).toBe('.brand { p-1 text-brand }')
  })
})

describe('--root-font-size', () => {
  const css = '.a { padding: 10px; margin: 16px }'

  it('defaults to 16', () => {
    expect(classesOf(cli([], css))).toBe('.a { m-4 p-2.5 }')
  })

  it('takes a number', () => {
    expect(classesOf(cli(['--root-font-size', '10'], css))).toBe('.a { m-[16px] p-4 }')
  })

  it('takes false', () => {
    expect(classesOf(cli(['--root-font-size', 'false'], css))).toBe('.a { m-[16px] p-[10px] }')
  })
})

describe('--print-config', () => {
  it('prints the default resolved options without reading input', () => {
    const run = cli(['--print-config'], '.a { color: red }')
    expect(run.status).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual({
      mode: 'exact',
      relaxations: [],
      tailwind: { css: '@import "tailwindcss";', base: ROOT },
      rootFontSize: 16,
      tolerance: { colorDeltaE: 0.02, lengthPx: 2, lengthRatio: 0.1, breakpointPx: 16 },
      important: 'suffix',
    })
  })

  it('prints the options the flags give', () => {
    const run = cli([
      '--print-config',
      '--mode',
      'nearest',
      '--relax',
      '!pill-radius,!hover-media',
      '--root-font-size',
      'false',
      '--theme',
      THEME,
    ])
    expect(run.status).toBe(0)
    expect(JSON.parse(run.stdout)).toMatchObject({
      mode: 'nearest',
      relaxations: [
        'breakpoint-nearest',
        'color-nearest',
        'font-weight-nearest',
        'length-nearest',
        'logical-properties',
        'text-line-height',
      ],
      tailwind: { css: read(THEME), base: dirname(join(ROOT, THEME)) },
      rootFontSize: false,
    })
  })
})

describe('exit codes', () => {
  it('3 with --fail-on-unconverted when anything is unconverted, after printing', () => {
    const run = cli(['--fail-on-unconverted', UNCONVERTED])
    expect(run.status).toBe(3)
    expect(run.stdout).toBe('.card { p-2 }\n')
    expect(run.stderr).toContain('TFC102')
  })

  it('0 with --fail-on-unconverted when everything converts', () => {
    expect(cli(['--fail-on-unconverted', BUTTON]).status).toBe(0)
  })

  it('1 when the theme fails to load (TFC903)', () => {
    const run = cli(['--theme', MISSING_IMPORT, BUTTON])
    expect(run.status).toBe(1)
    expect(run.stdout).toBe('')
    expect(run.stderr).toMatch(/TFC903/)
  })

  it.each([
    ['an unknown flag', ['--nope']],
    ['a flag without its value', ['--mode']],
    ['an unknown format', ['--format', 'yaml']],
    ['an unknown mode', ['--mode', 'fast']],
    ['an unknown relaxation', ['--relax', 'fast']],
    ['a root font size that is not a number', ['--root-font-size', 'big']],
    ['a root font size of 0', ['--root-font-size', '0']],
    ['two input files', [BUTTON, UNCONVERTED]],
    ['a missing input file', ['test/fixtures/cli/missing.css']],
    ['a missing theme file', ['--theme', 'test/fixtures/cli/missing.css', BUTTON]],
  ])('2 for %s', (_name, args) => {
    const run = cli(args)
    expect(run.status).toBe(2)
    expect(run.stdout).toBe('')
    expect(run.stderr).not.toBe('')
  })
})
