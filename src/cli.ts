#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { parseArgs } from 'node:util'

const USAGE = `Usage: tailwind-from-css [file|-] [options]

Options:
  --version   print the version
  --help      print this help
`

function readVersion(): string {
  const packageJson: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  return (packageJson as { version: string }).version
}

function main(argv: string[]): number {
  let values: { version?: boolean; help?: boolean }
  try {
    ;({ values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { version: { type: 'boolean' }, help: { type: 'boolean' } },
    }))
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`)
    return 2
  }
  if (values.version) {
    process.stdout.write(`${readVersion()}\n`)
    return 0
  }
  if (values.help) {
    process.stdout.write(USAGE)
    return 0
  }
  process.stderr.write('tailwind-from-css: conversion is not available in this version yet.\n')
  return 1
}

process.exitCode = main(process.argv.slice(2))
