import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { applyJsonCommandMutation } from '../src/commands/mutations.js'
import { getSchemaState, openDatabase } from '../src/db.js'
import { loadPersisted, writePersisted } from '../src/repository.js'

const subtle = webcrypto.subtle

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: CommandEventSink
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-commands-'))
  const commandEvents = createCommandEventSink()
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    commandEvents,
  })
  return { app, dataDir, commandEvents }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

async function signAssertion(
  privateKey: CryptoKey,
  publicJwk: JsonWebKey,
  ttlSec = 60,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', typ: 'JWT' }
  const payload = { iat: now, exp: now + ttlSec, pub: publicJwk }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    Buffer.from(signingInput),
  )
  const sigB64 = Buffer.from(signature).toString('base64url')
  return `${signingInput}.${sigB64}`
}

async function setupAuthedClient(app: FastifyInstance): Promise<{ assertion: string }> {
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: { password: 'hunter2' },
  })
  expect(setup.statusCode).toBe(200)

  const keypair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicKey = await subtle.exportKey('jwk', keypair.publicKey)

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { password: 'hunter2', publicKey },
  })
  expect(login.statusCode).toBe(200)

  const assertion = await signAssertion(keypair.privateKey, publicKey)
  return { assertion }
}

async function importDatabase(
  app: FastifyInstance,
  assertion: string,
  database: Record<string, unknown>,
): Promise<number> {
  const imported = await app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(imported.statusCode).toBe(200)
  return imported.json().revision as number
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await stopHarness(harness)
})

describe('Phase 9-1 command foundation', () => {
  it('rejects unauthenticated runtime settings commands once a password is set', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      payload: { baseRevision: 0, patch: { useServerPromptAssembly: true } },
    })

    expect(res.statusCode).toBe(401)
  })

  it('rejects missing and invalid baseRevision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)

    const missing = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { patch: { useServerPromptAssembly: true } },
    })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().error).toBe('baseRevision must be a non-negative integer')

    const invalid = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: '0', patch: { useServerPromptAssembly: true } },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error).toBe('baseRevision must be a non-negative integer')
  })

  it('returns 409 with the current revision when baseRevision is stale', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDatabase(harness.app, assertion, { useServerPromptAssembly: false })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 0, patch: { useServerPromptAssembly: true } },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })

  it('applies the runtime settings harness command, emits an event, and appears in bootstrap', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      useServerPromptAssembly: false,
      greeting: 'hi',
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { useServerPromptAssembly: true } },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      revision: 2,
      event: {
        type: 'settings.updated',
        revision: 2,
        resource: 'settings',
      },
    })
    expect(harness.commandEvents.list()).toEqual([res.json().event])

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().revision).toBe(2)
    expect(bootstrap.json().database).toEqual({
      useServerPromptAssembly: true,
      greeting: 'hi',
    })
  })

  it('does not bump revision or mutate db.json on validation failure', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      useServerPromptAssembly: false,
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { useServerPromptAssembly: 'yes' } },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('useServerPromptAssembly must be a boolean')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database).toEqual({ useServerPromptAssembly: false })

    const onDisk = JSON.parse(readFileSync(path.join(harness.dataDir, 'db.json'), 'utf8'))
    expect(onDisk.database).toEqual({ useServerPromptAssembly: false })
  })

  it('rolls back a thrown JSON command mutation before bumping revision', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-command-helper-'))
    const db = openDatabase(dataDir)
    const commandEvents = createCommandEventSink()
    writePersisted(dataDir, {
      _version: 1,
      database: { useServerPromptAssembly: false },
      assets: [],
    })

    try {
      expect(() =>
        applyJsonCommandMutation({
          db,
          dataDir,
          baseRevision: 0,
          eventSink: commandEvents,
          mutate(database) {
            const target = database as Record<string, unknown>
            target.useServerPromptAssembly = true
            throw new Error('boom')
          },
        }),
      ).toThrow('boom')

      expect(getSchemaState(db).revision).toBe(0)
      expect(loadPersisted(dataDir).database).toEqual({ useServerPromptAssembly: false })
      expect(commandEvents.list()).toEqual([])
    } finally {
      db.close()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})

describe('Phase 9-2a scalar settings groups', () => {
  it('applies display settings through the grouped settings command', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      theme: 'dark',
      zoomsize: 100,
      greeting: 'hi',
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { theme: 'light', zoomsize: 88 } },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      revision: 2,
      event: {
        type: 'settings.updated',
        revision: 2,
        resource: 'settings',
      },
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(2)
    expect(bootstrap.json().database).toEqual({
      theme: 'light',
      zoomsize: 88,
      greeting: 'hi',
    })
  })

  it('allows provider scalar updates before provider-key masking lands', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      openAIKey: 'old',
      aiModel: 'gpt4o-chatgpt',
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/providers',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { openAIKey: 'new-secret', aiModel: 'openrouter' },
      },
    })

    expect(res.statusCode).toBe(200)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database).toEqual({
      openAIKey: 'new-secret',
      aiModel: 'openrouter',
    })
  })

  it('applies manual settings page scalar roots through grouped commands', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      aiModel: 'gpt4o-chatgpt',
      maxContext: 8000,
      sdProvider: 'webui',
      username: 'User',
    })

    const provider = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/providers',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: {
          aiModel: 'openrouter',
          forceReplaceUrl: 'https://proxy.example.test',
          customTokenizer: 'tik',
          echoMessage: 'pong',
          echoDelay: 2,
        },
      },
    })
    expect(provider.statusCode).toBe(200)

    const runtime = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: provider.json().revision,
        patch: {
          maxContext: 12000,
          epEnabled: true,
          seperateModels: { memory: 'mem', translate: '', emotion: '', otherAx: '' },
        },
      },
    })
    expect(runtime.statusCode).toBe(200)

    const media = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/media',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: runtime.json().revision,
        patch: {
          sdProvider: 'wavespeed',
          emotionProcesser: 'llm',
          wavespeedImage: { key: 'wave-key', model: 'flux' },
        },
      },
    })
    expect(media.statusCode).toBe(200)

    const account = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/account',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: media.json().revision,
        patch: {
          username: 'Fastify User',
          didFirstSetup: true,
        },
      },
    })
    expect(account.statusCode).toBe(200)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database).toMatchObject({
      aiModel: 'openrouter',
      forceReplaceUrl: 'https://proxy.example.test',
      customTokenizer: 'tik',
      echoMessage: 'pong',
      echoDelay: 2,
      maxContext: 12000,
      epEnabled: true,
      seperateModels: { memory: 'mem', translate: '', emotion: '', otherAx: '' },
      sdProvider: 'wavespeed',
      emotionProcesser: 'llm',
      wavespeedImage: { key: 'wave-key', model: 'flux' },
      username: 'Fastify User',
      didFirstSetup: true,
    })
  })

  it('rejects unknown setting keys without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      theme: 'dark',
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { openAIKey: 'wrong-group' } },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Unsupported display setting: openAIKey')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database).toEqual({ theme: 'dark' })
  })

  it('rejects unsupported settings groups', async () => {
    const { assertion } = await setupAuthedClient(harness.app)

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/prompt',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 0, patch: { promptTemplate: [] } },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Unsupported settings group: prompt')
  })
})
