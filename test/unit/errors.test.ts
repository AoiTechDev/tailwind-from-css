import { describe, expect, it } from 'vitest'
import { TfcError } from '../../src/errors.ts'

describe('TfcError', () => {
  it('carries the code and a docs anchor for it', () => {
    const error = new TfcError('TFC904', 'unknown option "foo"')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('TfcError')
    expect(error.code).toBe('TFC904')
    expect(error.docsUrl).toBe(
      'https://github.com/AoiTechDev/tailwind-from-css/blob/main/docs/errors.md#tfc904',
    )
  })

  it('keeps the cause', () => {
    const cause = new Error('ENOENT')
    expect(new TfcError('TFC903', 'entry CSS failed to load', { cause }).cause).toBe(cause)
  })

  it('names the code in the message', () => {
    expect(new TfcError('TFC901', 'tailwindcss is not installed').message).toMatch(/^TFC901\b/)
  })
})
