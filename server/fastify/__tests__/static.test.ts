import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { OutgoingHttpHeaders } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { STATIC_ASSET_CACHE_CONTROL, STATIC_TOKENIZER_CACHE_CONTROL, buildApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'

const STATIC_APP_JS =
  'console.log("app")\n' +
  `globalThis.__STATIC_COMPRESSION_FIXTURE__ = ${JSON.stringify('static chunk '.repeat(300))}\n`
const STATIC_INDEX_HTML =
  '<!doctype html><html><head lang="en"><title>spa</title></head><body>' +
  '<main data-test="spa-root">' +
  'static spa entry '.repeat(120) +
  '</main></body></html>'
const STATIC_TOKENIZER_JSON = JSON.stringify({ model: { vocab: { hello: 1, world: 2 } } })

interface Harness {
  app: FastifyInstance
  dataDir: string
  staticRoot: string | null
}

function cacheControl(res: { headers: OutgoingHttpHeaders }): string {
  const value = res.headers['cache-control']
  if (Array.isArray(value)) return value.join(', ')
  return value === undefined ? '' : String(value)
}

function expectNotImmutableCached(res: { headers: OutgoingHttpHeaders }): void {
  const header = cacheControl(res)
  expect(header).not.toContain('immutable')
  expect(header).not.toContain('max-age=31536000')
}

async function startHarness(opts: { withStatic: boolean }): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-'))
  let staticRoot: string | null = null
  if (opts.withStatic) {
    staticRoot = mkdtempSync(path.join(tmpdir(), 'risu-fastify-static-'))
    writeFileSync(path.join(staticRoot, 'index.html'), STATIC_INDEX_HTML)
    mkdirSync(path.join(staticRoot, 'assets'))
    writeFileSync(path.join(staticRoot, 'assets', 'app.js'), STATIC_APP_JS)
    mkdirSync(path.join(staticRoot, 'token', 'llama'), { recursive: true })
    writeFileSync(path.join(staticRoot, 'token', 'llama', 'llama3.json'), STATIC_TOKENIZER_JSON)
  }
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
      staticRoot,
    },
  })
  return { app, dataDir, staticRoot }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
  if (h.staticRoot) rmSync(h.staticRoot, { recursive: true, force: true })
}

describe('static serving', () => {
  describe('with staticRoot present', () => {
    let harness: Harness

    beforeEach(async () => {
      harness = await startHarness({ withStatic: true })
    })

    afterEach(async () => {
      await stopHarness(harness)
    })

    it('keeps GET / outside immutable chunk caching', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('<title>spa</title>')
      expectNotImmutableCached(res)
    })

    it('serves compressed GET / with the SPA document body', async () => {
      const res = await harness.app.inject({
        method: 'GET',
        url: '/',
        headers: { 'accept-encoding': 'gzip' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('text/html')
      expect(res.headers['content-encoding']).toBe('gzip')
      expect(gunzipSync(Buffer.from(res.rawPayload)).toString('utf8')).toBe(STATIC_INDEX_HTML)
    })

    it('serves index.html without injecting runtime flags', async () => {
      const root = await harness.app.inject({ method: 'GET', url: '/' })
      expect(root.statusCode).toBe(200)
      expect(root.headers['content-type']).toContain('text/html')
      expect(root.body).not.toContain('globalThis.__FASTIFY__')
      expect(root.body).not.toContain('globalThis.__NODE__')

      const spa = await harness.app.inject({ method: 'GET', url: '/character/123' })
      expect(spa.statusCode).toBe(200)
      expect(spa.body).not.toContain('globalThis.__FASTIFY__')
    })

    it('immutable-caches SPA assets under /assets', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/assets/app.js' })
      expect(res.statusCode).toBe(200)
      expect(cacheControl(res)).toBe(STATIC_ASSET_CACHE_CONTROL)
      expect(res.body).toBe(STATIC_APP_JS)
    })

    it('long-caches tokenizer vocab files under /token without immutable', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/token/llama/llama3.json' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe(STATIC_TOKENIZER_JSON)
      expect(cacheControl(res)).toBe(STATIC_TOKENIZER_CACHE_CONTROL)
      expect(cacheControl(res)).not.toContain('immutable')
      expect(cacheControl(res)).not.toContain('max-age=0')
    })

    it('gzip-compresses large static assets without changing the bytes', async () => {
      const uncompressed = await harness.app.inject({ method: 'GET', url: '/assets/app.js' })
      expect(uncompressed.statusCode).toBe(200)
      expect(uncompressed.headers['content-encoding']).toBeUndefined()
      expect(uncompressed.body).toBe(STATIC_APP_JS)

      const compressed = await harness.app.inject({
        method: 'GET',
        url: '/assets/app.js',
        headers: { 'accept-encoding': 'gzip' },
      })
      expect(compressed.statusCode).toBe(200)
      expect(compressed.headers['content-encoding']).toBe('gzip')
      const compressedBytes = Buffer.from(compressed.rawPayload)
      expect(gunzipSync(compressedBytes).toString('utf8')).toBe(STATIC_APP_JS)
      expect(compressedBytes.length).toBeLessThan(Buffer.byteLength(STATIC_APP_JS) * 0.7)
    })

    it('leaves small API responses below the compression threshold uncompressed', async () => {
      const res = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: { 'accept-encoding': 'gzip' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.json().status).toBe('ok')
      expect(Buffer.byteLength(res.body)).toBeLessThan(1024)
    })

    it('keeps SPA fallback outside immutable chunk caching', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/character/123' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('text/html')
      expect(res.body).toContain('<title>spa</title>')
      expectNotImmutableCached(res)
    })

    it('serves SPA fallback with the document body when compression is requested', async () => {
      const res = await harness.app.inject({
        method: 'GET',
        url: '/character/123',
        headers: { 'accept-encoding': 'gzip' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('text/html')
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.body).toBe(STATIC_INDEX_HTML)
      expectNotImmutableCached(res)
    })

    it('preserves API 404 outside SPA fallback', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/api/v1/does-not-exist' })
      expect(res.statusCode).toBe(404)
      expect(res.body).not.toContain('<title>spa</title>')
      expectNotImmutableCached(res)
    })

    it('preserves non-GET SPA fallback rejection', async () => {
      const res = await harness.app.inject({ method: 'POST', url: '/character/123' })
      expect(res.statusCode).toBe(404)
      expect(res.body).not.toContain('<title>spa</title>')
      expectNotImmutableCached(res)
    })
  })

  describe('without staticRoot', () => {
    let harness: Harness

    beforeEach(async () => {
      harness = await startHarness({ withStatic: false })
    })

    afterEach(async () => {
      await stopHarness(harness)
    })

    it('returns Fastify default 404 for non-API routes', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/character/123' })
      expect(res.statusCode).toBe(404)
    })
  })
})
