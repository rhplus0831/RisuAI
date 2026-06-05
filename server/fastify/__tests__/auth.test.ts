import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createAuthState, registerPublicKey } from '../src/auth.js'

describe('auth.knownKeyHashes (A4EC5 / B6 bounded accumulator)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-auth-cap-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keeps the known-key set bounded by the soft cap and evicts the LRU', () => {
    const cap = 4096
    const state = createAuthState(tmpDir)

    // Fill the set to the cap with deterministic keys.
    for (let i = 0; i < cap; i++) {
      registerPublicKey(state, { kty: 'EC', crv: 'P-256', id: i })
    }
    expect(state.knownKeyHashes.size).toBe(cap)

    // Add one more — the oldest entry (id=0) must be evicted.
    const oldestPayload = { kty: 'EC', crv: 'P-256', id: 0 }
    registerPublicKey(state, { kty: 'EC', crv: 'P-256', id: cap })
    expect(state.knownKeyHashes.size).toBe(cap)

    // Round-trip: re-register the evicted payload; it must be missing first
    // and present afterwards.
    const oldestHashHex = require('node:crypto')
      .createHash('sha256')
      .update(JSON.stringify(oldestPayload))
      .digest('hex')
    expect(state.knownKeyHashes.has(oldestHashHex)).toBe(false)

    registerPublicKey(state, oldestPayload)
    expect(state.knownKeyHashes.has(oldestHashHex)).toBe(true)
    expect(state.knownKeyHashes.size).toBe(cap)
  })

  it('persists the bounded set to disk on every register', () => {
    const state = createAuthState(tmpDir)
    registerPublicKey(state, { id: 'k1' })
    registerPublicKey(state, { id: 'k2' })

    const persisted = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '__known_public_key_hashes.json'), 'utf-8'),
    )
    expect(Array.isArray(persisted)).toBe(true)
    expect(persisted).toHaveLength(2)
  })

  it('trims a pre-existing oversize cache on load', () => {
    // Seed the cache file with 4097 entries.
    const oversize: string[] = []
    for (let i = 0; i < 4097; i++) {
      oversize.push(`hash-${i.toString().padStart(4, '0')}`)
    }
    fs.writeFileSync(
      path.join(tmpDir, '__known_public_key_hashes.json'),
      JSON.stringify(oversize),
      'utf-8',
    )

    const state = createAuthState(tmpDir)
    expect(state.knownKeyHashes.size).toBe(4096)
    // The oldest entry is evicted (insertion order).
    expect(state.knownKeyHashes.has('hash-0000')).toBe(false)
    expect(state.knownKeyHashes.has('hash-4096')).toBe(true)
  })
})

describe('projection bulk route auth (L16)', () => {
  it('rejects unauthenticated requests and verifies authenticated requests exactly once', async () => {
    vi.resetModules()
    let verifyCount = 0
    vi.doMock('../src/auth.js', async () => {
      const actual = await vi.importActual<typeof import('../src/auth.js')>('../src/auth.js')
      return {
        ...actual,
        verifyAssertion: async (...args: Parameters<typeof actual.verifyAssertion>) => {
          verifyCount += 1
          return actual.verifyAssertion(...args)
        },
      }
    })

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-auth-bulk-'))
    try {
      const { buildApp } = await import('../src/app.js')
      const { setupAuthedClient } = await import('./helpers/auth.js')
      const { app } = await buildApp({
        config: {
          host: '127.0.0.1',
          port: 0,
          dataDir,
          bodyLimit: 1024 * 1024,
          importMaxBytes: Infinity,
          trustProxy: false,
          hubUrl: 'https://sv.risuai.xyz',
        },
        assetGc: false,
        memoryWorker: false,
      })

      try {
        const { assertion } = await setupAuthedClient(app)
        const routes = [
          '/api/v1/projection/chatMessages/bulk',
          '/api/v1/projection/characterLorebooks/bulk',
        ]

        for (const url of routes) {
          verifyCount = 0
          const rejected = await app.inject({
            method: 'POST',
            url,
            payload: { ids: ['missing-id'] },
          })
          expect(rejected.statusCode).toBe(401)
          expect(rejected.json()).toEqual({ error: 'Auth required' })
          expect(verifyCount).toBe(0)

          verifyCount = 0
          const accepted = await app.inject({
            method: 'POST',
            url,
            headers: { 'risu-auth': assertion },
            payload: { ids: ['missing-id'] },
          })
          expect(accepted.statusCode).toBe(200)
          expect(verifyCount).toBe(1)
        }
      } finally {
        await app.close()
      }
    } finally {
      vi.doUnmock('../src/auth.js')
      vi.resetModules()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
