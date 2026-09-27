/**
 * Custom request headers for the AI platform, typed by the user one per line
 * as `Name: Value`. Some gateways need more than the Bearer key (OpenRouter's
 * `X-Title`, Azure's `api-key`, Cloudflare AI Gateway's `cf-aig-authorization`…).
 *
 * Shared by main, which sends them, and the renderer, which points out the
 * lines that will be ignored — so both agree on what a valid line is.
 */

/** RFC 9110 token: what a header name may contain */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/**
 * `fetch` rejects values outside Latin-1 (e.g. Chinese) with an obscure
 * ByteString error, so such a line is flagged here instead of failing the request
 */
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/

export interface ParsedRequestHeaders {
  headers: Record<string, string>
  /** 1-based numbers of the non-blank lines that were skipped */
  invalidLines: number[]
}

export function parseRequestHeaders(text: string | undefined): ParsedRequestHeaders {
  const headers: Record<string, string> = {}
  const invalidLines: number[] = []
  ;(text ?? '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    if (!line) return
    const colon = line.indexOf(':')
    const name = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (colon <= 0 || !HEADER_NAME.test(name) || !HEADER_VALUE.test(value)) {
      invalidLines.push(index + 1)
      return
    }
    setHeader(headers, name, value)
  })
  return { headers, invalidLines }
}

/**
 * Everything a request to the platform carries: the Bearer key, with the
 * custom headers on top so they can also replace it (e.g. `Authorization`).
 */
export function buildRequestHeaders(apiKey: string, text: string | undefined) {
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  for (const [name, value] of Object.entries(parseRequestHeaders(text).headers)) {
    setHeader(headers, name, value)
  }
  return headers
}

/**
 * Header names are case-insensitive, but a plain object is not: `authorization`
 * next to `Authorization` would reach the server as both values joined by a
 * comma. Replace in place, keeping the first spelling — the AI SDK spreads
 * these over its own `Authorization`, so that is the key that must be hit.
 */
function setHeader(headers: Record<string, string>, name: string, value: string) {
  const existing = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())
  headers[existing ?? name] = value
}
