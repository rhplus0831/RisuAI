import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
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
