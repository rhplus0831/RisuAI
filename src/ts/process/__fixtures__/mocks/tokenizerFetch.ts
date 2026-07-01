import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Serves the tokenizer JSON/spiece files normally loaded over HTTP
 * (`fetch('/token/claude/claude.json')` etc.) directly from `public/`.
 *
 * The anthropic-basic fixture pulls in Claude's tokenizer for preflight token
 * math; the fixture vitest env has no static file server, so we shim the fetch.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC_ROOT = resolve(HERE, '../../../../../public')

const cache = new Map<string, ArrayBuffer>()
const LOCAL_TOKENIZER_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0'])

function tokenizerPath(url: string): string | null {
  if (url.startsWith('/token/')) return url
  try {
    const parsed = new URL(url)
    if (LOCAL_TOKENIZER_HOSTS.has(parsed.hostname) && parsed.pathname.startsWith('/token/')) {
      return parsed.pathname
    }
  } catch {
    // Not an absolute URL.
  }
  return null
}

function loadTokenizerFile(urlPath: string): ArrayBuffer {
  const cached = cache.get(urlPath)
  if (cached) return cached
  const absolute = resolve(PUBLIC_ROOT, urlPath.replace(/^\//, ''))
  const buf = readFileSync(absolute)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  cache.set(urlPath, ab)
  return ab
}

export function isTokenizerUrl(url: string): boolean {
  return tokenizerPath(url) !== null
}

export function serveTokenizerFetch(url: string): Response {
  const urlPath = tokenizerPath(url)
  if (!urlPath) {
    throw new Error(`Not a tokenizer URL: ${url}`)
  }
  return new Response(loadTokenizerFile(urlPath), {
    status: 200,
    headers: { 'content-type': 'application/octet-stream' },
  })
}
