import type { TfcErrorCode } from './types.ts'

const DOCS_URL = 'https://github.com/AoiTechDev/tailwind-from-css/blob/main/docs/errors.md'

/**
 * The only error this package throws. It signals an environment or usage problem
 * (Tailwind missing or unsupported, entry CSS failing to load, invalid options), never a
 * problem in the CSS being converted: those become diagnostics.
 *
 * @example
 * ```ts
 * try {
 *   await createConverter({ mode: 'fast' as never })
 * } catch (error) {
 *   if (error instanceof TfcError && error.code === 'TFC904') console.error(error.docsUrl)
 * }
 * ```
 */
export class TfcError extends Error {
  /** Stable error code, e.g. `'TFC904'`. */
  readonly code: TfcErrorCode
  /** Link to the documentation of this code. */
  readonly docsUrl: string

  constructor(code: TfcErrorCode, message: string, options?: { cause?: unknown }) {
    super(`${code}: ${message}`, options)
    this.name = 'TfcError'
    this.code = code
    this.docsUrl = `${DOCS_URL}#${code.toLowerCase()}`
  }
}
