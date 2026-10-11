import type { Diagnostic, DiagnosticCode, DiagnosticSeverity, SourceRef } from './types.ts'

/** The severity of every diagnostic code (SPEC §7). Codes are public API: never renumber. */
export const SEVERITIES: Readonly<Record<DiagnosticCode, DiagnosticSeverity>> = {
  TFC101: 'error',
  TFC102: 'warning',
  TFC103: 'info',
  TFC104: 'info',
  TFC105: 'info',
  TFC106: 'info',
  TFC201: 'info',
  TFC202: 'info',
  TFC203: 'info',
  TFC204: 'warning',
  TFC301: 'info',
  TFC302: 'info',
  TFC303: 'warning',
  TFC401: 'info',
  TFC402: 'warning',
  TFC501: 'warning',
  TFC502: 'warning',
}

/**
 * A diagnostic with its code's severity.
 *
 * @example
 * diagnostic('TFC106', 'color: red is overridden by color: blue', source)
 */
export function diagnostic(code: DiagnosticCode, message: string, source?: SourceRef): Diagnostic {
  return source === undefined
    ? { code, severity: SEVERITIES[code], message }
    : { code, severity: SEVERITIES[code], message, source }
}
