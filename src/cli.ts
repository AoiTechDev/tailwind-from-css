#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { createConverter } from './converter.ts'
import { TfcError } from './errors.ts'
import { RELAXATION_NAMES, resolveOptions } from './options.ts'
import type {
  ConverterOptions,
  CssConversionResult,
  Diagnostic,
  ResolvedOptions,
  SourceRef,
  UnconvertedDeclaration,
} from './types.ts'

const OK = 0
const RUNTIME_ERROR = 1
const USAGE_ERROR = 2
const UNCONVERTED = 3

const USAGE = `Usage: tailwind-from-css [file|-] [options]

Converts a stylesheet to Tailwind CSS v4 classes, one "subject { classes }" line per rule.
Reads stdin when no file is given or the file is "-". Unconverted declarations and
diagnostics go to stderr.

Options:
  --mode exact|nearest          relaxation preset (default: exact)
  --relax a,b,!c                add relaxations to the preset, or remove them with "!"
  --theme <file.css>            your Tailwind entry stylesheet (default: @import "tailwindcss")
  --root-font-size <n|false>    px per rem; false keeps px and rem apart (default: 16)
  --format text|json            output format (default: text)
  --fail-on-unconverted         exit with 3 when anything is unconverted
  --print-config                print the resolved options and exit
  --version                     print the version
  --help                        print this help

Relaxations:
  ${RELAXATION_NAMES.join('\n  ')}

Exit codes:
  0 ok, 1 Tailwind could not be loaded (TFC901-TFC903), 2 usage error,
  3 something is unconverted (with --fail-on-unconverted)
`

const ARGS = {
  mode: { type: 'string' },
  relax: { type: 'string', multiple: true },
  theme: { type: 'string' },
  'root-font-size': { type: 'string' },
  format: { type: 'string', default: 'text' },
  'fail-on-unconverted': { type: 'boolean' },
  'print-config': { type: 'boolean' },
  version: { type: 'boolean' },
  help: { type: 'boolean' },
} as const

type Values = ReturnType<typeof parseArgs<{ options: typeof ARGS }>>['values']

function readVersion(): string {
  const packageJson: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  return (packageJson as { version: string }).version
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function usageError(message: string): number {
  process.stderr.write(`tailwind-from-css: ${message}\nRun "tailwind-from-css --help" for usage.\n`)
  return USAGE_ERROR
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding('utf8')
  let text = ''
  for await (const chunk of process.stdin) text += chunk as string
  return text
}

/** The flags as `ConverterOptions`, still unvalidated: `resolveOptions` checks the values. */
function converterOptions(
  values: Values,
  tailwind: { css: string; base: string } | undefined,
): Record<string, unknown> {
  const options: Record<string, unknown> = {}
  if (values.mode !== undefined) options.mode = values.mode
  if (values.relax !== undefined) {
    options.relax = values.relax
      .flatMap((list) => list.split(','))
      .map((name) => name.trim())
      .filter((name) => name !== '')
  }
  if (tailwind !== undefined) options.tailwind = tailwind
  const rootFontSize = values['root-font-size']
  if (rootFontSize !== undefined) {
    options.rootFontSize = rootFontSize === 'false' ? false : Number(rootFontSize)
  }
  return options
}

function formatRules(result: CssConversionResult): string {
  const parts: string[] = []
  if (result.rules.length > 0) {
    const blocks = result.rules.map(({ subject, result: { className } }) =>
      className === '' ? `${subject} {}` : `${subject} { ${className} }`,
    )
    parts.push(`${blocks.join('\n')}\n`)
  }
  if (result.passthroughCss !== '') {
    parts.push(
      result.passthroughCss.endsWith('\n') ? result.passthroughCss : `${result.passthroughCss}\n`,
    )
  }
  return parts.join('\n')
}

const locationOf = (name: string, source: SourceRef | undefined): string =>
  [name, source?.line, source?.column].filter((part) => part !== undefined).join(':')

const sourceKey = (code: string, source: SourceRef): string =>
  `${code} ${source.line}:${source.column} ${source.property}`

const unconvertedLine = (name: string, item: UnconvertedDeclaration): string =>
  `${locationOf(name, item)}: unconverted ${item.code}: ${item.property}: ${item.value}${item.important ? ' !important' : ''}`

const diagnosticLine = (name: string, diagnostic: Diagnostic): string =>
  `${locationOf(name, diagnostic.source)}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`

interface ReportLine {
  readonly source: SourceRef | undefined
  readonly text: string
}

const byPosition = (a: ReportLine, b: ReportLine): number =>
  (a.source?.line ?? Number.POSITIVE_INFINITY) - (b.source?.line ?? Number.POSITIVE_INFINITY) ||
  (a.source?.column ?? 0) - (b.source?.column ?? 0)

/**
 * Each rule's unconverted declarations and diagnostics in source order, then the stylesheet's
 * diagnostics. An unconverted declaration replaces the diagnostic that reports it.
 */
function formatReport(result: CssConversionResult, name: string): string {
  const lines: string[] = []
  for (const { result: rule } of result.rules) {
    const reported = new Set(rule.unconverted.map((item) => sourceKey(item.code, item)))
    const ruleLines: ReportLine[] = rule.unconverted.map((item) => ({
      source: item,
      text: unconvertedLine(name, item),
    }))
    for (const diagnostic of rule.diagnostics) {
      const { source } = diagnostic
      if (source !== undefined && reported.has(sourceKey(diagnostic.code, source))) continue
      ruleLines.push({ source, text: diagnosticLine(name, diagnostic) })
    }
    lines.push(...ruleLines.sort(byPosition).map((line) => line.text))
  }
  for (const diagnostic of result.diagnostics) lines.push(diagnosticLine(name, diagnostic))
  return lines.map((line) => `${line}\n`).join('')
}

async function main(argv: string[]): Promise<number> {
  let parsed: { values: Values; positionals: string[] }
  try {
    parsed = parseArgs({ args: argv, options: ARGS, allowPositionals: true, strict: true })
  } catch (error) {
    return usageError(messageOf(error))
  }
  const { values, positionals } = parsed
  if (values.help) {
    process.stdout.write(USAGE)
    return OK
  }
  if (values.version) {
    process.stdout.write(`${readVersion()}\n`)
    return OK
  }
  if (positionals.length > 1) {
    return usageError(`expected one input file, got ${positionals.length}`)
  }
  if (values.format !== 'text' && values.format !== 'json') {
    return usageError(`--format must be text or json, got "${values.format}"`)
  }

  let tailwind: { css: string; base: string } | undefined
  if (values.theme !== undefined) {
    try {
      tailwind = { css: readFileSync(values.theme, 'utf8'), base: dirname(resolve(values.theme)) }
    } catch (error) {
      return usageError(`can't read the theme ${values.theme}: ${messageOf(error)}`)
    }
  }
  const given = converterOptions(values, tailwind)
  let resolved: ResolvedOptions
  try {
    resolved = resolveOptions(given, { base: process.cwd() })
  } catch (error) {
    // Every option comes from a flag, so an invalid one (TFC904) is a usage error.
    if (error instanceof TfcError) return usageError(error.message)
    throw error
  }
  if (values['print-config']) {
    process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`)
    return OK
  }

  const file = positionals[0] ?? '-'
  if (file === '-' && process.stdin.isTTY) {
    return usageError('no input: pass a file, or pipe a stylesheet to stdin')
  }
  let css: string
  try {
    css = file === '-' ? await readStdin() : readFileSync(file, 'utf8')
  } catch (error) {
    return usageError(`can't read ${file}: ${messageOf(error)}`)
  }

  let result: CssConversionResult
  try {
    result = (await createConverter(given as ConverterOptions)).convertCss(css)
  } catch (error) {
    if (!(error instanceof TfcError)) throw error
    process.stderr.write(`tailwind-from-css: ${error.message}\nSee ${error.docsUrl}\n`)
    return RUNTIME_ERROR
  }

  if (values.format === 'json') {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(formatRules(result))
    process.stderr.write(formatReport(result, file === '-' ? '<stdin>' : file))
  }
  const unconverted = result.rules.some((rule) => rule.result.unconverted.length > 0)
  return values['fail-on-unconverted'] && unconverted ? UNCONVERTED : OK
}

// A reader that stops early (`| head`) closes the pipe; that ends the output, it isn't a crash.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') throw error
    process.exit(process.exitCode ?? OK)
  })
}

process.exitCode = await main(process.argv.slice(2))
