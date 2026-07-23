import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'

const subtle = webcrypto.subtle
const STALE_KEY = 'sk-stale-inline-secret-e2e'
const STALE_VERTEX_EMAIL = 'stale-vertex-client@example.com'
const STALE_VERTEX = 'stale-vertex-private-key-e2e'

async function startApp(dataDir: string): Promise<FastifyInstance> {
  process.env.LOG_LEVEL = 'silent'
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 2 * 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    memoryWorker: false,
    assetGc: false,
  })
  return app
}

async function signAssertion(privateKey: CryptoKey, publicJwk: JsonWebKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', typ: 'JWT' }
  const payload = { iat: now, exp: now + 60, pub: publicJwk }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    Buffer.from(signingInput),
  )
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`
}

describe('stale inline profile secrets in a pre-credential-store DB', () => {
  let dataDir: string
  let app: FastifyInstance
  let keypair: CryptoKeyPair
  let publicJwk: JsonWebKey

  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'risu-stale-secret-'))
    app = await startApp(dataDir)
    keypair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    publicJwk = await subtle.exportKey('jwk', keypair.publicKey)
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2', publicKey: publicJwk },
    })
    expect(setup.statusCode).toBe(200)
  })

  afterEach(async () => {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('does not serve stale secrets and keeps profile commands working', async () => {
    // 1. Seed a valid DB through the import route.
    const assertion1 = await signAssertion(keypair.privateKey, publicJwk)
    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'risu-auth': assertion1 },
      payload: {
        database: {
          modelProfiles: [{ id: 'profile-a', name: 'Legacy', providerId: 'openai', modelId: 'gpt-4.1' }],
        },
      },
    })
    expect(imported.statusCode).toBe(200)
    await app.close()

    // 2. Tamper the stored settings the way an OLD server version wrote them:
    //    inline apiKey + Vertex service-account fields on the profile row.
    const sqlite = new DatabaseSync(path.join(dataDir, 'risu.db'))
    const row = sqlite.prepare('SELECT data_json FROM settings WHERE id = 1').get() as {
      data_json: string
    }
    const settings = JSON.parse(row.data_json)
    expect(Array.isArray(settings.modelProfiles)).toBe(true)
    settings.modelProfiles[0].providerOptions = {
      apiKey: STALE_KEY,
      vertex: {
        projectId: 'preserved-project',
        clientEmail: STALE_VERTEX_EMAIL,
        privateKey: STALE_VERTEX,
      },
    }
    sqlite.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(settings))
    sqlite.close()

    // 3. Reopen the app on the tampered dataDir (same registered client key).
    app = await startApp(dataDir)
    const assertion2 = await signAssertion(keypair.privateKey, publicJwk)

    // 4. Resource reads must never expose the stale secrets.
    for (const url of ['/api/v1/settings', '/api/v1/settings/providers', '/api/v1/settings/models']) {
      const res = await app.inject({ method: 'GET', url, headers: { 'risu-auth': assertion2 } })
      expect(res.statusCode).toBe(200)
      expect(res.body).not.toContain(STALE_KEY)
      expect(res.body).not.toContain(STALE_VERTEX_EMAIL)
      expect(res.body).not.toContain(STALE_VERTEX)
    }

    // 5. The read-time repair is durable before any profile mutation runs.
    const repairedSqlite = new DatabaseSync(path.join(dataDir, 'risu.db'))
    const repairedRow = repairedSqlite.prepare('SELECT data_json FROM settings WHERE id = 1').get() as {
      data_json: string
    }
    repairedSqlite.close()
    expect(repairedRow.data_json).not.toContain(STALE_KEY)
    expect(repairedRow.data_json).not.toContain(STALE_VERTEX_EMAIL)
    expect(repairedRow.data_json).not.toContain(STALE_VERTEX)
    expect(JSON.parse(repairedRow.data_json).modelProfiles[0].providerOptions).toEqual({
      vertex: { projectId: 'preserved-project' },
    })

    // 6. Profile commands must still work against the repaired legacy rows.
    const settingsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/settings',
      headers: { 'risu-auth': assertion2 },
    })
    const revision = settingsRes.json().revision
    expect(typeof revision).toBe('number')
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/model-profiles/profile-a/duplicate',
      headers: { 'risu-auth': assertion2 },
      payload: { baseRevision: revision, name: 'Copy A' },
    })
    expect(dup.statusCode).toBe(200)
  })
})
