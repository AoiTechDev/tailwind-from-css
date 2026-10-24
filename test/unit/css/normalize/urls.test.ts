import { describe, expect, it } from 'vitest'
import { normalValue } from '../../../helpers/normalize.ts'

const image = (value: string): string => normalValue('background-image', value)

describe('N44 spaces in data: URLs', () => {
  it('writes a space in the body of a data: URL as %20', () => {
    expect(image(`url("data:image/svg+xml,<svg a='1' b='2'/>")`)).toBe(
      `url("data:image/svg+xml,<svg%20a='1'%20b='2'/>")`,
    )
    expect(image(`url("data:image/svg+xml,<svg a='1' b='2'/>")`)).toBe(
      image(`url('data:image/svg+xml,<svg%20a=\\'1\\'%20b=\\'2\\'/>')`),
    )
    expect(image('url("data:,a  b")')).toBe('url("data:,a%20%20b")')
  })

  it('keeps spaces in the media type, before the first comma', () => {
    expect(image('url("data:text/plain;charset=utf-8 ;base64,YQ ==")')).toBe(
      'url("data:text/plain;charset=utf-8 ;base64,YQ%20==")',
    )
    expect(image('url("data:text/plain a")')).toBe('url("data:text/plain a")')
  })

  it('matches the scheme in any case, after trimming and escapes', () => {
    expect(image('url("DATA:,a b")')).toBe('url("DATA:,a%20b")')
    expect(image('url("  data:,a b  ")')).toBe('url("data:,a%20b")')
    expect(image('url("\\64 ata:,a\\ b")')).toBe('url("data:,a%20b")')
  })

  it('leaves other URLs alone', () => {
    expect(image('url("a b.png")')).toBe('url("a b.png")')
    expect(image('url("https://x.test/data:,a b")')).toBe('url("https://x.test/data:,a b")')
    expect(image('url(data:,a)')).toBe('url("data:,a")')
  })

  it('is idempotent', () => {
    const once = image(`url("data:image/svg+xml,<svg a='1'/>")`)
    expect(image(once)).toBe(once)
  })
})
