const DATA_SCHEME = /^data:/i

export const isDataUrl = (url: string): boolean => DATA_SCHEME.test(url)

// N44: the data URL processor percent-decodes the body (after the first comma), so a space
// there is `%20`. The media type before it isn't decoded, and its spaces matter (`; base64`).
export function percentEncodeDataUrlSpaces(url: string): string {
  const comma = url.indexOf(',')
  if (comma === -1 || !isDataUrl(url)) return url
  return url.slice(0, comma + 1) + url.slice(comma + 1).replaceAll(' ', '%20')
}
