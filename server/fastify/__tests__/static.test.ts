import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'

interface Harness {
  app: FastifyInstance
  dataDir: string
  staticRoot: string | null
}

async function startHarness(opts: { withStatic: boolean }): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-'))
  let staticRoot: string | null = null
  if (opts.withStatic) {
    staticRoot = mkdtempSync(path.join(tmpdir(), 'risu-fastify-static-'))
    writeFileSync(
      path.join(staticRoot, 'index.html'),
      '<!doctype html><html><head lang="en"><title>spa</title></head><body></body></html>',
    )
    mkdirSync(path.join(staticRoot, 'assets'))
    writeFileSync(path.join(staticRoot, 'assets', 'app.js'), 'console.log("app")')
  }
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
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

describe('Phase 2E static serving', () => {
  describe('with staticRoot present', () => {
    let harness: Harness

    beforeEach(async () => {
      harness = await startHarness({ withStatic: true })
    })

    afterEach(async () => {
      await stopHarness(harness)
    })

    it('serves index.html on GET /', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('<title>spa</title>')
    })

    it('injects globalThis.__FASTIFY__ into the served index.html', async () => {
      const root = await harness.app.inject({ method: 'GET', url: '/' })
      expect(root.statusCode).toBe(200)
      expect(root.headers['content-type']).toContain('text/html')
      expect(root.body).toContain('globalThis.__FASTIFY__ = true')
      expect(root.body).not.toContain('globalThis.__NODE__')
      // Injected just after the opening <head ...> tag so the flags are
      // set before any other script the SPA boot would run.
      expect(root.body.indexOf('globalThis.__FASTIFY__')).toBeLessThan(
        root.body.indexOf('<title>spa</title>'),
      )

      const spa = await harness.app.inject({ method: 'GET', url: '/character/123' })
      expect(spa.statusCode).toBe(200)
      expect(spa.body).toContain('globalThis.__FASTIFY__ = true')
      expect(spa.body).not.toContain('globalThis.__NODE__')
    })

    it('serves nested static files', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/assets/app.js' })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('console.log("app")')
    })

    it('falls back to index.html for unknown SPA routes', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/character/123' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('text/html')
      expect(res.body).toContain('<title>spa</title>')
    })

    it('does not fall back to index.html for unknown /api/ routes', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/api/v1/does-not-exist' })
      expect(res.statusCode).toBe(404)
      expect(res.body).not.toContain('<title>spa</title>')
    })

    it('does not fall back to index.html for non-GET methods', async () => {
      const res = await harness.app.inject({ method: 'POST', url: '/character/123' })
      expect(res.statusCode).toBe(404)
      expect(res.body).not.toContain('<title>spa</title>')
    })

    it('still serves the API', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/api/v1/health' })
      expect(res.statusCode).toBe(200)
      expect(res.json().status).toBe('ok')
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

    it('still serves the API', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/api/v1/health' })
      expect(res.statusCode).toBe(200)
      expect(res.json().status).toBe('ok')
    })

    it('returns Fastify default 404 for non-API routes', async () => {
      const res = await harness.app.inject({ method: 'GET', url: '/character/123' })
      expect(res.statusCode).toBe(404)
    })
  })
})
