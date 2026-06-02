import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import {
  applyJsonCommandMutation,
  applyMessageFreeJsonCommandMutation,
} from '../src/commands/mutations.js'
import { getSchemaState, openDatabase } from '../src/db.js'
import { MASKED_PROVIDER_SECRET } from '../src/providerSecrets.js'
import { loadPersisted, writePersistedWithMessages, insertAssetMetadataBatch } from '../src/repository.js'
import {
  activeMessageRowids,
  assertOnlyRowsWritten,
  tableRowidsById,
} from './helpers/rowStability.js'

const subtle = webcrypto.subtle

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: CommandEventSink
}

function failCommandEventPersistence(dataDir: string): void {
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    db.exec(`
      CREATE TRIGGER fail_command_event_insert
      BEFORE INSERT ON command_events
      BEGIN
        SELECT RAISE(FAIL, 'injected command event failure');
      END;
    `)
  } finally {
    db.close()
  }
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
      importMaxBytes: Infinity,
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

/** Open a temporary db handle, call loadPersisted, close the handle. */
function loadPersistedFromDir(dataDir: string) {
  const db = openDatabase(dataDir)
  try {
    return loadPersisted(db, dataDir)
  } finally {
    db.close()
  }
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

// The bootstrap ships chat stubs; read persisted messages via per-chat hydration.
async function persistedChatMessages(
  app: FastifyInstance,
  assertion: string,
  chatId: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/projection/chatMessages?id=${encodeURIComponent(chatId)}`,
    headers: { 'risu-auth': assertion },
  })
  expect(res.statusCode).toBe(200)
  return res.json().message as Array<Record<string, unknown>>
}

async function uploadAsset(
  app: FastifyInstance,
  assertion: string,
  bytes = Buffer.from('asset-bytes'),
  contentType = 'image/png',
): Promise<{ assetId: string; revision: number }> {
  const uploaded = await app.inject({
    method: 'POST',
    url: '/api/v1/assets',
    headers: {
      'risu-auth': assertion,
      'content-type': contentType,
    },
    payload: bytes,
  })
  expect(uploaded.statusCode).toBe(201)
  return uploaded.json() as { assetId: string; revision: number }
}

function seedAssetMetadata(dataDir: string, assetId = 'a'.repeat(64)): string {
  const seedDb = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    insertAssetMetadataBatch(seedDb, [
      { id: assetId, ext: 'png', size: 1, contentType: 'image/png' },
    ])
  } finally {
    seedDb.close()
  }
  return assetId
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
      payload: { baseRevision: 0, patch: { streamGeminiThoughts: true } },
    })

    expect(res.statusCode).toBe(401)
  })

  it('rejects missing and invalid baseRevision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)

    const missing = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { patch: { streamGeminiThoughts: true } },
    })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().error).toBe('baseRevision must be a non-negative integer')

    const invalid = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: '0', patch: { streamGeminiThoughts: true } },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error).toBe('baseRevision must be a non-negative integer')
  })

  it('returns 409 with the current revision when baseRevision is stale', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDatabase(harness.app, assertion, { streamGeminiThoughts: false })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 0, patch: { streamGeminiThoughts: true } },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })

  it('emits no event and leaves revision + persisted state untouched on a stale (409) write', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDatabase(harness.app, assertion, { streamGeminiThoughts: false })
    // Drop the import's own event so we observe only what the stale write does.
    harness.commandEvents.clear()

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 0, patch: { streamGeminiThoughts: true } },
    })
    expect(res.statusCode).toBe(409)

    // The revision-mismatch guard throws BEFORE the mutate callback, so nothing
    // may have leaked: no event, no revision bump, no persisted write.
    expect(harness.commandEvents.list()).toEqual([])

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database).toMatchObject({ streamGeminiThoughts: false })
  })

  it('applies the runtime settings harness command, emits an event, and appears in bootstrap', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      streamGeminiThoughts: false,
      greeting: 'hi',
    })
    harness.commandEvents.clear()

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { streamGeminiThoughts: true } },
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
    expect(bootstrap.json().database).toMatchObject({
      streamGeminiThoughts: true,
      greeting: 'hi',
    })
  })

  it('does not bump revision or mutate persisted state on validation failure', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      streamGeminiThoughts: false,
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { streamGeminiThoughts: 'yes' } },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('streamGeminiThoughts must be a boolean')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database).toMatchObject({ streamGeminiThoughts: false })
  })

  it('rolls back a thrown JSON command mutation before bumping revision', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-command-helper-'))
    const db = openDatabase(dataDir)
    const commandEvents = createCommandEventSink()
    writePersistedWithMessages(db, dataDir, {
      _version: 1,
      database: { streamGeminiThoughts: false },
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
            target.streamGeminiThoughts = true
            throw new Error('boom')
          },
        }),
      ).toThrow('boom')

      expect(getSchemaState(db).revision).toBe(0)
      expect(loadPersisted(db, dataDir).database).toMatchObject({ streamGeminiThoughts: false, characters: [] })
      expect(commandEvents.list()).toEqual([])
    } finally {
      db.close()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('rolls back a thrown message-free JSON command mutation before persisting', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-message-free-command-helper-'))
    const db = openDatabase(dataDir)
    const commandEvents = createCommandEventSink()
    writePersistedWithMessages(db, dataDir, {
      _version: 1,
      database: { streamGeminiThoughts: false },
      assets: [],
    })

    try {
      expect(() =>
        applyMessageFreeJsonCommandMutation({
          db,
          dataDir,
          baseRevision: 0,
          eventSink: commandEvents,
          mutate(database) {
            const target = database as Record<string, unknown>
            target.streamGeminiThoughts = true
            throw new Error('boom')
          },
        }),
      ).toThrow('boom')

      expect(getSchemaState(db).revision).toBe(0)
      expect(loadPersisted(db, dataDir).database).toMatchObject({ streamGeminiThoughts: false, characters: [] })
      expect(commandEvents.list()).toEqual([])
    } finally {
      db.close()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})

describe('first-run database seed', () => {
  it('rejects a settings command on a never-seeded (null database) server', async () => {
    // Regression: a fresh server ships database: null, and every command path
    // requires an existing object. The welcome screen's first action (set
    // username) is the first to hit it.
    const { assertion } = await setupAuthedClient(harness.app)

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/account',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 0, patch: { username: 'Test' } },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('database must be an object before settings commands can run')
  })

  it('creates the server default database, emits an event, and unblocks settings commands', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    harness.commandEvents.clear()

    const seeded = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/state/initialize',
      headers: { 'risu-auth': assertion },
      payload: {},
    })

    expect(seeded.statusCode).toBe(200)
    expect(seeded.json()).toEqual({
      revision: 1,
      initialized: true,
      event: {
        type: 'state.initialized',
        revision: 1,
        resource: 'state',
      },
    })
    expect(harness.commandEvents.list()).toEqual([seeded.json().event])

    // The previously-rejected settings command now succeeds against revision 1.
    const account = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/account',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 1, patch: { username: 'Test' } },
    })
    expect(account.statusCode).toBe(200)
    expect(account.json().revision).toBe(2)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(2)
    expect(bootstrap.json().database).toMatchObject({
      username: 'Test',
      temperature: 80,
      botPresets: [expect.objectContaining({ id: 'default-preset' })],
      personas: [expect.objectContaining({ id: 'default-persona' })],
    })
  })

  it('does not seed database or bump revision when initialization event persistence fails', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    failCommandEventPersistence(harness.dataDir)

    const seeded = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/state/initialize',
      headers: { 'risu-auth': assertion },
      payload: {},
    })

    expect(seeded.statusCode).toBe(500)
    expect(harness.commandEvents.list()).toEqual([])
    const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
    try {
      expect(getSchemaState(db).revision).toBe(0)
      expect(loadPersisted(db, harness.dataDir).database).toBeNull()
    } finally {
      db.close()
    }
  })

  it('is an idempotent no-op that never clobbers an existing database', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      username: 'Existing',
      characters: [{ chaId: 'char-a', name: 'Ada' }],
    })
    harness.commandEvents.clear()

    const seeded = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/state/initialize',
      headers: { 'risu-auth': assertion },
      payload: {},
    })

    expect(seeded.statusCode).toBe(200)
    expect(seeded.json()).toEqual({ revision, initialized: false })
    // No write happened: no event, revision unchanged, data preserved.
    expect(harness.commandEvents.list()).toEqual([])

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
    expect(bootstrap.json().database).toMatchObject({ username: 'Existing' })
  })

  it('rejects request-shaped database seed payloads', async () => {
    const { assertion } = await setupAuthedClient(harness.app)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/state/initialize',
      headers: { 'risu-auth': assertion },
      payload: { database: { username: 'client-shaped' } },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('database payload is no longer accepted for state initialization')
  })

  it('rejects non-object initialize bodies', async () => {
    const { assertion } = await setupAuthedClient(harness.app)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/state/initialize',
      headers: { 'risu-auth': assertion },
      payload: ['array'],
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('request body must be an object')
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
    expect(bootstrap.json().database).toMatchObject({
      theme: 'light',
      zoomsize: 88,
      greeting: 'hi',
    })
  })

  it('accepts projection-sweep settings through grouped commands', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      notification: false,
      useAutoSuggestions: false,
      useAutoTranslateInput: false,
      globalscript: [],
    })

    const display = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: {
          notification: true,
          textScreenColor: null,
          promptDiffPrefs: { diffStyle: 'line', contextRadius: 2 },
          customTextTheme: { FontColorStandard: '#ffffff' },
        },
      },
    })
    expect(display.statusCode).toBe(200)

    const runtime = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: display.json().revision,
        patch: { useAutoSuggestions: true },
      },
    })
    expect(runtime.statusCode).toBe(200)

    const language = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/language',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: runtime.json().revision,
        patch: { useAutoTranslateInput: true },
      },
    })
    expect(language.statusCode).toBe(200)

    const advanced = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/advanced',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: language.json().revision,
        patch: {
          globalscript: [{ id: 'script-a', in: 'foo', out: 'bar', type: 'editinput' }],
          allowAllExtentionFiles: true,
          auxModelUnderModelSettings: true,
          pluginCompatibilityMode: true,
        },
      },
    })
    expect(advanced.statusCode).toBe(200)

    const sidebar = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/sidebar',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: advanced.json().revision,
        patch: {
          globalChatVariables: { toggle_mood: '1' },
          jailbreakToggle: true,
          customSidebarItems: [
            {
              id: 'sidebar-loadout',
              type: 'loadout',
              subType: 'none',
              label: 'Loadouts',
            },
          ],
          hotkeys: [{ key: 'a', ctrl: true, action: 'home' }],
        },
      },
    })
    expect(sidebar.statusCode).toBe(200)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database).toMatchObject({
      notification: true,
      useAutoSuggestions: true,
      useAutoTranslateInput: true,
      textScreenColor: null,
      promptDiffPrefs: { diffStyle: 'line', contextRadius: 2 },
      customTextTheme: { FontColorStandard: '#ffffff' },
      globalscript: [{ id: 'script-a', in: 'foo', out: 'bar', type: 'editinput' }],
      allowAllExtentionFiles: true,
      auxModelUnderModelSettings: true,
      globalChatVariables: { toggle_mood: '1' },
      jailbreakToggle: true,
      customSidebarItems: [
        {
          id: 'sidebar-loadout',
          type: 'loadout',
          subType: 'none',
          label: 'Loadouts',
        },
      ],
      hotkeys: [{ key: 'a', ctrl: true, action: 'home' }],
    })
  })

  it('allows provider scalar updates and masks them in bootstrap', async () => {
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
    expect(bootstrap.json().database).toMatchObject({
      openAIKey: MASKED_PROVIDER_SECRET,
      aiModel: 'openrouter',
    })
  })

  it('applies chat format settings through the provider settings command', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      instructChatTemplate: 'chatml',
      JinjaTemplate: '',
    })
    const jinjaTemplate = '{% for message in messages %}{{ message.content }}{% endfor %}'

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/providers',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: {
          instructChatTemplate: 'jinja',
          JinjaTemplate: jinjaTemplate,
        },
      },
    })

    expect(res.statusCode, res.body).toBe(200)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database).toMatchObject({
      instructChatTemplate: 'jinja',
      JinjaTemplate: jinjaTemplate,
    })
  })

  it('preserves masked provider placeholders while replacing explicit new secrets', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      openAIKey: 'old-openai',
      claudeAPIKey: 'old-claude',
      OaiCompAPIKeys: { deepseek: 'old-deepseek', deepinfra: 'old-deepinfra' },
      customModels: [
        { id: 'xcustom:::a', name: 'Custom A', key: 'old-custom', url: 'https://old.example.com' },
      ],
      authRefreshes: [
        {
          url: 'https://mcp.example.com',
          tokenUrl: 'https://mcp.example.com/token',
          refreshToken: 'old-refresh',
          clientId: 'client-id',
          clientSecret: 'old-client-secret',
        },
      ],
      aiModel: 'gpt4o-chatgpt',
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/providers',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: {
          openAIKey: MASKED_PROVIDER_SECRET,
          claudeAPIKey: 'new-claude',
          OaiCompAPIKeys: {
            deepseek: MASKED_PROVIDER_SECRET,
            deepinfra: 'new-deepinfra',
          },
          customModels: [
            {
              id: 'xcustom:::a',
              name: 'Custom A renamed',
              key: MASKED_PROVIDER_SECRET,
              url: 'https://new.example.com',
            },
          ],
          authRefreshes: [
            {
              url: 'https://mcp.example.com',
              tokenUrl: 'https://mcp.example.com/token',
              refreshToken: MASKED_PROVIDER_SECRET,
              clientId: 'client-id-new',
              clientSecret: 'new-client-secret',
            },
          ],
        },
      },
    })

    expect(res.statusCode).toBe(200)
    expect(loadPersistedFromDir(harness.dataDir).database).toMatchObject({
      openAIKey: 'old-openai',
      claudeAPIKey: 'new-claude',
      OaiCompAPIKeys: { deepseek: 'old-deepseek', deepinfra: 'new-deepinfra' },
      customModels: [
        {
          id: 'xcustom:::a',
          name: 'Custom A renamed',
          key: 'old-custom',
          url: 'https://new.example.com',
        },
      ],
      authRefreshes: [
        {
          url: 'https://mcp.example.com',
          tokenUrl: 'https://mcp.example.com/token',
          refreshToken: 'old-refresh',
          clientId: 'client-id-new',
          clientSecret: 'new-client-secret',
        },
      ],
      aiModel: 'gpt4o-chatgpt',
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database).toMatchObject({
      openAIKey: MASKED_PROVIDER_SECRET,
      claudeAPIKey: MASKED_PROVIDER_SECRET,
      OaiCompAPIKeys: { deepseek: MASKED_PROVIDER_SECRET, deepinfra: MASKED_PROVIDER_SECRET },
      customModels: [{ key: MASKED_PROVIDER_SECRET }],
      authRefreshes: [
        {
          refreshToken: MASKED_PROVIDER_SECRET,
          clientSecret: MASKED_PROVIDER_SECRET,
        },
      ],
    })
  })

  it('restores masked provider array secrets by stable row identity after reorder', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      customModels: [
        { id: 'xcustom:::a', name: 'Custom A', key: 'custom-a', url: 'https://a.example.com' },
        { id: 'xcustom:::b', name: 'Custom B', key: 'custom-b', url: 'https://b.example.com' },
      ],
      authRefreshes: [
        {
          url: 'https://mcp-a.example.com',
          tokenUrl: 'https://mcp-a.example.com/token',
          refreshToken: 'refresh-a',
          clientId: 'client-a',
          clientSecret: 'secret-a',
        },
        {
          url: 'https://mcp-b.example.com',
          tokenUrl: 'https://mcp-b.example.com/token',
          refreshToken: 'refresh-b',
          clientId: 'client-b',
          clientSecret: 'secret-b',
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/providers',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: {
          customModels: [
            {
              id: 'xcustom:::b',
              name: 'Custom B renamed',
              key: MASKED_PROVIDER_SECRET,
              url: 'https://b2.example.com',
            },
            {
              id: 'xcustom:::a',
              name: 'Custom A renamed',
              key: MASKED_PROVIDER_SECRET,
              url: 'https://a2.example.com',
            },
          ],
          authRefreshes: [
            {
              url: 'https://mcp-b.example.com',
              tokenUrl: 'https://mcp-b.example.com/token',
              refreshToken: MASKED_PROVIDER_SECRET,
              clientId: 'client-b-new',
              clientSecret: MASKED_PROVIDER_SECRET,
            },
            {
              url: 'https://mcp-a.example.com',
              tokenUrl: 'https://mcp-a.example.com/token',
              refreshToken: MASKED_PROVIDER_SECRET,
              clientId: 'client-a-new',
              clientSecret: MASKED_PROVIDER_SECRET,
            },
          ],
        },
      },
    })

    expect(res.statusCode).toBe(200)
    expect(loadPersistedFromDir(harness.dataDir).database).toMatchObject({
      customModels: [
        {
          id: 'xcustom:::b',
          name: 'Custom B renamed',
          key: 'custom-b',
          url: 'https://b2.example.com',
        },
        {
          id: 'xcustom:::a',
          name: 'Custom A renamed',
          key: 'custom-a',
          url: 'https://a2.example.com',
        },
      ],
      authRefreshes: [
        {
          url: 'https://mcp-b.example.com',
          tokenUrl: 'https://mcp-b.example.com/token',
          refreshToken: 'refresh-b',
          clientId: 'client-b-new',
          clientSecret: 'secret-b',
        },
        {
          url: 'https://mcp-a.example.com',
          tokenUrl: 'https://mcp-a.example.com/token',
          refreshToken: 'refresh-a',
          clientId: 'client-a-new',
          clientSecret: 'secret-a',
        },
      ],
    })
  })

  it('does not transplant masked provider array secrets after deleting earlier rows', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      customModels: [
        { id: 'xcustom:::a', name: 'Custom A', key: 'custom-a', url: 'https://a.example.com' },
        { id: 'xcustom:::b', name: 'Custom B', key: 'custom-b', url: 'https://b.example.com' },
      ],
      authRefreshes: [
        {
          url: 'https://mcp-a.example.com',
          tokenUrl: 'https://mcp-a.example.com/token',
          refreshToken: 'refresh-a',
          clientId: 'client-a',
          clientSecret: 'secret-a',
        },
        {
          url: 'https://mcp-b.example.com',
          tokenUrl: 'https://mcp-b.example.com/token',
          refreshToken: 'refresh-b',
          clientId: 'client-b',
          clientSecret: 'secret-b',
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/providers',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: {
          customModels: [
            {
              id: 'xcustom:::b',
              name: 'Custom B kept',
              key: MASKED_PROVIDER_SECRET,
              url: 'https://b.example.com',
            },
          ],
          authRefreshes: [
            {
              url: 'https://mcp-b.example.com',
              tokenUrl: 'https://mcp-b.example.com/token',
              refreshToken: MASKED_PROVIDER_SECRET,
              clientId: 'client-b',
              clientSecret: MASKED_PROVIDER_SECRET,
            },
          ],
        },
      },
    })

    expect(res.statusCode).toBe(200)
    expect(loadPersistedFromDir(harness.dataDir).database).toMatchObject({
      customModels: [
        { id: 'xcustom:::b', name: 'Custom B kept', key: 'custom-b', url: 'https://b.example.com' },
      ],
      authRefreshes: [
        {
          url: 'https://mcp-b.example.com',
          tokenUrl: 'https://mcp-b.example.com/token',
          refreshToken: 'refresh-b',
          clientId: 'client-b',
          clientSecret: 'secret-b',
        },
      ],
    })
  })

  it('rejects masked provider array placeholders without matching row identity', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      customModels: [
        { id: 'xcustom:::a', name: 'Custom A', key: 'custom-a', url: 'https://a.example.com' },
      ],
    })

    const missingIdentity = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/providers',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: {
          customModels: [
            { name: 'Missing Id', key: MASKED_PROVIDER_SECRET, url: 'https://missing.example.com' },
          ],
        },
      },
    })
    expect(missingIdentity.statusCode).toBe(400)
    expect(missingIdentity.json().error).toContain('without id')

    const unknownRow = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/providers',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: {
          customModels: [
            {
              id: 'xcustom:::missing',
              name: 'Missing',
              key: MASKED_PROVIDER_SECRET,
              url: 'https://missing.example.com',
            },
          ],
        },
      },
    })
    expect(unknownRow.statusCode).toBe(400)
    expect(unknownRow.json().error).toContain('unknown customModels row')
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
          subModel: 'claude',
          forceReplaceUrl: 'https://proxy.example.test',
          proxyKey: 'proxy-secret',
          customProxyRequestModel: 'proxy-model',
          customAPIFormat: 1,
          customTokenizer: 'tik',
          google: { accessToken: 'google-secret', projectId: 'project-a' },
          vertexClientEmail: 'vertex@example.test',
          vertexPrivateKey: 'vertex-private',
          vertexAccessToken: '',
          vertexAccessTokenExpires: 0,
          vertexRegion: 'us-central1',
          novellistAPI: 'novellist-secret',
          mancerHeader: 'mancer-secret',
          claudeAPIKey: 'claude-secret',
          mistralKey: 'mistral-secret',
          novelai: { token: 'nai-secret', model: 'nai-model' },
          cohereAPIKey: 'cohere-secret',
          ollamaURL: 'https://ollama.example.test',
          ollamaInputMode: 'manual',
          ollamaCloudModel: 'cloud-model',
          ollamaModelSource: 'cloud',
          ollamaCloudModelName: 'Cloud Model',
          ollamaApiKey: 'ollama-secret',
          ollamaRequestFormat: 1,
          ollamaModel: 'local-model',
          ollamaModelName: '',
          ollamaThinkingMode: 'medium',
          nanogptKey: 'nanogpt-secret',
          nanogptUseSubscriptionEndpoint: true,
          nanogptSubscriptionState: 'active',
          nanogptRequestModel: 'nano-model',
          nanogptRequestModelName: 'Nano Model',
          nanogptProvider: '',
          openrouterKey: 'openrouter-secret',
          openrouterRequestModel: 'openrouter/model',
          openrouterFallback: true,
          openrouterMiddleOut: true,
          openrouterProvider: {
            order: ['OpenAI'],
            only: ['Anthropic'],
            ignore: ['Google'],
          },
          useInstructPrompt: true,
          openAIKey: 'openai-secret',
          OaiCompAPIKeys: { deepseek: 'deepseek-secret' },
          reverseProxyOobaMode: true,
          NAIadventure: true,
          NAIappendName: true,
          koboldURL: 'https://kobold.example.test',
          echoMessage: 'pong',
          echoDelay: 2,
          hordeConfig: { apiKey: 'horde-secret', model: '', softPrompt: '' },
          textgenWebUIStreamURL: 'wss://stream.example.test',
          textgenWebUIBlockingURL: 'https://blocking.example.test',
          ooba: { top_k: 50, top_p: 0.8, formating: { useName: true } },
          reverseProxyOobaArgs: { mode: 'chat', tokenizer: 'llama', top_k: 40 },
          NAIsettings: { topP: 0.75, topK: 80 },
          ainconfig: { top_p: 0.7, top_k: 90 },
          bias: [['token', -10]],
          additionalParams: [['stop', 'value']],
          huggingfaceKey: 'huggingface-secret',
        },
      },
    })
    expect(provider.statusCode, provider.body).toBe(200)

    const runtime = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: provider.json().revision,
        patch: {
          maxContext: 12000,
          epEnabled: true,
          doNotChangeSeperateModels: true,
          seperateParametersEnabled: true,
          seperateParametersByModel: true,
          disableSeperateParameterChangeOnPresetChange: true,
          seperateModels: { memory: 'mem', translate: '', emotion: '', otherAx: '' },
          seperateParameters: {
            memory: { temperature: 0.6 },
            translate: { top_p: 0.7 },
            emotion: {},
            otherAx: {},
            overrides: { 'openrouter/model': { top_k: 42 } },
          },
          localStopStrings: ['stop'],
          useStreaming: true,
          streamGeminiThoughts: true,
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
          webUiUrl: 'https://webui.example.test',
          sdSteps: 24,
          sdCFG: 8,
          sdConfig: { width: 1024, height: 768, enable_hr: true },
          NAIImgUrl: 'https://image.novelai.net',
          NAIApiKey: 'nai-image-secret',
          NAIImgModel: 'nai-diffusion-4-5-full',
          NAII2I: true,
          NAIImgConfig: { width: 832, height: 1216, sampler: 'k_euler' },
          dallEQuality: 'hd',
          stabilityKey: 'stability-secret',
          stabilityModel: 'core',
          stabllityStyle: 'anime',
          comfyUiUrl: 'https://comfy.example.test',
          comfyConfig: { workflow: '{}', timeout: 60 },
          falToken: 'fal-secret',
          falModel: 'fal-ai/flux-lora',
          falLora: 'https://lora.example.test/model.safetensors',
          falLoraScale: 0.75,
          ImagenModel: 'imagen-4.0-generate-001',
          ImagenImageSize: '2K',
          ImagenAspectRatio: '16:9',
          ImagenPersonGeneration: 'allow_adult',
          openaiCompatImage: {
            url: 'https://images.example.test/v1/images/generations',
            key: 'compat-image-secret',
            model: 'image-model',
            size: '1024x1024',
            quality: 'high',
          },
          wavespeedImage: {
            key: 'wave-key',
            model: 'flux',
            loras: [{ path: 'owner/model', scale: 1.2 }],
          },
          ttsAutoSpeech: true,
          elevenLabKey: 'eleven-secret',
          voicevoxUrl: 'https://voicevox.example.test',
          fishSpeechKey: 'fish-secret',
          emotionProcesser: 'embedding',
        },
      },
    })
    expect(media.statusCode).toBe(200)

    const memory = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/memory',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: media.json().revision,
        patch: {
          hypaV3: true,
          hypaV3PresetId: 0,
          hypaV3Presets: [
            {
              name: 'Fastify memory',
              settings: {
                summarizationModel: 'subModel',
                summarizationPrompt: 'Summarize',
                recentMemoryRatio: 0.4,
                similarMemoryRatio: 0.5,
              },
            },
          ],
          hypaModel: 'custom',
          hypaV3Key: 'hypa-openai-secret',
          hypaCustomSettings: {
            url: 'https://embedding.example.test/v1/embeddings',
            key: 'custom-embedding-secret',
            model: 'embedding-model',
          },
          voyageApiKey: 'voyage-secret',
        },
      },
    })
    expect(memory.statusCode).toBe(200)

    const account = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/account',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: memory.json().revision,
        patch: {
          username: 'Fastify User',
          didFirstSetup: true,
        },
      },
    })
    expect(account.statusCode).toBe(200)

    const advanced = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/advanced',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: account.json().revision,
        patch: {
          moduleIntergration: 'module-ns',
          enableCustomFlags: true,
          customFlags: [8, 21],
          pluginCompatibilityMode: true,
        },
      },
    })
    expect(advanced.statusCode).toBe(200)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database).toMatchObject({
      aiModel: 'openrouter',
      subModel: 'claude',
      forceReplaceUrl: 'https://proxy.example.test',
      proxyKey: MASKED_PROVIDER_SECRET,
      customProxyRequestModel: 'proxy-model',
      customAPIFormat: 1,
      customTokenizer: 'tik',
      google: { accessToken: MASKED_PROVIDER_SECRET, projectId: 'project-a' },
      vertexClientEmail: 'vertex@example.test',
      vertexPrivateKey: MASKED_PROVIDER_SECRET,
      vertexAccessToken: '',
      vertexAccessTokenExpires: 0,
      vertexRegion: 'us-central1',
      novellistAPI: MASKED_PROVIDER_SECRET,
      mancerHeader: MASKED_PROVIDER_SECRET,
      claudeAPIKey: MASKED_PROVIDER_SECRET,
      mistralKey: MASKED_PROVIDER_SECRET,
      novelai: { token: MASKED_PROVIDER_SECRET, model: 'nai-model' },
      cohereAPIKey: MASKED_PROVIDER_SECRET,
      ollamaURL: 'https://ollama.example.test',
      ollamaInputMode: 'manual',
      ollamaCloudModel: 'cloud-model',
      ollamaModelSource: 'cloud',
      ollamaCloudModelName: 'Cloud Model',
      ollamaApiKey: MASKED_PROVIDER_SECRET,
      ollamaRequestFormat: 1,
      ollamaModel: 'local-model',
      ollamaModelName: '',
      ollamaThinkingMode: 'medium',
      nanogptKey: MASKED_PROVIDER_SECRET,
      nanogptUseSubscriptionEndpoint: true,
      nanogptSubscriptionState: 'active',
      nanogptRequestModel: 'nano-model',
      nanogptRequestModelName: 'Nano Model',
      nanogptProvider: '',
      openrouterKey: MASKED_PROVIDER_SECRET,
      openrouterRequestModel: 'openrouter/model',
      openrouterFallback: true,
      openrouterMiddleOut: true,
      openrouterProvider: {
        order: ['OpenAI'],
        only: ['Anthropic'],
        ignore: ['Google'],
      },
      useInstructPrompt: true,
      openAIKey: MASKED_PROVIDER_SECRET,
      OaiCompAPIKeys: { deepseek: MASKED_PROVIDER_SECRET },
      reverseProxyOobaMode: true,
      NAIadventure: true,
      NAIappendName: true,
      koboldURL: 'https://kobold.example.test',
      echoMessage: 'pong',
      echoDelay: 2,
      hordeConfig: { apiKey: MASKED_PROVIDER_SECRET, model: '', softPrompt: '' },
      textgenWebUIStreamURL: 'wss://stream.example.test',
      textgenWebUIBlockingURL: 'https://blocking.example.test',
      ooba: { top_k: 50, top_p: 0.8, formating: { useName: true } },
      reverseProxyOobaArgs: { mode: 'chat', tokenizer: 'llama', top_k: 40 },
      NAIsettings: { topP: 0.75, topK: 80 },
      ainconfig: { top_p: 0.7, top_k: 90 },
      bias: [['token', -10]],
      additionalParams: [['stop', 'value']],
      huggingfaceKey: MASKED_PROVIDER_SECRET,
      maxContext: 12000,
      useStreaming: true,
      streamGeminiThoughts: true,
      epEnabled: true,
      doNotChangeSeperateModels: true,
      seperateParametersEnabled: true,
      seperateParametersByModel: true,
      disableSeperateParameterChangeOnPresetChange: true,
      seperateModels: { memory: 'mem', translate: '', emotion: '', otherAx: '' },
      seperateParameters: {
        memory: { temperature: 0.6 },
        translate: { top_p: 0.7 },
        emotion: {},
        otherAx: {},
        overrides: { 'openrouter/model': { top_k: 42 } },
      },
      localStopStrings: ['stop'],
      sdProvider: 'wavespeed',
      webUiUrl: 'https://webui.example.test',
      sdSteps: 24,
      sdCFG: 8,
      sdConfig: { width: 1024, height: 768, enable_hr: true },
      NAIImgUrl: 'https://image.novelai.net',
      NAIApiKey: MASKED_PROVIDER_SECRET,
      NAIImgModel: 'nai-diffusion-4-5-full',
      NAII2I: true,
      NAIImgConfig: { width: 832, height: 1216, sampler: 'k_euler' },
      dallEQuality: 'hd',
      stabilityKey: MASKED_PROVIDER_SECRET,
      stabilityModel: 'core',
      stabllityStyle: 'anime',
      comfyUiUrl: 'https://comfy.example.test',
      comfyConfig: { workflow: '{}', timeout: 60 },
      falToken: MASKED_PROVIDER_SECRET,
      falModel: 'fal-ai/flux-lora',
      falLora: 'https://lora.example.test/model.safetensors',
      falLoraScale: 0.75,
      ImagenModel: 'imagen-4.0-generate-001',
      ImagenImageSize: '2K',
      ImagenAspectRatio: '16:9',
      ImagenPersonGeneration: 'allow_adult',
      openaiCompatImage: {
        url: 'https://images.example.test/v1/images/generations',
        key: MASKED_PROVIDER_SECRET,
        model: 'image-model',
        size: '1024x1024',
        quality: 'high',
      },
      wavespeedImage: {
        key: MASKED_PROVIDER_SECRET,
        model: 'flux',
        loras: [{ path: 'owner/model', scale: 1.2 }],
      },
      ttsAutoSpeech: true,
      elevenLabKey: MASKED_PROVIDER_SECRET,
      voicevoxUrl: 'https://voicevox.example.test',
      fishSpeechKey: MASKED_PROVIDER_SECRET,
      emotionProcesser: 'embedding',
      hypaV3: true,
      hypaV3PresetId: 0,
      hypaV3Presets: [
        {
          name: 'Fastify memory',
          settings: {
            summarizationModel: 'subModel',
            summarizationPrompt: 'Summarize',
            recentMemoryRatio: 0.4,
            similarMemoryRatio: 0.5,
          },
        },
      ],
      hypaModel: 'custom',
      hypaV3Key: MASKED_PROVIDER_SECRET,
      hypaCustomSettings: {
        url: 'https://embedding.example.test/v1/embeddings',
        key: MASKED_PROVIDER_SECRET,
        model: 'embedding-model',
      },
      voyageApiKey: MASKED_PROVIDER_SECRET,
      username: 'Fastify User',
      didFirstSetup: true,
      moduleIntergration: 'module-ns',
      enableCustomFlags: true,
      customFlags: [8, 21],
      pluginCompatibilityMode: true,
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
    expect(bootstrap.json().database).toMatchObject({ theme: 'dark' })
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

describe('Phase 9-2b bot preset commands', () => {
  it('rejects missing durable ids on public root create commands', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      botPresets: [{ id: 'preset-a', name: 'A' }],
      personas: [{ id: 'persona-a', name: 'A', icon: '', personaPrompt: '', note: '' }],
      translatorPresets: [{ id: 'translator-a', name: 'A', prompt: '', maxResponse: 100 }],
      loadouts: [
        {
          id: 'loadout-a',
          name: 'A',
          lastUsed: 100,
          favorite: false,
          characterIds: [],
          modules: [],
          globalVariables: {},
          presetName: '',
          personaId: '',
        },
      ],
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [],
          chatFolders: [],
          chatPage: 0,
          viewScreen: 'none',
          bias: [],
          emotionImages: [],
          globalLore: [],
          sdData: [],
          customscript: [],
          triggerscript: [],
        },
      ],
      characterOrder: ['char-a'],
      loreBook: [{ id: 'book-a', name: 'A', data: [] }],
      modules: [{ id: 'mod-a', name: 'A', description: '' }],
    })

    const cases = [
      {
        url: '/api/v1/commands/presets',
        payload: { baseRevision: revision, preset: { name: 'Missing id' } },
        error: 'preset.id must be a non-empty string',
      },
      {
        url: '/api/v1/commands/personas',
        payload: { baseRevision: revision, persona: { name: 'Missing id' } },
        error: 'persona.id must be a non-empty string',
      },
      {
        url: '/api/v1/commands/translator-presets',
        payload: { baseRevision: revision, preset: { name: 'Missing id' } },
        error: 'translatorPreset.id must be a non-empty string',
      },
      {
        url: '/api/v1/commands/loadouts',
        payload: { baseRevision: revision, loadout: { name: 'Missing id' } },
        error: 'loadout.id must be a non-empty string',
      },
      {
        url: '/api/v1/commands/characters',
        payload: { baseRevision: revision, character: { name: 'Missing id' } },
        error: 'character.chaId must be a non-empty string',
      },
      {
        url: '/api/v1/commands/characters/char-a/chats',
        payload: { baseRevision: revision, chat: { name: 'Missing id' } },
        error: 'chat.id must be a non-empty string',
      },
      {
        url: '/api/v1/commands/characters/char-a/chat-folders',
        payload: { baseRevision: revision, folder: { name: 'Missing id' } },
        error: 'folder.id must be a non-empty string',
      },
      {
        url: '/api/v1/commands/lorebooks',
        payload: { baseRevision: revision, lorebook: { name: 'Missing id', data: [] } },
        error: 'lorebook.id must be a non-empty string',
      },
      {
        url: '/api/v1/commands/modules',
        payload: { baseRevision: revision, module: { name: 'Missing id' } },
        error: 'module.id must be a non-empty string',
      },
    ]

    for (const testCase of cases) {
      const res = await harness.app.inject({
        method: 'POST',
        url: testCase.url,
        headers: { 'risu-auth': assertion },
        payload: testCase.payload,
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe(testCase.error)
    }

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
  })

  it('creates and updates presets with command events', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      botPresets: [{ id: 'preset-a', name: 'A', mainPrompt: 'a prompt' }],
      botPresetsId: 0,
    })

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/presets',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        preset: { id: 'preset-b', name: 'B', mainPrompt: 'b prompt' },
      },
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toEqual({
      revision: 2,
      event: {
        type: 'preset.created',
        revision: 2,
        resource: 'preset',
        id: 'preset-b',
      },
      presetId: 'preset-b',
    })

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/presets/preset-b',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: created.json().revision,
        patch: { name: 'B renamed' },
      },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().event).toMatchObject({
      type: 'preset.updated',
      resource: 'preset',
      id: 'preset-b',
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database.botPresets).toEqual([
      {
        id: 'preset-a',
        name: 'A',
        mainPrompt: 'a prompt',
        localNetworkMode: false,
        localNetworkTimeoutSec: 600,
      },
      { id: 'preset-b', name: 'B renamed', mainPrompt: 'b prompt' },
    ])
  })

  it('validates preset image asset references on create and patch', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const uploaded = await uploadAsset(harness.app, assertion, Buffer.from('preset-image'))
    const revision = await importDatabase(harness.app, assertion, {
      botPresets: [{ id: 'preset-a', name: 'A', image: '' }],
      botPresetsId: 0,
    })

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/presets',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        preset: { id: 'preset-b', name: 'B', image: uploaded.assetId },
      },
    })
    expect(created.statusCode).toBe(200)

    const patchedValid = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/presets/preset-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: created.json().revision,
        patch: { image: uploaded.assetId },
      },
    })
    expect(patchedValid.statusCode).toBe(200)

    const clearValues: unknown[] = [null, '', '-']
    let baseRevision = patchedValid.json().revision as number
    for (const image of clearValues) {
      const cleared = await harness.app.inject({
        method: 'PATCH',
        url: '/api/v1/commands/presets/preset-a',
        headers: { 'risu-auth': assertion },
        payload: {
          baseRevision,
          patch: { image },
        },
      })
      expect(cleared.statusCode).toBe(200)
      baseRevision = cleared.json().revision as number
    }

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database.botPresets).toEqual([
      {
        id: 'preset-a',
        name: 'A',
        image: '-',
        localNetworkMode: false,
        localNetworkTimeoutSec: 600,
      },
      { id: 'preset-b', name: 'B', image: uploaded.assetId },
    ])
  })

  it('rejects malformed and missing preset image asset refs without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      botPresets: [{ id: 'preset-a', name: 'A', image: '' }],
      botPresetsId: 0,
    })
    const missingAssetId = '0'.repeat(64)

    const malformedCreate = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/presets',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        preset: { id: 'preset-b', name: 'B', image: 'assets/not-server.png' },
      },
    })
    expect(malformedCreate.statusCode).toBe(400)
    expect(malformedCreate.json().error).toBe('preset.image must be a server asset id')

    const missingCreate = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/presets',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        preset: { id: 'preset-b', name: 'B', image: missingAssetId },
      },
    })
    expect(missingCreate.statusCode).toBe(400)
    expect(missingCreate.json().error).toBe('preset.image references a missing server asset')

    const malformedImport = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/presets/import',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        preset: { id: 'preset-b', name: 'B', image: 'assets/not-server.png' },
      },
    })
    expect(malformedImport.statusCode).toBe(400)
    expect(malformedImport.json().error).toBe('preset.image must be a server asset id')

    const missingImport = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/presets/import',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        preset: { id: 'preset-b', name: 'B', image: missingAssetId },
      },
    })
    expect(missingImport.statusCode).toBe(400)
    expect(missingImport.json().error).toBe('preset.image references a missing server asset')

    const malformedPatch = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/presets/preset-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { image: 'assets/not-server.png' },
      },
    })
    expect(malformedPatch.statusCode).toBe(400)
    expect(malformedPatch.json().error).toBe('patch.image must be a server asset id')

    const missingPatch = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/presets/preset-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { image: missingAssetId },
      },
    })
    expect(missingPatch.statusCode).toBe(400)
    expect(missingPatch.json().error).toBe('patch.image references a missing server asset')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
    expect(bootstrap.json().database.botPresets).toEqual([
      {
        id: 'preset-a',
        name: 'A',
        image: '',
        localNetworkMode: false,
        localNetworkTimeoutSec: 600,
      },
    ])
  })

  it('selects and applies a preset while saving the previously selected snapshot', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      botPresets: [
        { id: 'preset-a', name: 'A', mainPrompt: 'old saved', temperature: 50 },
        { id: 'preset-b', name: 'B', mainPrompt: 'target prompt', temperature: 90 },
      ],
      botPresetsId: 0,
      mainPrompt: 'current prompt',
      temperature: 72,
    })

    const selected = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/presets/select',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        presetId: 'preset-b',
        saveCurrent: true,
        apply: true,
      },
    })

    expect(selected.statusCode).toBe(200)
    expect(selected.json()).toEqual({
      revision: 2,
      event: {
        type: 'preset.selected',
        revision: 2,
        resource: 'preset',
        id: 'preset-b',
      },
      presetId: 'preset-b',
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database).toMatchObject({
      botPresetsId: 1,
      mainPrompt: 'target prompt',
      temperature: 90,
    })
    expect(bootstrap.json().database.botPresets[0]).toMatchObject({
      id: 'preset-a',
      name: 'A',
      mainPrompt: 'current prompt',
      temperature: 72,
    })
  })

  it('copies, deletes, and reorders presets by id', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      botPresets: [
        { id: 'preset-a', name: 'A', mainPrompt: 'a prompt' },
        { id: 'preset-b', name: 'B', mainPrompt: 'b prompt' },
      ],
      botPresetsId: 0,
    })

    const copied = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/presets/preset-a/copy',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        newPresetId: 'preset-copy',
        name: 'A Copy',
      },
    })
    expect(copied.statusCode).toBe(200)
    const copiedPresetId = copied.json().presetId as string
    expect(copiedPresetId).toBe('preset-copy')
    expect(copied.json().event).toMatchObject({
      type: 'preset.copied',
      resource: 'preset',
      id: copiedPresetId,
    })

    const reordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/presets/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: copied.json().revision,
        presetIds: ['preset-b', copiedPresetId, 'preset-a'],
      },
    })
    expect(reordered.statusCode).toBe(200)
    expect(reordered.json().event.type).toBe('preset.reordered')

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/commands/presets/${copiedPresetId}`,
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: reordered.json().revision,
        presetId: 'preset-b',
        apply: false,
      },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toMatchObject({
      revision: 4,
      event: {
        type: 'preset.deleted',
        revision: 4,
        resource: 'preset',
        id: copiedPresetId,
      },
      presetId: copiedPresetId,
      selectedPresetId: 'preset-b',
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database.botPresets.map((preset: { id: string }) => preset.id)).toEqual(
      ['preset-b', 'preset-a'],
    )
    expect(bootstrap.json().database.botPresetsId).toBe(0)
  })

  it('rejects missing and duplicate preset ids on copy and import', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      botPresets: [
        { id: 'preset-a', name: 'A' },
        { id: 'preset-b', name: 'B' },
      ],
      botPresetsId: 0,
    })

    const cases = [
      {
        url: '/api/v1/commands/presets/preset-a/copy',
        payload: { baseRevision: revision, name: 'Missing id' },
        error: 'newPresetId must be a non-empty string',
      },
      {
        url: '/api/v1/commands/presets/preset-a/copy',
        payload: { baseRevision: revision, newPresetId: 'preset-b', name: 'Duplicate' },
        error: 'Duplicate preset id: preset-b',
      },
      {
        url: '/api/v1/commands/presets/import',
        payload: { baseRevision: revision, preset: { name: 'Missing id' } },
        error: 'preset.id must be a non-empty string',
      },
      {
        url: '/api/v1/commands/presets/import',
        payload: { baseRevision: revision, preset: { id: 'preset-b', name: 'Duplicate' } },
        error: 'Duplicate preset id: preset-b',
      },
    ]

    for (const testCase of cases) {
      const res = await harness.app.inject({
        method: 'POST',
        url: testCase.url,
        headers: { 'risu-auth': assertion },
        payload: testCase.payload,
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe(testCase.error)
    }

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
    expect(bootstrap.json().database.botPresets.map((preset: { id: string }) => preset.id)).toEqual(
      ['preset-a', 'preset-b'],
    )
  })

  it('rejects malformed preset reorder without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      botPresets: [
        { id: 'preset-a', name: 'A' },
        { id: 'preset-b', name: 'B' },
      ],
      botPresetsId: 0,
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/presets/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        presetIds: ['preset-a', 'preset-a'],
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Duplicate preset id: preset-a')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.botPresets.map((preset: { id: string }) => preset.id)).toEqual(
      ['preset-a', 'preset-b'],
    )
  })

  it('returns 404 and 409 for missing presets and stale revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      botPresets: [{ id: 'preset-a', name: 'A' }],
      botPresetsId: 0,
    })

    const missing = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/presets/missing',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { name: 'Nope' },
      },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('Preset not found: missing')

    const stale = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/presets/preset-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: 0,
        patch: { name: 'stale' },
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-2c prompt template and item commands', () => {
  it('patches prompt settings and emits the prompt settings event', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      promptSettings: { sendName: false, maxThoughtTagDepth: -1 },
      jsonSchemaEnabled: false,
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/prompt-settings',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: {
          mainPrompt: 'MAIN',
          jailbreak: 'JB',
          globalNote: 'GN',
          formatingOrder: ['main', 'jailbreak', 'globalNote'],
          promptPreprocess: true,
          presetRegex: [{ id: 'regex-a', type: 'editinput', in: 'hello', out: 'hi' }],
          promptSettings: { sendName: true, maxThoughtTagDepth: 4 },
          jsonSchemaEnabled: true,
          jsonSchema: '{"type":"object"}',
        },
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      revision: 2,
      event: {
        type: 'prompt.settings.updated',
        revision: 2,
        resource: 'prompt',
      },
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database).toMatchObject({
      mainPrompt: 'MAIN',
      jailbreak: 'JB',
      globalNote: 'GN',
      formatingOrder: ['main', 'jailbreak', 'globalNote'],
      promptPreprocess: true,
      presetRegex: [{ id: 'regex-a', type: 'editinput', in: 'hello', out: 'hi' }],
      promptSettings: { sendName: true, maxThoughtTagDepth: 4 },
      jsonSchemaEnabled: true,
      jsonSchema: '{"type":"object"}',
    })
  })

  it('creates, updates, deletes, and reorders prompt items by stable id', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      promptTemplate: [{ id: 'item-a', type: 'description' }],
    })

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/prompt-items',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        promptItem: {
          id: 'item-b',
          type: 'plain',
          type2: 'normal',
          text: 'hello',
          role: 'system',
        },
      },
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toEqual({
      revision: 2,
      event: {
        type: 'prompt.item.created',
        revision: 2,
        resource: 'promptItem',
        id: 'item-b',
      },
      itemId: 'item-b',
    })

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/prompt-items/item-b',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: created.json().revision,
        patch: {
          type: 'plain',
          type2: 'normal',
          text: 'updated',
          role: 'user',
        },
      },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().event).toMatchObject({
      type: 'prompt.item.updated',
      resource: 'promptItem',
      id: 'item-b',
    })

    const reordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/prompt-items/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: updated.json().revision,
        itemIds: ['item-b', 'item-a'],
      },
    })
    expect(reordered.statusCode).toBe(200)
    expect(reordered.json().event).toMatchObject({
      type: 'prompt.item.reordered',
      resource: 'promptItem',
    })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/prompt-items/item-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: reordered.json().revision,
      },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json().event).toMatchObject({
      type: 'prompt.item.deleted',
      resource: 'promptItem',
      id: 'item-a',
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database.promptTemplate).toEqual([
      {
        id: 'item-b',
        type: 'plain',
        type2: 'normal',
        text: 'updated',
        role: 'user',
      },
    ])
  })

  it('rejects malformed prompt commands without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      promptTemplate: [
        { id: 'item-a', type: 'description' },
        { id: 'item-b', type: 'memory' },
      ],
    })

    const settings = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/prompt-settings',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { jsonSchemaEnabled: 'yes' },
      },
    })
    expect(settings.statusCode).toBe(400)
    expect(settings.json().error).toBe('jsonSchemaEnabled must be a boolean')

    const promptTemplateSettings = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/prompt-settings',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { promptTemplate: [] },
      },
    })
    expect(promptTemplateSettings.statusCode).toBe(400)
    expect(promptTemplateSettings.json().error).toBe('Unsupported prompt setting: promptTemplate')

    const missingId = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/prompt-items',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        promptItem: { type: 'memory' },
      },
    })
    expect(missingId.statusCode).toBe(400)
    expect(missingId.json().error).toBe('promptItem.id must be a non-empty string')

    const duplicateCreate = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/prompt-items',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        promptItem: { id: 'item-a', type: 'memory' },
      },
    })
    expect(duplicateCreate.statusCode).toBe(400)
    expect(duplicateCreate.json().error).toBe('Duplicate prompt item id: item-a')

    const reorder = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/prompt-items/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        itemIds: ['item-a', 'item-a'],
      },
    })
    expect(reorder.statusCode).toBe(400)
    expect(reorder.json().error).toBe('Duplicate prompt item id: item-a')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.promptTemplate.map((item: { id: string }) => item.id)).toEqual(
      ['item-a', 'item-b'],
    )
  })

  it('enables and disables prompt items through prompt-item commands', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {})

    const enabled = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/prompt-items/enable',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        enabled: true,
      },
    })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.json()).toMatchObject({
      revision: 2,
      event: { type: 'prompt.item.enabled', resource: 'promptItem' },
      enabled: true,
    })

    const disabled = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/prompt-items/enable',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: enabled.json().revision,
        enabled: false,
      },
    })
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json()).toMatchObject({ revision: 3, enabled: false })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database.promptTemplate).toBeUndefined()
  })

  it('returns 404 and 409 for missing prompt items and stale revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      promptTemplate: [{ id: 'item-a', type: 'description' }],
    })

    const missing = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/prompt-items/missing',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { type: 'memory' },
      },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('Prompt item not found: missing')

    const stale = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/prompt-items/item-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: 0,
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-2d persona commands', () => {
  it('creates, updates, deletes, and reorders personas by stable id', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const personaIconId = seedAssetMetadata(harness.dataDir)
    const revision = await importDatabase(harness.app, assertion, {
      username: 'Current',
      userIcon: 'assets/current.png',
      personaPrompt: 'Current prompt',
      userNote: 'Current note',
      personas: [
        {
          id: 'persona-a',
          name: 'A',
          icon: '',
          personaPrompt: 'a prompt',
          note: 'a note',
        },
      ],
      selectedPersona: 0,
    })

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/personas',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        persona: {
          id: 'persona-b',
          name: 'B',
          icon: personaIconId,
          personaPrompt: 'b prompt',
          note: 'b note',
        },
      },
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toEqual({
      revision: 2,
      event: {
        type: 'persona.created',
        revision: 2,
        resource: 'persona',
        id: 'persona-b',
      },
      personaId: 'persona-b',
    })

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/personas/persona-b',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: created.json().revision,
        patch: { name: 'B renamed', largePortrait: true },
      },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().event).toMatchObject({
      type: 'persona.updated',
      resource: 'persona',
      id: 'persona-b',
    })

    const reordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/personas/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: updated.json().revision,
        personaIds: ['persona-b', 'persona-a'],
      },
    })
    expect(reordered.statusCode).toBe(200)
    expect(reordered.json()).toEqual({
      revision: 4,
      event: {
        type: 'persona.reordered',
        revision: 4,
        resource: 'persona',
      },
      selectedPersonaId: 'persona-a',
    })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/personas/persona-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: reordered.json().revision,
        selectPersonaId: 'persona-b',
        mirrorLegacyProfile: true,
      },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toMatchObject({
      revision: 5,
      event: {
        type: 'persona.deleted',
        revision: 5,
        resource: 'persona',
        id: 'persona-a',
      },
      personaId: 'persona-a',
      selectedPersonaId: 'persona-b',
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database).toMatchObject({
      username: 'B renamed',
      userIcon: personaIconId,
      personaPrompt: 'b prompt',
      userNote: 'b note',
      selectedPersona: 0,
    })
    expect(bootstrap.json().database.personas).toEqual([
      {
        id: 'persona-b',
        name: 'B renamed',
        icon: personaIconId,
        personaPrompt: 'b prompt',
        note: 'b note',
        largePortrait: true,
      },
    ])
  })

  it('selects a persona while saving the previous legacy profile mirror fields', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const personaIconId = seedAssetMetadata(harness.dataDir)
    const revision = await importDatabase(harness.app, assertion, {
      username: 'Edited A',
      userIcon: 'assets/edited-a.png',
      personaPrompt: 'edited a prompt',
      userNote: 'edited a note',
      personas: [
        { id: 'persona-a', name: 'A', icon: '', personaPrompt: 'a prompt', note: '' },
        {
          id: 'persona-b',
          name: 'B',
          icon: personaIconId,
          personaPrompt: 'b prompt',
          note: 'b note',
        },
      ],
      selectedPersona: 0,
    })

    const selected = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/personas/select',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        personaId: 'persona-b',
        saveCurrent: true,
        mirrorLegacyProfile: true,
      },
    })

    expect(selected.statusCode).toBe(200)
    expect(selected.json()).toEqual({
      revision: 2,
      event: {
        type: 'persona.selected',
        revision: 2,
        resource: 'persona',
        id: 'persona-b',
      },
      personaId: 'persona-b',
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database).toMatchObject({
      selectedPersona: 1,
      username: 'B',
      userIcon: personaIconId,
      personaPrompt: 'b prompt',
      userNote: 'b note',
    })
    expect(bootstrap.json().database.personas[0]).toMatchObject({
      id: 'persona-a',
      name: 'Edited A',
      icon: 'assets/edited-a.png',
      personaPrompt: 'edited a prompt',
      note: 'edited a note',
    })
  })

  it('rejects malformed persona commands without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      personas: [
        { id: 'persona-a', name: 'A', icon: '', personaPrompt: 'a prompt', note: '' },
        { id: 'persona-b', name: 'B', icon: '', personaPrompt: 'b prompt', note: '' },
      ],
      selectedPersona: 0,
    })

    const update = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/personas/persona-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { largePortrait: 'yes' },
      },
    })
    expect(update.statusCode).toBe(400)
    expect(update.json().error).toBe('patch.largePortrait must be a boolean')

    const reorder = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/personas/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        personaIds: ['persona-a', 'persona-a'],
      },
    })
    expect(reorder.statusCode).toBe(400)
    expect(reorder.json().error).toBe('Duplicate persona id: persona-a')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.personas.map((persona: { id: string }) => persona.id)).toEqual(
      ['persona-a', 'persona-b'],
    )
  })

  it('returns 404 and 409 for missing personas and stale revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      personas: [{ id: 'persona-a', name: 'A', icon: '', personaPrompt: 'a prompt', note: '' }],
      selectedPersona: 0,
    })

    const missing = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/personas/missing',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { name: 'Nope' },
      },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('Persona not found: missing')

    const stale = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/personas/persona-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: 0,
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-2e translator preset commands', () => {
  it('creates, updates, deletes, and selects translator presets by stable id', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      translatorPresets: [
        {
          id: 'translator-a',
          name: 'A',
          prompt: 'translate to A',
          maxResponse: 100,
        },
      ],
      translatorPresetId: 0,
      translatorPrompt: 'translate to A',
      translatorMaxResponse: 100,
    })

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/translator-presets',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        preset: {
          id: 'translator-b',
          name: 'B',
          prompt: 'translate to B',
          maxResponse: 200,
        },
        select: true,
      },
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toEqual({
      revision: 2,
      event: {
        type: 'translatorPreset.created',
        revision: 2,
        resource: 'translatorPreset',
        id: 'translator-b',
      },
      presetId: 'translator-b',
    })

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/translator-presets/translator-b',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: created.json().revision,
        patch: {
          name: 'B renamed',
          prompt: 'translate to B updated',
          maxResponse: 250,
        },
      },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().event).toMatchObject({
      type: 'translatorPreset.updated',
      resource: 'translatorPreset',
      id: 'translator-b',
    })

    const selected = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/translator-presets/select',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: updated.json().revision,
        presetId: 'translator-a',
      },
    })
    expect(selected.statusCode).toBe(200)
    expect(selected.json()).toEqual({
      revision: 4,
      event: {
        type: 'translatorPreset.selected',
        revision: 4,
        resource: 'translatorPreset',
        id: 'translator-a',
      },
      presetId: 'translator-a',
    })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/translator-presets/translator-b',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: selected.json().revision,
        selectPresetId: 'translator-a',
      },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toMatchObject({
      revision: 5,
      event: {
        type: 'translatorPreset.deleted',
        revision: 5,
        resource: 'translatorPreset',
        id: 'translator-b',
      },
      presetId: 'translator-b',
      selectedPresetId: 'translator-a',
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database).toMatchObject({
      translatorPresetId: 0,
      translatorPrompt: 'translate to A',
      translatorMaxResponse: 100,
    })
    expect(bootstrap.json().database.translatorPresets).toEqual([
      {
        id: 'translator-a',
        name: 'A',
        prompt: 'translate to A',
        maxResponse: 100,
      },
    ])
  })

  it('syncs legacy translator fields when updating the selected preset', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      translatorPresets: [
        { id: 'translator-a', name: 'A', prompt: 'old prompt', maxResponse: 100 },
      ],
      translatorPresetId: 0,
      translatorPrompt: 'old prompt',
      translatorMaxResponse: 100,
    })

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/translator-presets/translator-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: {
          prompt: 'new prompt',
          maxResponse: 321,
        },
      },
    })
    expect(updated.statusCode).toBe(200)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database).toMatchObject({
      translatorPrompt: 'new prompt',
      translatorMaxResponse: 321,
    })
  })

  it('rejects malformed translator preset commands without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      translatorPresets: [
        { id: 'translator-a', name: 'A', prompt: 'a prompt', maxResponse: 100 },
        { id: 'translator-b', name: 'B', prompt: 'b prompt', maxResponse: 200 },
      ],
      translatorPresetId: 0,
    })

    const update = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/translator-presets/translator-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { maxResponse: 'large' },
      },
    })
    expect(update.statusCode).toBe(400)
    expect(update.json().error).toBe('patch.maxResponse must be a finite number')

    const create = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/translator-presets',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        preset: {
          id: 'translator-a',
          name: 'Duplicate',
          prompt: '',
          maxResponse: 100,
        },
      },
    })
    expect(create.statusCode).toBe(400)
    expect(create.json().error).toBe('Duplicate translator preset id: translator-a')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(
      bootstrap.json().database.translatorPresets.map((preset: { id: string }) => preset.id),
    ).toEqual(['translator-a', 'translator-b'])
  })

  it('returns 404 and 409 for missing translator presets and stale revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      translatorPresets: [{ id: 'translator-a', name: 'A', prompt: 'a prompt', maxResponse: 100 }],
      translatorPresetId: 0,
    })

    const missing = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/translator-presets/missing',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { name: 'Nope' },
      },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('Translator preset not found: missing')

    const stale = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/translator-presets/select',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: 0,
        presetId: 'translator-a',
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-2f loadout commands', () => {
  it('creates, updates, favorites, touches, and deletes loadouts by stable id', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      loadouts: [
        {
          id: 'loadout-a',
          name: 'A',
          lastUsed: 100,
          favorite: false,
          characterIds: ['char-a'],
          modules: ['module-a'],
          globalVariables: { mood: 'calm' },
          presetName: 'Preset A',
          personaId: 'persona-a',
        },
      ],
      lastLoadedLoadoutName: '',
    })

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/loadouts',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        loadout: {
          id: 'loadout-b',
          name: 'B',
          lastUsed: 200,
          favorite: false,
          characterIds: [],
          modules: ['module-b'],
          globalVariables: { tone: 'warm' },
          presetName: 'Preset B',
          personaId: 'persona-b',
        },
      },
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toEqual({
      revision: 2,
      event: {
        type: 'loadout.created',
        revision: 2,
        resource: 'loadout',
        id: 'loadout-b',
      },
      loadoutId: 'loadout-b',
    })

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/loadouts/loadout-b',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: created.json().revision,
        patch: {
          name: 'B renamed',
          globalVariables: { tone: 'bright' },
        },
      },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().event).toMatchObject({
      type: 'loadout.updated',
      resource: 'loadout',
      id: 'loadout-b',
    })

    const favorited = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/loadouts/loadout-b/favorite',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: updated.json().revision,
        favorite: true,
      },
    })
    expect(favorited.statusCode).toBe(200)
    expect(favorited.json().event).toMatchObject({
      type: 'loadout.favorited',
      resource: 'loadout',
      id: 'loadout-b',
    })

    const touched = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/loadouts/loadout-b/touch',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: favorited.json().revision,
        lastUsed: 300,
        characterId: 'char-c',
      },
    })
    expect(touched.statusCode).toBe(200)
    expect(touched.json()).toEqual({
      revision: 5,
      event: {
        type: 'loadout.touched',
        revision: 5,
        resource: 'loadout',
        id: 'loadout-b',
      },
      loadoutId: 'loadout-b',
    })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/loadouts/loadout-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: touched.json().revision,
      },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toEqual({
      revision: 6,
      event: {
        type: 'loadout.deleted',
        revision: 6,
        resource: 'loadout',
        id: 'loadout-a',
      },
      loadoutId: 'loadout-a',
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database).toMatchObject({
      lastLoadedLoadoutName: 'B renamed',
    })
    expect(bootstrap.json().database.loadouts).toEqual([
      {
        id: 'loadout-b',
        name: 'B renamed',
        lastUsed: 300,
        favorite: true,
        characterIds: ['char-c'],
        modules: ['module-b'],
        globalVariables: { tone: 'bright' },
        presetName: 'Preset B',
        personaId: 'persona-b',
      },
    ])
  })

  it('rejects malformed loadout commands without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      loadouts: [
        {
          id: 'loadout-a',
          name: 'A',
          lastUsed: 100,
          favorite: false,
          characterIds: [],
          modules: [],
          globalVariables: {},
          presetName: '',
          personaId: '',
        },
      ],
    })

    const update = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/loadouts/loadout-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { lastUsed: 'recently' },
      },
    })
    expect(update.statusCode).toBe(400)
    expect(update.json().error).toBe('patch.lastUsed must be a finite number')

    const create = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/loadouts',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        loadout: {
          id: 'loadout-a',
          name: 'Duplicate',
          lastUsed: 200,
          favorite: false,
          characterIds: [],
          modules: [],
          globalVariables: {},
          presetName: '',
          personaId: '',
        },
      },
    })
    expect(create.statusCode).toBe(400)
    expect(create.json().error).toBe('Duplicate loadout id: loadout-a')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.loadouts).toEqual([
      {
        id: 'loadout-a',
        name: 'A',
        lastUsed: 100,
        favorite: false,
        characterIds: [],
        modules: [],
        globalVariables: {},
        presetName: '',
        personaId: '',
      },
    ])
  })

  it('returns 404 and 409 for missing loadouts and stale revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      loadouts: [
        {
          id: 'loadout-a',
          name: 'A',
          lastUsed: 100,
          favorite: false,
          characterIds: [],
          modules: [],
          globalVariables: {},
          presetName: '',
          personaId: '',
        },
      ],
    })

    const missing = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/loadouts/missing/favorite',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        favorite: true,
      },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('Loadout not found: missing')

    const stale = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/loadouts/loadout-a/touch',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: 0,
        lastUsed: 200,
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-3a character commands', () => {
  it('adds writer origin only to live command events', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      currentChar: 0,
      characters: [
        { chaId: 'char-a', name: 'A', chats: [] },
        { chaId: 'char-b', name: 'B', chats: [] },
      ],
      characterOrder: ['char-a', 'char-b'],
    })
    harness.commandEvents.clear()

    const selected = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/select',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
      payload: {
        baseRevision: revision,
        characterId: 'char-b',
        lastInteraction: 4321,
      },
    })

    expect(selected.statusCode).toBe(200)
    expect(selected.json().event).toEqual({
      type: 'character.selected',
      revision: revision + 1,
      resource: 'characterSelection',
      id: 'char-b',
    })
    expect(harness.commandEvents.list()).toEqual([
      {
        ...selected.json().event,
        origin: { writerSessionId: 'writer-a' },
      },
    ])
  })

  it('selects a character without rewriting unrelated character or chat rows', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      currentChar: 0,
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            { id: 'chat-a-1', name: 'A1', message: [] },
            { id: 'chat-a-2', name: 'A2', message: [] },
          ],
        },
        {
          chaId: 'char-b',
          name: 'B',
          chats: [{ id: 'chat-b-1', name: 'B1', message: [] }],
        },
      ],
      characterOrder: ['char-a', 'char-b'],
    })
    const characterRowsBefore = tableRowidsById(harness.dataDir, 'characters')
    const chatRowsBefore = tableRowidsById(harness.dataDir, 'chats')

    const selected = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/select',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        characterId: 'char-b',
        lastInteraction: 4321,
      },
    })

    expect(selected.statusCode).toBe(200)
    // Targeted selection UPDATEs only char-b's row + settings, so no character
    // or chat row is rewritten (every rowid stays put).
    assertOnlyRowsWritten(characterRowsBefore, tableRowidsById(harness.dataDir, 'characters'))
    assertOnlyRowsWritten(chatRowsBefore, tableRowidsById(harness.dataDir, 'chats'))
    expect(loadPersistedFromDir(harness.dataDir).database).toMatchObject({
      currentChar: 1,
      characters: [{ chaId: 'char-a' }, { chaId: 'char-b', lastInteraction: 4321 }],
    })
  })

  it('creates, updates, selects, reorders, and deletes characters by chaId', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      currentChar: 0,
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          firstMessage: 'hello',
          desc: 'desc a',
          chats: [],
          chatFolders: [],
          chatPage: 0,
          viewScreen: 'none',
          bias: [],
          emotionImages: [],
          globalLore: [],
          sdData: [],
          customscript: [],
          triggerscript: [],
          utilityBot: false,
          exampleMessage: '',
          creatorNotes: '',
          systemPrompt: '',
          postHistoryInstructions: '',
          alternateGreetings: [],
          tags: [],
          creator: '',
          characterVersion: '',
          personality: '',
          scenario: '',
          firstMsgIndex: -1,
          replaceGlobalNote: '',
          additionalText: '',
        },
      ],
      characterOrder: ['char-a'],
    })

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        character: {
          chaId: 'char-b',
          name: 'B',
          firstMessage: 'hi',
          desc: 'desc b',
          chats: [],
          chatFolders: [],
          chatPage: 0,
          viewScreen: 'none',
          bias: [],
          emotionImages: [],
          globalLore: [],
          sdData: [],
          customscript: [],
          triggerscript: [],
          utilityBot: false,
          exampleMessage: '',
          creatorNotes: '',
          systemPrompt: '',
          postHistoryInstructions: '',
          alternateGreetings: [],
          tags: [],
          creator: '',
          characterVersion: '',
          personality: '',
          scenario: '',
          firstMsgIndex: -1,
          replaceGlobalNote: '',
          additionalText: '',
        },
      },
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toEqual({
      revision: 2,
      event: {
        type: 'character.created',
        revision: 2,
        resource: 'character',
        id: 'char-b',
      },
      characterId: 'char-b',
    })

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/characters/char-b',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: created.json().revision,
        patch: {
          name: 'B renamed',
          desc: 'new desc',
          systemPrompt: 'new system prompt',
          ttsMode: 'openai',
          oaiTTSConfig: { enabled: true, voice: 'alloy', model: 'tts-1', format: 'mp3' },
          depth_prompt: { depth: 2, prompt: 'stay close' },
          trashTime: 1000,
        },
      },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().event).toMatchObject({
      type: 'character.updated',
      resource: 'character',
      id: 'char-b',
    })
    expect(
      ((loadPersistedFromDir(harness.dataDir).database as any).characters as Array<Record<string, unknown>>).find(
        (character) => character.chaId === 'char-b',
      ),
    ).toMatchObject({
      name: 'B renamed',
      systemPrompt: 'new system prompt',
      ttsMode: 'openai',
      oaiTTSConfig: { enabled: true, voice: 'alloy', model: 'tts-1', format: 'mp3' },
      depth_prompt: { depth: 2, prompt: 'stay close' },
    })

    const restored = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/characters/char-b',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: updated.json().revision,
        patch: {
          trashTime: null,
        },
      },
    })
    expect(restored.statusCode).toBe(200)

    const selected = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/select',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: restored.json().revision,
        characterId: 'char-b',
        lastInteraction: 4321,
      },
    })
    expect(selected.statusCode).toBe(200)
    expect(selected.json()).toEqual({
      revision: 5,
      event: {
        type: 'character.selected',
        revision: 5,
        resource: 'characterSelection',
        id: 'char-b',
      },
      characterId: 'char-b',
    })
    expect(
      ((loadPersistedFromDir(harness.dataDir).database as any).characters as Array<Record<string, unknown>>).find(
        (character) => character.chaId === 'char-b',
      ),
    ).toMatchObject({
      lastInteraction: 4321,
    })

    const reordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: selected.json().revision,
        characterOrder: [
          {
            id: 'folder-a',
            name: 'Folder A',
            color: 'blue',
            data: ['char-b'],
          },
          'char-a',
        ],
      },
    })
    expect(reordered.statusCode).toBe(200)
    expect(reordered.json()).toEqual({
      revision: 6,
      event: {
        type: 'character.reordered',
        revision: 6,
        resource: 'character',
      },
      selectedCharacterId: 'char-b',
    })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/characters/char-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: reordered.json().revision,
      },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toEqual({
      revision: 7,
      event: {
        type: 'character.deleted',
        revision: 7,
        resource: 'character',
        id: 'char-a',
      },
      characterId: 'char-a',
      selectedCharacterId: 'char-b',
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database.currentChar).toBe(0)
    expect(bootstrap.json().database.characters).toMatchObject([
      {
        chaId: 'char-b',
        name: 'B renamed',
        desc: 'new desc',
      },
    ])
    expect(bootstrap.json().database.characterOrder).toEqual([
      {
        id: 'folder-a',
        name: 'Folder A',
        color: 'blue',
        data: ['char-b'],
      },
    ])
  })

  it('creates and selects a character in one command', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      currentChar: 0,
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [],
          chatFolders: [],
        },
      ],
      characterOrder: ['char-a'],
    })

    const createdAndSelected = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/create-and-select',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        character: {
          chaId: 'char-b',
          name: 'B',
          chats: [],
          chatFolders: [],
        },
        lastInteraction: 9876,
      },
    })

    expect(createdAndSelected.statusCode).toBe(200)
    expect(createdAndSelected.json()).toEqual({
      revision: revision + 1,
      event: {
        type: 'character.createdAndSelected',
        revision: revision + 1,
        resource: 'character',
        id: 'char-b',
      },
      characterId: 'char-b',
    })
    expect(loadPersistedFromDir(harness.dataDir).database).toMatchObject({
      currentChar: 1,
      characterOrder: ['char-a', 'char-b'],
    })
    expect(
      ((loadPersistedFromDir(harness.dataDir).database as any).characters as Array<Record<string, unknown>>).find(
        (character) => character.chaId === 'char-b',
      ),
    ).toMatchObject({
      name: 'B',
      lastInteraction: 9876,
    })
  })

  it('rejects malformed character commands without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [],
          chatFolders: [],
          trashTime: undefined,
        },
        {
          chaId: 'char-b',
          name: 'B',
          chats: [],
          chatFolders: [],
        },
      ],
      characterOrder: ['char-a', 'char-b'],
    })

    const update = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/characters/char-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { chats: [] },
      },
    })
    expect(update.statusCode).toBe(400)
    expect(update.json().error).toBe('patch.chats is owned by a later command slice')

    const reorder = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        characterOrder: ['char-a', 'char-a'],
      },
    })
    expect(reorder.statusCode).toBe(400)
    expect(reorder.json().error).toBe('Duplicate character id in characterOrder: char-a')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.characterOrder).toEqual(['char-a', 'char-b'])
  })

  it('returns 404 and 409 for missing characters and stale revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [{ chaId: 'char-a', name: 'A', chats: [], chatFolders: [] }],
      characterOrder: ['char-a'],
    })

    const missing = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/characters/missing',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { name: 'Nope' },
      },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('Character not found: missing')

    const stale = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/select',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: 0,
        characterId: 'char-a',
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-3b chat record and folder commands', () => {
  it('creates, updates, forks, reorders, and deletes chats and chat folders by id', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      currentChar: 0,
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            { id: 'chat-a', name: 'A chat', note: '', message: [], localLore: [] },
            {
              id: 'chat-b',
              name: 'B chat',
              note: '',
              message: [],
              localLore: [],
              folderId: 'folder-a',
            },
          ],
          chatFolders: [{ id: 'folder-a', name: 'Folder A', folded: false }],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/chats',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        chat: {
          id: 'chat-c',
          name: 'C chat',
          note: '',
          message: [],
          localLore: [],
        },
        select: true,
      },
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toEqual({
      revision: 2,
      event: {
        type: 'chat.created',
        revision: 2,
        resource: 'chat',
        id: 'chat-c',
        parentId: 'char-a',
      },
      chatId: 'chat-c',
      selectedChatId: 'chat-c',
    })

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-c',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: created.json().revision,
        patch: {
          name: 'C renamed',
          note: 'Author note',
          bookmarks: ['msg-a'],
          bookmarkNames: { 'msg-a': 'Pinned' },
        },
        select: true,
      },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({
      revision: 3,
      event: {
        type: 'chat.updated',
        resource: 'chat',
        id: 'chat-c',
        parentId: 'char-a',
      },
      chatId: 'chat-c',
      selectedChatId: 'chat-c',
    })

    const forked = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/fork',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: updated.json().revision,
        sourcePatch: { folderId: 'folder-a' },
        chat: {
          id: 'chat-fork',
          name: 'A branch',
          note: '',
          message: [{ role: 'char', data: 'branch marker', chatId: 'msg-branch' }],
          localLore: [],
          folderId: 'folder-a',
        },
      },
    })
    expect(forked.statusCode).toBe(200)
    expect(forked.json()).toMatchObject({
      revision: 4,
      event: {
        type: 'chat.forked',
        resource: 'chat',
        id: 'chat-fork',
        parentId: 'char-a',
      },
      chatId: 'chat-fork',
      sourceChatId: 'chat-a',
      selectedChatId: 'chat-fork',
    })

    const reordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/chats/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: forked.json().revision,
        chatIds: ['chat-a', 'chat-fork', 'chat-c', 'chat-b'],
        folderByChatId: {
          'chat-a': 'folder-a',
          'chat-fork': 'folder-a',
          'chat-c': null,
          'chat-b': 'folder-a',
        },
        selectedChatId: 'chat-c',
      },
    })
    expect(reordered.statusCode).toBe(200)
    expect(reordered.json()).toMatchObject({
      revision: 5,
      event: {
        type: 'chat.reordered',
        resource: 'chat',
        parentId: 'char-a',
      },
      selectedChatId: 'chat-c',
    })

    const folderCreated = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/chat-folders',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: reordered.json().revision,
        folder: { id: 'folder-b', name: 'Folder B', color: 'blue', folded: false },
      },
    })
    expect(folderCreated.statusCode).toBe(200)
    expect(folderCreated.json().event).toMatchObject({
      type: 'chatFolder.created',
      resource: 'chatFolder',
      id: 'folder-b',
      parentId: 'char-a',
    })
    const folderUpdated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chat-folders/folder-b',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: folderCreated.json().revision,
        patch: { name: 'Folder B renamed', folded: true },
      },
    })
    expect(folderUpdated.statusCode).toBe(200)

    const foldersReordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/chat-folders/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: folderUpdated.json().revision,
        folderIds: ['folder-a', 'folder-b'],
        selectedChatId: 'chat-c',
      },
    })
    expect(foldersReordered.statusCode).toBe(200)

    const folderDeleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/chat-folders/folder-a',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: foldersReordered.json().revision },
    })
    expect(folderDeleted.statusCode).toBe(200)

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/chats/chat-b',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: folderDeleted.json().revision },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toMatchObject({
      revision: 10,
      event: {
        type: 'chat.deleted',
        resource: 'chat',
        id: 'chat-b',
        parentId: 'char-a',
      },
      chatId: 'chat-b',
      selectedChatId: 'chat-c',
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    const character = bootstrap.json().database.characters[0]
    expect(character.chatPage).toBe(2)
    expect(character.chats.map((chat: { id: string }) => chat.id)).toEqual([
      'chat-a',
      'chat-fork',
      'chat-c',
    ])
    expect(
      character.chats.map((chat: { folderId?: string | null }) => chat.folderId ?? null),
    ).toEqual([null, null, null])
    expect(character.chatFolders).toEqual([
      { id: 'folder-b', name: 'Folder B renamed', color: 'blue', folded: true },
    ])
    expect(character.chats[2]).toMatchObject({
      id: 'chat-c',
      name: 'C renamed',
      note: 'Author note',
      bookmarks: ['msg-a'],
      bookmarkNames: { 'msg-a': 'Pinned' },
    })
  })

  it('updates chat metadata without rewriting message rows', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [
                { role: 'user', data: 'hello', chatId: 'msg-a' },
                { role: 'char', data: 'hi', chatId: 'msg-b' },
              ],
              localLore: [],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const beforeRows = activeMessageRowids(harness.dataDir, 'chat-a')
    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: {
          name: 'A renamed',
          note: 'metadata only',
          bookmarks: ['msg-a'],
          bookmarkNames: { 'msg-a': 'Pinned' },
        },
      },
    })

    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({
      revision: 2,
      event: {
        type: 'chat.updated',
        resource: 'chat',
        id: 'chat-a',
        parentId: 'char-a',
      },
      chatId: 'chat-a',
      selectedChatId: 'chat-a',
    })
    expect(activeMessageRowids(harness.dataDir, 'chat-a')).toEqual(beforeRows)
    await expect(persistedChatMessages(harness.app, assertion, 'chat-a')).resolves.toEqual([
      { role: 'user', data: 'hello', chatId: 'msg-a' },
      { role: 'char', data: 'hi', chatId: 'msg-b' },
    ])

    const persisted = loadPersistedFromDir(harness.dataDir) as {
      database: { characters: Array<{ chats: Array<Record<string, unknown>> }> }
    }
    expect(persisted.database.characters[0].chats[0]).toMatchObject({
      id: 'chat-a',
      name: 'A renamed',
      note: 'metadata only',
      bookmarks: ['msg-a'],
      bookmarkNames: { 'msg-a': 'Pinned' },
    })
  })

  it('rejects chat fork commands without client-supplied fork ids without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            { id: 'chat-a', name: 'A chat', note: '', message: [], localLore: [] },
            { id: 'chat-b', name: 'B chat', note: '', message: [], localLore: [] },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const omittedChat = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/fork',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
      },
    })
    expect(omittedChat.statusCode).toBe(400)
    expect(omittedChat.json().error).toBe('chat must be an object')

    const missingChatId = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/fork',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        chat: {
          name: 'Fork without id',
          note: '',
          message: [],
          localLore: [],
        },
      },
    })
    expect(missingChatId.statusCode).toBe(400)
    expect(missingChatId.json().error).toBe('chat.id must be a non-empty string')

    const duplicateChatId = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/fork',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        chat: {
          id: 'chat-b',
          name: 'Duplicate fork',
          note: '',
          message: [],
          localLore: [],
        },
      },
    })
    expect(duplicateChatId.statusCode).toBe(400)
    expect(duplicateChatId.json().error).toBe('Duplicate chat id: chat-b')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
    expect(
      bootstrap.json().database.characters[0].chats.map((chat: { id: string }) => chat.id),
    ).toEqual(['chat-a', 'chat-b'])
  })

  it('repairs imported duplicate chat ids across characters', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [{ id: 'chat-shared', name: 'A chat', note: '', message: [], localLore: [] }],
          chatFolders: [],
          chatPage: 0,
        },
        {
          chaId: 'char-b',
          name: 'B',
          chats: [{ id: 'chat-shared', name: 'B chat', note: '', message: [], localLore: [] }],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a', 'char-b'],
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
    const [charA, charB] = bootstrap.json().database.characters
    expect(charA.chats[0].id).toBe('chat-shared')
    expect(charB.chats[0].id).not.toBe('chat-shared')
    expect(typeof charB.chats[0].id).toBe('string')
  })

  it('rejects command-created chat ids and message ids already used by another character', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [{ role: 'user', data: 'hello', chatId: 'msg-a' }],
              localLore: [],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
        {
          chaId: 'char-b',
          name: 'B',
          chats: [{ id: 'chat-b', name: 'B chat', note: '', message: [], localLore: [] }],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a', 'char-b'],
    })

    const duplicateCreate = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-b/chats',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        chat: { id: 'chat-a', name: 'Duplicate', note: '', message: [], localLore: [] },
      },
    })
    expect(duplicateCreate.statusCode).toBe(400)
    expect(duplicateCreate.json().error).toBe('Duplicate chat id: chat-a')

    const duplicateFork = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-b/fork',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        chat: { id: 'chat-a', name: 'Duplicate fork', note: '', message: [], localLore: [] },
      },
    })
    expect(duplicateFork.statusCode).toBe(400)
    expect(duplicateFork.json().error).toBe('Duplicate chat id: chat-a')

    const duplicateCreateMessage = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-b/chats',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        chat: {
          id: 'chat-c',
          name: 'Message duplicate',
          note: '',
          message: [{ role: 'char', data: 'duplicate', chatId: 'msg-a' }],
          localLore: [],
        },
      },
    })
    expect(duplicateCreateMessage.statusCode).toBe(400)
    expect(duplicateCreateMessage.json().error).toBe('Duplicate message id: msg-a')

    const duplicateForkMessage = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-b/fork',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        chat: {
          id: 'chat-fork',
          name: 'Message duplicate fork',
          note: '',
          message: [{ role: 'char', data: 'duplicate', chatId: 'msg-a' }],
          localLore: [],
        },
      },
    })
    expect(duplicateForkMessage.statusCode).toBe(400)
    expect(duplicateForkMessage.json().error).toBe('Duplicate message id: msg-a')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
    expect(
      bootstrap
        .json()
        .database.characters.map((character: { chats: { id: string }[] }) =>
          character.chats.map((chat) => chat.id),
        ),
    ).toEqual([['chat-a'], ['chat-b']])
  })

  it('rejects command-created chat folder ids that already exist on another character', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [],
              localLore: [],
              folderId: 'folder-a',
            },
          ],
          chatFolders: [{ id: 'folder-a', name: 'Folder A', folded: false }],
          chatPage: 0,
        },
        {
          chaId: 'char-b',
          name: 'B',
          chats: [
            {
              id: 'chat-b',
              name: 'B chat',
              note: '',
              message: [],
              localLore: [],
              folderId: 'folder-b',
            },
          ],
          chatFolders: [{ id: 'folder-b', name: 'Folder B', folded: false }],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a', 'char-b'],
    })

    const duplicateFolderCreate = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-b/chat-folders',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        folder: { id: 'folder-a', name: 'Duplicate Folder A', folded: false },
      },
    })
    expect(duplicateFolderCreate.statusCode).toBe(400)
    expect(duplicateFolderCreate.json().error).toBe('Duplicate chat folder id: folder-a')

    const duplicateForkFolder = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-b/fork',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        chat: {
          id: 'chat-fork',
          name: 'Fork',
          note: '',
          message: [],
          localLore: [],
        },
        folder: { id: 'folder-a', name: 'Duplicate Fork Folder', folded: false },
      },
    })
    expect(duplicateForkFolder.statusCode).toBe(400)
    expect(duplicateForkFolder.json().error).toBe('Duplicate chat folder id: folder-a')

    const folderUpdated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chat-folders/folder-b',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { name: 'Folder B renamed' },
      },
    })
    expect(folderUpdated.statusCode).toBe(200)

    const folderDeleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/chat-folders/folder-a',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: folderUpdated.json().revision },
    })
    expect(folderDeleted.statusCode).toBe(200)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    const characters = bootstrap.json().database.characters
    expect(characters[0].chatFolders).toEqual([])
    expect(characters[0].chats[0].folderId).toBeNull()
    expect(characters[1].chatFolders).toEqual([
      { id: 'folder-b', name: 'Folder B renamed', folded: false },
    ])
    expect(characters[1].chats[0].folderId).toBe('folder-b')
  })

  it('repairs imported duplicate chat folder ids across characters', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [],
              localLore: [],
              folderId: 'folder-a',
            },
          ],
          chatFolders: [{ id: 'folder-a', name: 'Folder A', folded: false }],
          chatPage: 0,
        },
        {
          chaId: 'char-b',
          name: 'B',
          chats: [
            {
              id: 'chat-b',
              name: 'B chat',
              note: '',
              message: [],
              localLore: [],
              folderId: 'folder-a',
            },
          ],
          chatFolders: [{ id: 'folder-a', name: 'Folder B', folded: false }],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a', 'char-b'],
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
    const [charA, charB] = bootstrap.json().database.characters
    expect(charA.chatFolders[0].id).toBe('folder-a')
    expect(charA.chats[0].folderId).toBe('folder-a')
    expect(charB.chatFolders[0].id).not.toBe('folder-a')
    expect(typeof charB.chatFolders[0].id).toBe('string')
    expect(charB.chats[0].folderId).toBe(charB.chatFolders[0].id)
  })

  it('rejects chat module links to missing and MCP modules without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      modules: [
        { id: 'mod-a', name: 'A', description: '' },
        { id: 'mcp-a', name: 'MCP', description: '', mcp: { url: 'internal:risuai' } },
      ],
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [],
              localLore: [],
              modules: ['mod-a'],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const missingCreate = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/chats',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        chat: {
          id: 'chat-missing',
          name: 'Missing module chat',
          note: '',
          message: [],
          localLore: [],
          modules: ['missing-module'],
        },
      },
    })
    expect(missingCreate.statusCode).toBe(400)
    expect(missingCreate.json().error).toBe('Unknown module id in chat.modules: missing-module')

    const mcpPatch = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { modules: ['mcp-a'] },
      },
    })
    expect(mcpPatch.statusCode).toBe(400)
    expect(mcpPatch.json().error).toBe('Unknown module id in patch.modules: mcp-a')

    const mcpForkSource = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/fork',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        sourcePatch: { modules: ['mcp-a'] },
        chat: {
          id: 'chat-fork',
          name: 'Fork',
          note: '',
          message: [],
          localLore: [],
          modules: ['mod-a'],
        },
      },
    })
    expect(mcpForkSource.statusCode).toBe(400)
    expect(mcpForkSource.json().error).toBe('Unknown module id in sourcePatch.modules: mcp-a')

    const missingForkChat = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/fork',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        chat: {
          id: 'chat-fork',
          name: 'Fork',
          note: '',
          message: [],
          localLore: [],
          modules: ['missing-module'],
        },
      },
    })
    expect(missingForkChat.statusCode).toBe(400)
    expect(missingForkChat.json().error).toBe('Unknown module id in chat.modules: missing-module')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.characters[0].chats).toMatchObject([
      {
        id: 'chat-a',
        name: 'A chat',
        note: '',
        message: [],
        localLore: [],
        modules: ['mod-a'],
      },
    ])
  })

  it('rejects malformed chat commands without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            { id: 'chat-a', name: 'A chat', note: '', message: [], localLore: [] },
            { id: 'chat-b', name: 'B chat', note: '', message: [], localLore: [] },
          ],
          chatFolders: [{ id: 'folder-a', name: 'Folder A', folded: false }],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const patch = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { message: [] },
      },
    })
    expect(patch.statusCode).toBe(400)
    expect(patch.json().error).toBe('patch.message is owned by a later command slice')

    const reorder = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/chats/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        chatIds: ['chat-a', 'chat-a'],
      },
    })
    expect(reorder.statusCode).toBe(400)
    expect(reorder.json().error).toBe('Duplicate chat id in chatIds: chat-a')

    const folder = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/chats/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        chatIds: ['chat-a', 'chat-b'],
        folderByChatId: { 'chat-a': 'missing-folder' },
      },
    })
    expect(folder.statusCode).toBe(400)
    expect(folder.json().error).toBe('Unknown chat folder id in folderByChatId: missing-folder')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(
      bootstrap.json().database.characters[0].chats.map((chat: { id: string }) => chat.id),
    ).toEqual(['chat-a', 'chat-b'])
  })

  it('returns 404 and 409 for missing chats and stale chat revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [{ id: 'chat-a', name: 'A chat', note: '', message: [], localLore: [] }],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const missing = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chats/missing',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { name: 'Nope' },
      },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('Chat not found: missing')

    const stale = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: 0,
        patch: { name: 'Stale' },
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 4 slice 4.2 surgical message writes', () => {
  function messageRowids(dataDir: string, chatId: string): { seq: number; rowid: number }[] {
    const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
    try {
      return db
        .prepare('SELECT rowid, seq FROM messages WHERE chat_id = ? ORDER BY seq')
        .all(chatId) as { seq: number; rowid: number }[]
    } finally {
      db.close()
    }
  }

  async function seedTwoChats(assertion: string): Promise<number> {
    return importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A',
              note: '',
              localLore: [],
              message: [{ role: 'user', data: 'a1', chatId: 'a1' }],
            },
            {
              id: 'chat-b',
              name: 'B',
              note: '',
              localLore: [],
              message: [{ role: 'user', data: 'b1', chatId: 'b1' }],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })
  }

  it('appends one row to the target chat without rewriting an unrelated chat', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await seedTwoChats(assertion)
    const chatBBefore = messageRowids(harness.dataDir, 'chat-b')
    const chatABefore = messageRowids(harness.dataDir, 'chat-a')

    const appended = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/messages',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, message: { role: 'char', data: 'a2', chatId: 'a2' } },
    })
    expect(appended.statusCode).toBe(200)

    // chat-b is physically untouched (same rowids); chat-a kept its existing
    // row and gained exactly one (no whole-chat rewrite).
    expect(messageRowids(harness.dataDir, 'chat-b')).toEqual(chatBBefore)
    const chatAAfter = messageRowids(harness.dataDir, 'chat-a')
    expect(chatAAfter.slice(0, chatABefore.length)).toEqual(chatABefore)
    expect(chatAAfter).toHaveLength(chatABefore.length + 1)
  })

  it('updates, deletes, truncates, and replaces target chat rows without touching unrelated chats', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    let revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A',
              note: '',
              localLore: [],
              message: [
                { role: 'user', data: 'a1', chatId: 'msg-a1' },
                { role: 'char', data: 'a2', chatId: 'msg-a2' },
                { role: 'user', data: 'a3', chatId: 'msg-a3' },
              ],
            },
            {
              id: 'chat-b',
              name: 'B',
              note: '',
              localLore: [],
              message: [
                { role: 'user', data: 'b1', chatId: 'msg-b1' },
                { role: 'char', data: 'b2', chatId: 'msg-b2' },
              ],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })
    const chatBBefore = messageRowids(harness.dataDir, 'chat-b')
    const chatABefore = messageRowids(harness.dataDir, 'chat-a')

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/messages/msg-a2',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { data: 'a2 updated', disabled: true } },
    })
    expect(updated.statusCode).toBe(200)
    revision = updated.json().revision
    expect(messageRowids(harness.dataDir, 'chat-b')).toEqual(chatBBefore)
    expect(messageRowids(harness.dataDir, 'chat-a')).toEqual(chatABefore)

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/messages/msg-a2',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision },
    })
    expect(deleted.statusCode).toBe(200)
    revision = deleted.json().revision
    expect(messageRowids(harness.dataDir, 'chat-b')).toEqual(chatBBefore)
    const afterDelete = messageRowids(harness.dataDir, 'chat-a')
    expect(afterDelete).toHaveLength(2)
    expect(afterDelete[0]).toEqual(chatABefore[0])
    expect(afterDelete.map((row) => row.seq)).toEqual([0, 1])
    expect(
      (await persistedChatMessages(harness.app, assertion, 'chat-a')).map((m) => m.chatId),
    ).toEqual(['msg-a1', 'msg-a3'])

    const appended = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/messages',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        message: { role: 'char', data: 'a4', chatId: 'msg-a4' },
      },
    })
    expect(appended.statusCode).toBe(200)
    revision = appended.json().revision

    const beforeTruncate = messageRowids(harness.dataDir, 'chat-a')
    const truncated = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/messages/truncate',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, afterMessageId: 'msg-a1' },
    })
    expect(truncated.statusCode).toBe(200)
    revision = truncated.json().revision
    expect(messageRowids(harness.dataDir, 'chat-b')).toEqual(chatBBefore)
    const afterTruncate = messageRowids(harness.dataDir, 'chat-a')
    expect(afterTruncate).toEqual([beforeTruncate[0]])

    const replaced = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/chats/chat-a/messages',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        messages: [
          { role: 'user', data: 'a1', chatId: 'msg-a1' },
          { role: 'char', data: 'a5', chatId: 'msg-a5' },
          { role: 'user', data: 'a6', chatId: 'msg-a6' },
        ],
      },
    })
    expect(replaced.statusCode).toBe(200)
    expect(messageRowids(harness.dataDir, 'chat-b')).toEqual(chatBBefore)
    const afterReplace = messageRowids(harness.dataDir, 'chat-a')
    expect(afterReplace).toHaveLength(3)
    expect(afterReplace[0]).toEqual(afterTruncate[0])
    expect(afterReplace.map((row) => row.seq)).toEqual([0, 1, 2])
    expect(
      (await persistedChatMessages(harness.app, assertion, 'chat-a')).map((m) => m.chatId),
    ).toEqual(['msg-a1', 'msg-a5', 'msg-a6'])
  })

  it('a non-message command writes nothing to the messages table', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await seedTwoChats(assertion)
    const before = [
      ...messageRowids(harness.dataDir, 'chat-a'),
      ...messageRowids(harness.dataDir, 'chat-b'),
    ]

    const persona = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/personas',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        persona: { id: 'persona-p', name: 'P', personaPrompt: 'hi', note: '' },
      },
    })
    expect(persona.statusCode).toBe(200)

    const after = [
      ...messageRowids(harness.dataDir, 'chat-a'),
      ...messageRowids(harness.dataDir, 'chat-b'),
    ]
    expect(after).toEqual(before)
  })

  it('deleting a chat drops its message rows', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await seedTwoChats(assertion)
    expect(messageRowids(harness.dataDir, 'chat-b')).toHaveLength(1)

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/chats/chat-b',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision },
    })
    expect(deleted.statusCode).toBe(200)
    expect(messageRowids(harness.dataDir, 'chat-b')).toEqual([])
    expect(messageRowids(harness.dataDir, 'chat-a')).toHaveLength(1)
  })
})

describe('Phase 9-3c message history commands', () => {
  it('appends, updates, deletes, truncates, and replaces messages by id', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [{ role: 'user', data: 'hello', chatId: 'msg-a' }],
              localLore: [],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const appended = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/messages',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        message: { role: 'char', data: 'hi', chatId: 'msg-b' },
      },
    })
    expect(appended.statusCode).toBe(200)
    expect(appended.json()).toEqual({
      revision: 2,
      event: {
        type: 'message.appended',
        revision: 2,
        resource: 'message',
        id: 'msg-b',
        parentId: 'chat-a',
      },
      chatId: 'chat-a',
      messageId: 'msg-b',
    })

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/messages/msg-b',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: appended.json().revision,
        patch: {
          data: 'hi there',
          disabled: true,
          name: 'Assistant',
          promptInfo: { promptName: 'Preset' },
        },
      },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({
      revision: 3,
      event: {
        type: 'message.updated',
        resource: 'message',
        id: 'msg-b',
        parentId: 'chat-a',
      },
      chatId: 'chat-a',
      messageId: 'msg-b',
    })

    const replaced = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/chats/chat-a/messages',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: updated.json().revision,
        messages: [
          { role: 'user', data: 'one', chatId: 'msg-1' },
          { role: 'char', data: 'two', chatId: 'msg-2', generationInfo: { model: 'm' } },
          { role: 'user', data: 'three', chatId: 'msg-3' },
        ],
      },
    })
    expect(replaced.statusCode).toBe(200)
    expect(replaced.json()).toMatchObject({
      revision: 4,
      event: {
        type: 'messages.replaced',
        resource: 'message',
        parentId: 'chat-a',
      },
      chatId: 'chat-a',
    })

    const truncated = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/messages/truncate',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: replaced.json().revision,
        afterMessageId: 'msg-1',
      },
    })
    expect(truncated.statusCode).toBe(200)
    expect(truncated.json()).toMatchObject({
      revision: 5,
      event: {
        type: 'message.truncated',
        resource: 'message',
        parentId: 'chat-a',
      },
      chatId: 'chat-a',
      afterMessageId: 'msg-1',
      removedCount: 2,
    })

    const appendedAgain = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/messages',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: truncated.json().revision,
        message: { role: 'char', data: 'tail', chatId: 'msg-tail' },
      },
    })
    expect(appendedAgain.statusCode).toBe(200)

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/messages/msg-tail',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: appendedAgain.json().revision },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toMatchObject({
      revision: 7,
      event: {
        type: 'message.deleted',
        resource: 'message',
        id: 'msg-tail',
        parentId: 'chat-a',
      },
      chatId: 'chat-a',
      messageId: 'msg-tail',
    })

    expect(await persistedChatMessages(harness.app, assertion, 'chat-a')).toEqual([
      { role: 'user', data: 'one', chatId: 'msg-1' },
    ])
  })

  it('normalizes missing message ids and rejects malformed message commands without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [
                { role: 'user', data: 'missing id' },
                { role: 'char', data: 'duplicate a', chatId: 'dup' },
                { role: 'user', data: 'duplicate b', chatId: 'dup' },
              ],
              localLore: [],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const duplicateReplacement = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/chats/chat-a/messages',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        messages: [
          { role: 'user', data: 'a', chatId: 'same' },
          { role: 'char', data: 'b', chatId: 'same' },
        ],
      },
    })
    expect(duplicateReplacement.statusCode).toBe(400)
    expect(duplicateReplacement.json().error).toBe('Duplicate message id: same')

    const missingAppendId = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/messages',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        message: { role: 'user', data: 'missing id' },
      },
    })
    expect(missingAppendId.statusCode).toBe(400)
    expect(missingAppendId.json().error).toBe('message.chatId must be a non-empty string')

    const missingReplacementId = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/chats/chat-a/messages',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        messages: [{ role: 'user', data: 'missing id' }],
      },
    })
    expect(missingReplacementId.statusCode).toBe(400)
    expect(missingReplacementId.json().error).toBe('messages[0].chatId must be a non-empty string')

    const badPatch = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/messages/dup',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { generationInfo: { model: 'later-slice' } },
      },
    })
    expect(badPatch.statusCode).toBe(400)
    expect(badPatch.json().error).toBe('patch.generationInfo is not supported for message commands')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    const messages = await persistedChatMessages(harness.app, assertion, 'chat-a')
    expect(messages.map((message) => (message as any).data)).toEqual([
      'missing id',
      'duplicate a',
      'duplicate b',
    ])
    expect(messages.map((message) => (message as any).chatId)).toHaveLength(3)
    expect(new Set(messages.map((message) => (message as any).chatId)).size).toBe(3)
  })

  it('repairs imported duplicate message ids across chats and updates local references', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [{ role: 'user', data: 'a', chatId: 'msg-shared' }],
              localLore: [],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
        {
          chaId: 'char-b',
          name: 'B',
          chats: [
            {
              id: 'chat-b',
              name: 'B chat',
              note: '',
              message: [{ role: 'char', data: 'b', chatId: 'msg-shared' }],
              bookmarks: ['msg-shared'],
              bookmarkNames: { 'msg-shared': 'Pinned' },
              localLore: [],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a', 'char-b'],
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
    const [, charB] = bootstrap.json().database.characters
    const chatAMessages = await persistedChatMessages(harness.app, assertion, 'chat-a')
    const chatBMessages = await persistedChatMessages(harness.app, assertion, 'chat-b')
    const renamedMessageId = chatBMessages[0].chatId as string
    expect(chatAMessages[0].chatId).toBe('msg-shared')
    expect(renamedMessageId).not.toBe('msg-shared')
    expect(typeof renamedMessageId).toBe('string')
    // The import's cross-chat uid repair also rewrote chat-b's bookmarks
    // (metadata) to the renamed id — verified against the stub bootstrap.
    expect(charB.chats[0].bookmarks).toEqual([renamedMessageId])
    expect(charB.chats[0].bookmarkNames).toEqual({ [renamedMessageId]: 'Pinned' })
  })

  it('rejects message ids already used by another chat without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [{ role: 'user', data: 'hello', chatId: 'msg-a' }],
              localLore: [],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
        {
          chaId: 'char-b',
          name: 'B',
          chats: [
            {
              id: 'chat-b',
              name: 'B chat',
              note: '',
              message: [{ role: 'user', data: 'hi', chatId: 'msg-b' }],
              localLore: [],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a', 'char-b'],
    })

    const duplicateAppend = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-b/messages',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        message: { role: 'char', data: 'duplicate append', chatId: 'msg-a' },
      },
    })
    expect(duplicateAppend.statusCode).toBe(400)
    expect(duplicateAppend.json().error).toBe('Duplicate message id: msg-a')

    const duplicateReplace = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/chats/chat-b/messages',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        messages: [{ role: 'char', data: 'duplicate replace', chatId: 'msg-a' }],
      },
    })
    expect(duplicateReplace.statusCode).toBe(400)
    expect(duplicateReplace.json().error).toBe('Duplicate message id: msg-a')

    const duplicateGeneration = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-b/generation-result',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        generationResult: {
          targetMessageId: 'msg-b',
          message: {
            role: 'char',
            data: 'duplicate generation',
            chatId: 'msg-a',
            generationInfo: { generationId: 'gen-a' },
            promptInfo: { promptName: 'Preset' },
          },
        },
      },
    })
    expect(duplicateGeneration.statusCode).toBe(400)
    expect(duplicateGeneration.json().error).toBe('Duplicate message id: msg-a')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
    const chatAMessages = await persistedChatMessages(harness.app, assertion, 'chat-a')
    const chatBMessages = await persistedChatMessages(harness.app, assertion, 'chat-b')
    expect([...chatAMessages, ...chatBMessages].map((message) => message.chatId)).toEqual([
      'msg-a',
      'msg-b',
    ])
  })

  it('returns 404 and 409 for missing messages and stale message revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [{ role: 'user', data: 'hello', chatId: 'msg-a' }],
              localLore: [],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const missing = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/messages/missing',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { data: 'Nope' },
      },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('Message not found: missing')

    const stale = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/messages/msg-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: 0,
        patch: { data: 'Stale' },
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-3d generation persistence command', () => {
  it('persists generated assistant rows by appending or replacing the target message', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [
                { role: 'user', data: 'hello', chatId: 'msg-a' },
                { role: 'char', data: 'old tail', chatId: 'msg-old' },
              ],
              localLore: [],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const appended = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/generation-result',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        generationResult: {
          message: {
            role: 'char',
            data: 'fresh answer',
            chatId: 'gen-1',
            promptInfo: { promptName: 'Preset' },
            generationInfo: { generationId: 'gen-1', model: 'echo_model' },
          },
        },
      },
    })
    expect(appended.statusCode).toBe(200)
    expect(appended.json()).toEqual({
      revision: 2,
      event: {
        type: 'generation.persisted',
        revision: 2,
        resource: 'generation',
        id: 'gen-1',
        parentId: 'chat-a',
      },
      chatId: 'chat-a',
      messageId: 'gen-1',
    })

    const repeated = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/generation-result',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: appended.json().revision,
        generationResult: {
          message: {
            role: 'char',
            data: 'fresh answer replay',
            chatId: 'gen-1',
            promptInfo: { promptName: 'Preset' },
            generationInfo: { generationId: 'gen-1', model: 'echo_model' },
          },
        },
      },
    })
    expect(repeated.statusCode).toBe(200)
    expect(
      (await persistedChatMessages(harness.app, assertion, 'chat-a')).map((m) => m.chatId),
    ).toEqual(['msg-a', 'msg-old', 'gen-1'])

    const replaced = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/generation-result',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: repeated.json().revision,
        generationResult: {
          targetMessageId: 'msg-old',
          message: {
            role: 'char',
            data: 'continued answer',
            chatId: 'gen-2',
            promptInfo: { promptName: 'Preset' },
            generationInfo: {
              generationId: 'gen-2',
              model: 'echo_model',
              stageTiming: { stage4: 3 },
            },
          },
        },
      },
    })
    expect(replaced.statusCode).toBe(200)
    expect(replaced.json()).toMatchObject({
      revision: 4,
      event: {
        type: 'generation.persisted',
        resource: 'generation',
        id: 'gen-2',
        parentId: 'chat-a',
      },
      chatId: 'chat-a',
      messageId: 'gen-2',
    })

    expect(await persistedChatMessages(harness.app, assertion, 'chat-a')).toEqual([
      { role: 'user', data: 'hello', chatId: 'msg-a' },
      {
        role: 'char',
        data: 'continued answer',
        chatId: 'gen-2',
        promptInfo: { promptName: 'Preset' },
        generationInfo: {
          generationId: 'gen-2',
          model: 'echo_model',
          stageTiming: { stage4: 3 },
        },
      },
      {
        role: 'char',
        data: 'fresh answer replay',
        chatId: 'gen-1',
        promptInfo: { promptName: 'Preset' },
        generationInfo: { generationId: 'gen-1', model: 'echo_model' },
      },
    ])
    expect(harness.commandEvents.list().at(-1)).toMatchObject({
      type: 'generation.persisted',
      revision: 4,
      resource: 'generation',
      id: 'gen-2',
      parentId: 'chat-a',
    })
  })

  it('rejects malformed generation results without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [{ id: 'chat-a', name: 'A chat', note: '', message: [], localLore: [] }],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const badRole = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/generation-result',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        generationResult: {
          message: {
            role: 'user',
            data: 'not an assistant',
            chatId: 'gen-1',
            generationInfo: { generationId: 'gen-1' },
          },
        },
      },
    })
    expect(badRole.statusCode).toBe(400)
    expect(badRole.json().error).toBe('generationResult.message.role must be char')

    const missingInfo = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/generation-result',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        generationResult: {
          message: { role: 'char', data: 'missing metadata', chatId: 'gen-1' },
        },
      },
    })
    expect(missingInfo.statusCode).toBe(400)
    expect(missingInfo.json().error).toBe('generationResult.message.generationInfo is required')

    const missingMessageId = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/generation-result',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        generationResult: {
          message: {
            role: 'char',
            data: 'missing id',
            generationInfo: { generationId: 'gen-1' },
          },
        },
      },
    })
    expect(missingMessageId.statusCode).toBe(400)
    expect(missingMessageId.json().error).toBe(
      'generationResult.message.chatId must be a non-empty string',
    )

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(await persistedChatMessages(harness.app, assertion, 'chat-a')).toEqual([])
  })

  it('returns 404 and 409 for missing generation targets and stale revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [{ role: 'user', data: 'hello', chatId: 'msg-a' }],
              localLore: [],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const missingChat = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/missing/generation-result',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        generationResult: {
          message: {
            role: 'char',
            data: 'answer',
            chatId: 'gen-1',
            generationInfo: { generationId: 'gen-1' },
          },
        },
      },
    })
    expect(missingChat.statusCode).toBe(404)
    expect(missingChat.json().error).toBe('Chat not found: missing')

    const missingMessage = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/generation-result',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        generationResult: {
          targetMessageId: 'missing-message',
          message: {
            role: 'char',
            data: 'answer',
            chatId: 'gen-1',
            generationInfo: { generationId: 'gen-1' },
          },
        },
      },
    })
    expect(missingMessage.statusCode).toBe(404)
    expect(missingMessage.json().error).toBe('Message not found for chat chat-a: missing-message')

    const stale = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a/generation-result',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: 0,
        generationResult: {
          message: {
            role: 'char',
            data: 'answer',
            chatId: 'gen-1',
            generationInfo: { generationId: 'gen-1' },
          },
        },
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-3e chat scriptstate command', () => {
  it('applies partial scriptstate patches and delete keys with a command event', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [],
              localLore: [],
              scriptstate: { $old: '1', $keep: true },
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-a/scriptstate',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { $score: '9', $count: 2 },
        deleteKeys: ['$old'],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      revision: 2,
      event: {
        type: 'chat.scriptstate.updated',
        revision: 2,
        resource: 'chat',
        id: 'chat-a',
        parentId: 'char-a',
      },
      chatId: 'chat-a',
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toEqual({
      $keep: true,
      $score: '9',
      $count: 2,
    })
    expect(harness.commandEvents.list().at(-1)).toEqual(res.json().event)
  })

  it('removes empty scriptstate after deleting the last key', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [
            {
              id: 'chat-a',
              name: 'A chat',
              note: '',
              message: [],
              localLore: [],
              scriptstate: { $old: '1' },
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-a/scriptstate',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: {}, deleteKeys: ['$old'] },
    })

    expect(res.statusCode).toBe(200)
    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toBeUndefined()
  })

  it('rejects malformed scriptstate payloads without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [{ id: 'chat-a', name: 'A chat', note: '', message: [], localLore: [] }],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const unsupportedValue = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-a/scriptstate',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { $bad: { nested: true } } },
    })
    expect(unsupportedValue.statusCode).toBe(400)
    expect(unsupportedValue.json().error).toBe('patch.$bad must be a string, number, or boolean')

    const empty = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-a/scriptstate',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: {}, deleteKeys: [] },
    })
    expect(empty.statusCode).toBe(400)
    expect(empty.json().error).toBe('scriptstate command must include patch fields or deleteKeys')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toBeUndefined()
  })

  it('returns 404 and 409 for missing chats and stale scriptstate revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          chats: [{ id: 'chat-a', name: 'A chat', note: '', message: [], localLore: [] }],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
    })

    const missing = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chats/missing/scriptstate',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { $x: '1' } },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('Chat not found: missing')

    const stale = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-a/scriptstate',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 0, patch: { $x: '1' } },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-4a lorebook commands', () => {
  it('creates, updates, reorders, and deletes global lorebooks with command events', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      loreBook: [{ id: 'book-a', name: 'A', data: [] }],
      loreBookPage: 0,
    })

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/lorebooks',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        lorebook: { id: 'book-b', name: 'B', data: [] },
      },
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({
      revision: 2,
      event: {
        type: 'lorebook.created',
        revision: 2,
        resource: 'lorebook',
        id: 'book-b',
      },
      lorebookId: 'book-b',
    })

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/lorebooks/book-b',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 2, patch: { name: 'Renamed' } },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().event.type).toBe('lorebook.updated')

    const reordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/lorebooks/reorder',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 3, lorebookIds: ['book-b', 'book-a'] },
    })
    expect(reordered.statusCode).toBe(200)
    expect(reordered.json().event.type).toBe('lorebook.reordered')

    const selected = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/lorebooks/book-a/select',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 4 },
    })
    expect(selected.statusCode).toBe(200)
    expect(selected.json()).toMatchObject({
      revision: 5,
      event: {
        type: 'lorebook.selected',
        revision: 5,
        resource: 'lorebook',
        id: 'book-a',
      },
      selectedLorebookId: 'book-a',
    })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/lorebooks/book-a',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 5 },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json().event.type).toBe('lorebook.deleted')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(6)
    expect(
      bootstrap.json().database.loreBook.map((book: { id: string; name: string }) => ({
        id: book.id,
        name: book.name,
      })),
    ).toEqual([{ id: 'book-b', name: 'Renamed' }])
    expect(
      harness.commandEvents
        .list()
        .slice(-5)
        .map((event) => event.type),
    ).toEqual([
      'lorebook.created',
      'lorebook.updated',
      'lorebook.reordered',
      'lorebook.selected',
      'lorebook.deleted',
    ])
  })

  it('rejects deleting the last global lorebook without minting a replacement id', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      loreBook: [{ id: 'book-a', name: 'A', data: [] }],
      loreBookPage: 0,
    })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/lorebooks/book-a',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision },
    })
    expect(deleted.statusCode).toBe(400)
    expect(deleted.json().error).toBe('Cannot delete the last lorebook')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
    expect(bootstrap.json().database.loreBook).toEqual([{ id: 'book-a', name: 'A', data: [] }])
  })

  it('replaces global, character, chat, and module lorebook entry collections', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      loreBook: [{ id: 'book-a', name: 'A', data: [] }],
      loreBookPage: 0,
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          globalLore: [],
          chats: [{ id: 'chat-a', name: 'Chat', note: '', message: [], localLore: [] }],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
      modules: [{ id: 'mod-a', name: 'Mod', lorebook: [] }],
    })

    const entry = (id: string, comment: string) => ({
      id,
      key: comment.toLowerCase(),
      secondkey: '',
      insertorder: 100,
      comment,
      content: `${comment} content`,
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    })

    const global = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/lorebooks/book-a/entries',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, entries: [entry('entry-global', 'Global')] },
    })
    expect(global.statusCode).toBe(200)
    expect(global.json().event).toMatchObject({
      type: 'lorebook.entries.replaced',
      resource: 'lorebook',
      id: 'book-a',
    })

    const character = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/lorebooks',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 2, entries: [entry('entry-char', 'Character')] },
    })
    expect(character.statusCode).toBe(200)
    expect(character.json()).toMatchObject({ revision: 3, characterId: 'char-a' })

    const chat = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/chats/chat-a/lorebooks',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 3, entries: [entry('entry-chat', 'Chat')] },
    })
    expect(chat.statusCode).toBe(200)
    expect(chat.json().event).toMatchObject({ id: 'chat-a', parentId: 'char-a' })

    const module = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/modules/mod-a/lorebooks',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 4, entries: [entry('entry-module', 'Module')] },
    })
    expect(module.statusCode).toBe(200)
    expect(module.json()).toMatchObject({ revision: 5, moduleId: 'mod-a' })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    const database = bootstrap.json().database
    expect(database.loreBook[0].data[0].id).toBe('entry-global')
    expect(database.characters[0].globalLore[0].id).toBe('entry-char')
    expect(database.characters[0].chats[0].localLore[0].id).toBe('entry-chat')
    expect(database.modules[0].lorebook[0].id).toBe('entry-module')
  })

  it('rejects malformed lorebook commands without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      loreBook: [{ id: 'book-a', name: 'A', data: [] }],
      loreBookPage: 0,
    })

    const malformed = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/lorebooks/book-a/entries',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        entries: [{ id: 'entry-a', key: '', secondkey: '', insertorder: 'bad' }],
      },
    })
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json().error).toBe('entries[0].insertorder must be a finite number')

    const missingEntryId = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/lorebooks/book-a/entries',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        entries: [
          {
            key: '',
            secondkey: '',
            insertorder: 100,
            comment: '',
            content: '',
            mode: 'normal',
            alwaysActive: false,
            selective: false,
          },
        ],
      },
    })
    expect(missingEntryId.statusCode).toBe(400)
    expect(missingEntryId.json().error).toBe('entries[0].id must be a non-empty string')

    const duplicateEntryId = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/lorebooks/book-a/entries',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        entries: [
          {
            id: 'entry-a',
            key: '',
            secondkey: '',
            insertorder: 100,
            comment: '',
            content: '',
            mode: 'normal',
            alwaysActive: false,
            selective: false,
          },
          {
            id: 'entry-a',
            key: '',
            secondkey: '',
            insertorder: 100,
            comment: '',
            content: '',
            mode: 'normal',
            alwaysActive: false,
            selective: false,
          },
        ],
      },
    })
    expect(duplicateEntryId.statusCode).toBe(400)
    expect(duplicateEntryId.json().error).toBe('Duplicate lorebook entry id: entry-a')

    const badReorder = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/lorebooks/reorder',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, lorebookIds: ['book-a', 'book-a'] },
    })
    expect(badReorder.statusCode).toBe(400)
    expect(badReorder.json().error).toBe('Duplicate lorebook id in lorebookIds: book-a')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.loreBook[0].data).toEqual([])
  })

  it('rejects POST /lorebooks payloads that omit nested entry ids (A4EC3 / B2)', async () => {
    // The create route uses the no-mint validator so missing entry ids are
    // rejected instead of being silently minted.
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      loreBook: [{ id: 'book-a', name: 'A', data: [] }],
      loreBookPage: 0,
    })

    const missingId = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/lorebooks',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        lorebook: {
          id: 'book-c',
          name: 'C',
          data: [
            {
              key: 'k',
              secondkey: '',
              insertorder: 100,
              comment: '',
              content: 'c',
              mode: 'normal',
              alwaysActive: false,
              selective: false,
            },
          ],
        },
      },
    })
    expect(missingId.statusCode).toBe(400)
    expect(missingId.json().error).toBe('lorebook.data[0].id must be a non-empty string')

    const duplicateId = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/lorebooks',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        lorebook: {
          id: 'book-c',
          name: 'C',
          data: [
            {
              id: 'dup-entry',
              key: '',
              secondkey: '',
              insertorder: 100,
              comment: '',
              content: '',
              mode: 'normal',
              alwaysActive: false,
              selective: false,
            },
            {
              id: 'dup-entry',
              key: '',
              secondkey: '',
              insertorder: 100,
              comment: '',
              content: '',
              mode: 'normal',
              alwaysActive: false,
              selective: false,
            },
          ],
        },
      },
    })
    expect(duplicateId.statusCode).toBe(400)
    expect(duplicateId.json().error).toBe('Duplicate lorebook entry id: dup-entry')

    // Persisted state unchanged: only book-a from the import remains.
    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
    expect(bootstrap.json().database.loreBook.map((b: { id: string }) => b.id)).toEqual(['book-a'])
  })

  it('rejects PUT /characters /chats /modules lorebook payloads with missing or duplicate entry ids (A4EC3 / B2)', async () => {
    // The replace routes use the no-mint validator so missing or duplicate entry
    // ids are rejected.
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      loreBook: [{ id: 'book-a', name: 'A', data: [] }],
      loreBookPage: 0,
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          globalLore: [],
          chats: [{ id: 'chat-a', name: 'Chat', note: '', message: [], localLore: [] }],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
      modules: [{ id: 'mod-a', name: 'Mod', lorebook: [] }],
    })

    const malformedEntry = {
      key: '',
      secondkey: '',
      insertorder: 100,
      comment: '',
      content: '',
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    }

    const routes = [
      '/api/v1/commands/characters/char-a/lorebooks',
      '/api/v1/commands/chats/chat-a/lorebooks',
      '/api/v1/commands/modules/mod-a/lorebooks',
    ]

    for (const url of routes) {
      const missing = await harness.app.inject({
        method: 'PUT',
        url,
        headers: { 'risu-auth': assertion },
        payload: { baseRevision: revision, entries: [malformedEntry] },
      })
      expect(missing.statusCode).toBe(400)
      expect(missing.json().error).toBe('entries[0].id must be a non-empty string')

      const duplicate = await harness.app.inject({
        method: 'PUT',
        url,
        headers: { 'risu-auth': assertion },
        payload: {
          baseRevision: revision,
          entries: [
            { ...malformedEntry, id: 'dup-entry' },
            { ...malformedEntry, id: 'dup-entry' },
          ],
        },
      })
      expect(duplicate.statusCode).toBe(400)
      expect(duplicate.json().error).toBe('Duplicate lorebook entry id: dup-entry')
    }

    // Persisted state is untouched by the rejected requests; revision is
    // still the post-import baseline.
    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
    const database = bootstrap.json().database
    expect(database.characters[0].globalLore).toEqual([])
    expect(database.characters[0].chats[0].localLore).toEqual([])
    expect(database.modules[0].lorebook).toEqual([])
  })

  it('returns 404 and 409 for missing lorebook parents and stale revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      loreBook: [{ id: 'book-a', name: 'A', data: [] }],
      loreBookPage: 0,
      characters: [],
    })

    const missing = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/missing/lorebooks',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, entries: [] },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('Character not found: missing')

    const stale = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/lorebooks/book-a/entries',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 0, entries: [] },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-4b script and trigger definition commands', () => {
  it('replaces character and module script and trigger definition collections', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          customscript: [],
          triggerscript: [],
          chats: [],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
      modules: [{ id: 'mod-a', name: 'Mod', regex: [], trigger: [] }],
    })

    const script = {
      id: 'script-a',
      comment: 'Regex',
      in: 'a',
      out: 'b',
      type: 'editinput',
      flag: 'g',
      ableFlag: true,
    }
    const trigger = {
      id: 'trigger-a',
      comment: 'Start',
      type: 'start',
      conditions: [],
      effect: [],
    }

    const characterScripts = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/scripts',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, scripts: [script] },
    })
    expect(characterScripts.statusCode).toBe(200)
    expect(characterScripts.json().event).toMatchObject({
      type: 'scriptDefinitions.replaced',
      resource: 'scriptDefinition',
      id: 'char-a',
    })

    const characterTriggers = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/triggers',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 2, triggers: [trigger] },
    })
    expect(characterTriggers.statusCode).toBe(200)
    expect(characterTriggers.json()).toMatchObject({ revision: 3, characterId: 'char-a' })

    const moduleScripts = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/modules/mod-a/scripts',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 3, scripts: [{ ...script, id: 'module-script' }] },
    })
    expect(moduleScripts.statusCode).toBe(200)
    expect(moduleScripts.json()).toMatchObject({ revision: 4, moduleId: 'mod-a' })

    const moduleTriggers = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/modules/mod-a/triggers',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 4, triggers: [{ ...trigger, id: 'module-trigger' }] },
    })
    expect(moduleTriggers.statusCode).toBe(200)
    expect(moduleTriggers.json().event).toMatchObject({
      type: 'triggerDefinitions.replaced',
      resource: 'triggerDefinition',
      id: 'mod-a',
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    const database = bootstrap.json().database
    expect(database.characters[0].customscript[0].id).toBe('script-a')
    expect(database.characters[0].triggerscript[0].id).toBe('trigger-a')
    expect(database.modules[0].regex[0].id).toBe('module-script')
    expect(database.modules[0].trigger[0].id).toBe('module-trigger')
    expect(
      harness.commandEvents
        .list()
        .slice(-4)
        .map((event) => event.type),
    ).toEqual([
      'scriptDefinitions.replaced',
      'triggerDefinitions.replaced',
      'scriptDefinitions.replaced',
      'triggerDefinitions.replaced',
    ])
  })

  it('rejects malformed script and trigger definitions without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [{ chaId: 'char-a', name: 'A', customscript: [], triggerscript: [] }],
      characterOrder: ['char-a'],
    })

    const badScript = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/scripts',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        scripts: [{ id: 'script-a', comment: 'Bad', in: 1, out: '', type: 'editinput' }],
      },
    })
    expect(badScript.statusCode).toBe(400)
    expect(badScript.json().error).toBe('scripts[0].in must be a string')

    const missingScriptId = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/scripts',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        scripts: [{ comment: 'Missing', in: '', out: '', type: 'editinput' }],
      },
    })
    expect(missingScriptId.statusCode).toBe(400)
    expect(missingScriptId.json().error).toBe('scripts[0].id must be a non-empty string')

    const duplicateScriptId = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/scripts',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        scripts: [
          { id: 'script-a', comment: 'A', in: '', out: '', type: 'editinput' },
          { id: 'script-a', comment: 'B', in: '', out: '', type: 'editinput' },
        ],
      },
    })
    expect(duplicateScriptId.statusCode).toBe(400)
    expect(duplicateScriptId.json().error).toBe('Duplicate script definition id: script-a')

    const badTrigger = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/triggers',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        triggers: [{ id: 'trigger-a', comment: 'Bad', type: 'start', conditions: {}, effect: [] }],
      },
    })
    expect(badTrigger.statusCode).toBe(400)
    expect(badTrigger.json().error).toBe('triggers[0].conditions must be an array')

    const missingTriggerId = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/triggers',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        triggers: [{ comment: 'Missing', type: 'start', conditions: [], effect: [] }],
      },
    })
    expect(missingTriggerId.statusCode).toBe(400)
    expect(missingTriggerId.json().error).toBe('triggers[0].id must be a non-empty string')

    const duplicateTriggerId = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/triggers',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        triggers: [
          { id: 'trigger-a', comment: 'A', type: 'start', conditions: [], effect: [] },
          { id: 'trigger-a', comment: 'B', type: 'start', conditions: [], effect: [] },
        ],
      },
    })
    expect(duplicateTriggerId.statusCode).toBe(400)
    expect(duplicateTriggerId.json().error).toBe('Duplicate trigger definition id: trigger-a')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.characters[0].customscript).toEqual([])
    expect(bootstrap.json().database.characters[0].triggerscript).toEqual([])
  })

  it('returns 404 and 409 for missing parents and stale script revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [],
      modules: [{ id: 'mod-a', name: 'Mod', mcp: { url: 'https://example.invalid' } }],
    })

    const missingCharacter = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/missing/scripts',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, scripts: [] },
    })
    expect(missingCharacter.statusCode).toBe(404)
    expect(missingCharacter.json().error).toBe('Character not found: missing')

    const mcpModule = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/modules/mod-a/scripts',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, scripts: [] },
    })
    expect(mcpModule.statusCode).toBe(404)
    expect(mcpModule.json().error).toBe('Module not found: mod-a')

    const stale = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/missing/scripts',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 0, scripts: [] },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-4c module record and enablement commands', () => {
  it('creates, patches, enables, reorders, relinks, and deletes modules', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      enabledModules: ['mod-a'],
      modules: [
        { id: 'mod-a', name: 'A', description: 'Alpha' },
        { id: 'mod-b', name: 'B', description: 'Beta' },
        { id: 'mcp-a', name: 'MCP', description: 'Bridge', mcp: { url: 'internal:risuai' } },
      ],
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          modules: ['mod-a', 'mod-b'],
          chats: [
            {
              id: 'chat-a',
              name: 'Chat',
              note: '',
              message: [],
              localLore: [],
              modules: ['mod-a', 'mod-b'],
            },
          ],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
      loadouts: [{ id: 'loadout-a', name: 'L', modules: ['mod-a', 'mod-b'] }],
    })

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/modules',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        module: { id: 'mod-c', name: 'C', description: 'Gamma', namespace: 'ns-c' },
      },
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({
      revision: 2,
      event: {
        type: 'module.created',
        revision: 2,
        resource: 'module',
        id: 'mod-c',
      },
      moduleId: 'mod-c',
    })

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/modules/mod-c',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: 2,
        patch: { name: 'Renamed C', hideIcon: true, customModuleToggle: 'toggle' },
      },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().event.type).toBe('module.updated')

    const enabled = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/modules/enable',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 3, moduleId: 'mod-b', enabled: true },
    })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.json()).toMatchObject({
      revision: 4,
      moduleId: 'mod-b',
      enabled: true,
      event: { type: 'module.enabled', id: 'mod-b' },
    })

    const reordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/modules/reorder',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 4, moduleIds: ['mod-c', 'mod-b', 'mod-a', 'mcp-a'] },
    })
    expect(reordered.statusCode).toBe(200)
    expect(reordered.json().event.type).toBe('module.reordered')

    const characterLinks = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/modules/reorder',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 5, moduleIds: ['mod-b', 'mod-a'] },
    })
    expect(characterLinks.statusCode).toBe(200)
    expect(characterLinks.json()).toMatchObject({
      revision: 6,
      characterId: 'char-a',
      event: { type: 'character.modules.reordered', id: 'char-a' },
    })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/modules/mod-b',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 6 },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json().event.type).toBe('module.deleted')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    const database = bootstrap.json().database
    expect(bootstrap.json().revision).toBe(7)
    expect(database.modules.map((module: { id: string }) => module.id)).toEqual([
      'mod-c',
      'mod-a',
      'mcp-a',
    ])
    expect(database.modules[0]).toMatchObject({
      id: 'mod-c',
      name: 'Renamed C',
      hideIcon: true,
      customModuleToggle: 'toggle',
    })
    expect(database.enabledModules).toEqual(['mod-a'])
    expect(database.characters[0].modules).toEqual(['mod-a'])
    expect(database.characters[0].chats[0].modules).toEqual(['mod-a'])
    expect(database.loadouts[0].modules).toEqual(['mod-a'])
    expect(
      harness.commandEvents
        .list()
        .slice(-6)
        .map((event) => event.type),
    ).toEqual([
      'module.created',
      'module.updated',
      'module.enabled',
      'module.reordered',
      'character.modules.reordered',
      'module.deleted',
    ])
  })

  it('adds and removes character module links, not only reorders', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      enabledModules: [],
      modules: [
        { id: 'mod-a', name: 'A', description: 'Alpha' },
        { id: 'mod-b', name: 'B', description: 'Beta' },
        { id: 'mcp-a', name: 'MCP', description: '', mcp: { url: 'internal:risuai' } },
      ],
      characters: [{ chaId: 'char-a', name: 'A', modules: [], chats: [], chatFolders: [] }],
      characterOrder: ['char-a'],
    })

    // Add a previously unlinked module.
    const added = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/modules/reorder',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, moduleIds: ['mod-a'] },
    })
    expect(added.statusCode).toBe(200)
    expect(added.json()).toMatchObject({
      revision: 2,
      characterId: 'char-a',
      event: { type: 'character.modules.reordered', id: 'char-a' },
    })

    // Add a second module on top of the first.
    const addedSecond = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/modules/reorder',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 2, moduleIds: ['mod-a', 'mod-b'] },
    })
    expect(addedSecond.statusCode).toBe(200)

    let bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database.characters[0].modules).toEqual(['mod-a', 'mod-b'])

    // Remove the first module, keeping the second.
    const removed = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/modules/reorder',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 3, moduleIds: ['mod-b'] },
    })
    expect(removed.statusCode).toBe(200)

    bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(4)
    expect(bootstrap.json().database.characters[0].modules).toEqual(['mod-b'])

    // Unknown module ids are still rejected.
    const badAdd = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/modules/reorder',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 4, moduleIds: ['mod-b', 'mod-missing'] },
    })
    expect(badAdd.statusCode).toBe(400)
    expect(badAdd.json().error).toBe('Unknown module id in moduleIds: mod-missing')
    expect(bootstrap.json().revision).toBe(4)

    const badMcpAdd = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/modules/reorder',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 4, moduleIds: ['mod-b', 'mcp-a'] },
    })
    expect(badMcpAdd.statusCode).toBe(400)
    expect(badMcpAdd.json().error).toBe('Unknown module id in moduleIds: mcp-a')
  })

  it('rejects malformed module commands without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      enabledModules: [],
      modules: [{ id: 'mod-a', name: 'A', description: '' }],
      characters: [{ chaId: 'char-a', name: 'A', modules: ['mod-a'] }],
      characterOrder: ['char-a'],
    })

    const badPatch = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/modules/mod-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { assets: [['bad.png', 'assets/bad.png', 'png']] },
      },
    })
    expect(badPatch.statusCode).toBe(400)
    expect(badPatch.json().error).toBe('patch.assets[0][1] must be a server asset id')

    const badEnable = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/modules/enable',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, moduleId: 'mod-a', enabled: 'yes' },
    })
    expect(badEnable.statusCode).toBe(400)
    expect(badEnable.json().error).toBe('enabled must be a boolean')

    const badReorder = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/modules/reorder',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, moduleIds: ['mod-a', 'mod-a'] },
    })
    expect(badReorder.statusCode).toBe(400)
    expect(badReorder.json().error).toBe('Duplicate module id in moduleIds: mod-a')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.modules).toEqual([{ id: 'mod-a', name: 'A', description: '' }])
  })

  it('returns 404 for MCP module rows and 409 for stale module revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      modules: [{ id: 'mcp-a', name: 'MCP', description: '', mcp: { url: 'internal:risuai' } }],
    })

    const mcpPatch = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/modules/mcp-a',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { name: 'Nope' } },
    })
    expect(mcpPatch.statusCode).toBe(404)
    expect(mcpPatch.json().error).toBe('Module not found: mcp-a')

    const stale = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/modules/enable',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 0, moduleId: 'mcp-a', enabled: true },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-4e plugin record and configuration commands', () => {
  it('creates, patches, enables, selects provider, reorders, and deletes plugins', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      currentPluginProvider: 'plugin-a',
      plugins: [
        {
          name: 'plugin-a',
          script: 'Risuai.log("A")',
          arguments: { token: 'string' },
          realArg: { token: '' },
          customLink: [],
          argMeta: {},
          version: '3.0',
          enabled: true,
        },
        {
          name: 'plugin-b',
          script: 'Risuai.log("B")',
          arguments: {},
          realArg: {},
          customLink: [],
          argMeta: {},
          version: '3.0',
          enabled: false,
        },
      ],
    })

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/plugins',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        plugin: {
          name: 'plugin-c',
          script: 'Risuai.log("C")',
          arguments: { mode: ['fast', 'slow'] },
          realArg: { mode: 'fast' },
          customLink: [{ link: 'https://example.com', hoverText: 'Docs' }],
          argMeta: { mode: { name: 'Mode' } },
          version: '3.0',
          enabled: true,
        },
      },
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({
      revision: 2,
      pluginId: 'plugin-c',
      event: { type: 'plugin.created', resource: 'plugin', id: 'plugin-c' },
    })

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/plugins/plugin-c',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: 2,
        patch: { realArg: { mode: 'slow' }, displayName: 'Plugin C' },
      },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().event.type).toBe('plugin.updated')

    const enabled = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/plugins/plugin-b/enable',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 3, enabled: true },
    })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.json()).toMatchObject({
      revision: 4,
      pluginId: 'plugin-b',
      enabled: true,
      event: { type: 'plugin.enabled', id: 'plugin-b' },
    })

    const provider = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/plugins/provider',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 4, provider: 'provider-c' },
    })
    expect(provider.statusCode).toBe(200)
    expect(provider.json()).toMatchObject({
      revision: 5,
      provider: 'provider-c',
      event: { type: 'plugin.provider.selected', id: 'provider-c' },
    })

    const reordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/plugins/reorder',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 5, pluginIds: ['plugin-c', 'plugin-b', 'plugin-a'] },
    })
    expect(reordered.statusCode).toBe(200)
    expect(reordered.json().event.type).toBe('plugin.reordered')

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/plugins/plugin-a',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 6 },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json().event.type).toBe('plugin.deleted')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    const database = bootstrap.json().database
    expect(bootstrap.json().revision).toBe(7)
    expect(database.plugins.map((plugin: { name: string }) => plugin.name)).toEqual([
      'plugin-c',
      'plugin-b',
    ])
    expect(database.plugins[0]).toMatchObject({
      name: 'plugin-c',
      displayName: 'Plugin C',
      realArg: { mode: 'slow' },
    })
    expect(database.plugins[1].enabled).toBe(true)
    expect(database.currentPluginProvider).toBe('provider-c')
    expect(
      harness.commandEvents
        .list()
        .slice(-6)
        .map((event) => event.type),
    ).toEqual([
      'plugin.created',
      'plugin.updated',
      'plugin.enabled',
      'plugin.provider.selected',
      'plugin.reordered',
      'plugin.deleted',
    ])
  })

  it('rejects malformed plugin commands without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      plugins: [
        {
          name: 'plugin-a',
          script: '',
          arguments: {},
          realArg: {},
          customLink: [],
          argMeta: {},
        },
      ],
    })

    const badPatch = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/plugins/plugin-a',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { name: 'renamed' } },
    })
    expect(badPatch.statusCode).toBe(400)
    expect(badPatch.json().error).toBe('patch.name cannot be changed by plugin commands')

    const badEnable = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/plugins/plugin-a/enable',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, enabled: 'yes' },
    })
    expect(badEnable.statusCode).toBe(400)
    expect(badEnable.json().error).toBe('enabled must be a boolean')

    const badReorder = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/plugins/reorder',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, pluginIds: ['plugin-a', 'plugin-a'] },
    })
    expect(badReorder.statusCode).toBe(400)
    expect(badReorder.json().error).toBe('Duplicate plugin id in pluginIds: plugin-a')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.plugins[0].name).toBe('plugin-a')
  })

  it('returns 404 for missing plugins and 409 for stale plugin revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDatabase(harness.app, assertion, {
      plugins: [
        {
          name: 'plugin-a',
          script: '',
          arguments: {},
          realArg: {},
          customLink: [],
          argMeta: {},
        },
      ],
    })

    const missing = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/plugins/missing',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 1, patch: { enabled: true } },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('Plugin not found: missing')

    const stale = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/plugins/plugin-a/enable',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 0, enabled: true },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-4f plugin-storage commands', () => {
  it('puts, deletes, and bulk updates plugin custom storage', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      pluginCustomStorage: {
        old: 'value',
        keep: true,
      },
    })

    const put = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/plugin-storage/theme',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, value: { mode: 'dark' } },
    })
    expect(put.statusCode).toBe(200)
    expect(put.json()).toMatchObject({
      revision: 2,
      key: 'theme',
      event: { type: 'pluginStorage.updated', resource: 'pluginStorage', id: 'theme' },
    })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/plugin-storage/old',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 2 },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toMatchObject({
      revision: 3,
      key: 'old',
      event: { type: 'pluginStorage.deleted', id: 'old' },
    })

    const bulk = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/plugin-storage/bulk',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: 3,
        values: { score: 42, nested: { ok: true } },
        deleteKeys: ['keep'],
      },
    })
    expect(bulk.statusCode).toBe(200)
    expect(bulk.json()).toMatchObject({
      revision: 4,
      event: { type: 'pluginStorage.bulkUpdated', resource: 'pluginStorage' },
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(4)
    expect(bootstrap.json().database.pluginCustomStorage).toEqual({
      theme: { mode: 'dark' },
      score: 42,
      nested: { ok: true },
    })
    expect(
      harness.commandEvents
        .list()
        .slice(-3)
        .map((event) => event.type),
    ).toEqual(['pluginStorage.updated', 'pluginStorage.deleted', 'pluginStorage.bulkUpdated'])
  })

  it('rejects malformed plugin-storage commands without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      pluginCustomStorage: { existing: 'value' },
    })

    const badKey = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/plugin-storage/%20',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, value: 'x' },
    })
    expect(badKey.statusCode).toBe(400)
    expect(badKey.json().error).toBe('key must be a non-empty string')

    const badBulk = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/plugin-storage/bulk',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, values: {}, deleteKeys: [] },
    })
    expect(badBulk.statusCode).toBe(400)
    expect(badBulk.json().error).toBe('bulk plugin storage command must change at least one key')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.pluginCustomStorage).toEqual({ existing: 'value' })
  })

  it('returns 409 for stale plugin-storage revisions', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDatabase(harness.app, assertion, {
      pluginCustomStorage: {},
    })

    const stale = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/plugin-storage/key',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 0, value: 'x' },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })
  })
})

describe('Phase 9-4d asset reference commands', () => {
  it('persists uploaded asset ids through owning character, module, persona, settings, and folder commands', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const firstAsset = await uploadAsset(harness.app, assertion, Buffer.from('first'))
    const secondAsset = await uploadAsset(harness.app, assertion, Buffer.from('second'))
    const revision = await importDatabase(harness.app, assertion, {
      currentChar: 0,
      username: 'User',
      userIcon: '',
      personas: [{ id: 'persona-a', name: 'A', icon: '', personaPrompt: '', note: '' }],
      selectedPersona: 0,
      characters: [
        {
          chaId: 'char-a',
          name: 'A',
          image: '',
          emotionImages: [],
          additionalAssets: [],
          ccAssets: [],
          chats: [],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['char-a'],
      modules: [{ id: 'mod-a', name: 'Module', description: '', assets: [] }],
    })

    const createdCharacter = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        character: {
          chaId: 'char-b',
          name: 'B',
          vits: { files: { greeting: firstAsset.assetId } },
          gptSoVitsConfig: {
            ref_audio_data: { fileName: 'ref.wav', assetId: secondAsset.assetId },
          },
          chats: [],
          chatFolders: [],
        },
      },
    })
    expect(createdCharacter.statusCode).toBe(200)
    expect(createdCharacter.json().event).toMatchObject({
      type: 'character.created',
      resource: 'character',
      id: 'char-b',
    })

    const character = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/characters/char-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: createdCharacter.json().revision,
        patch: {
          image: firstAsset.assetId,
          emotionImages: [['happy', firstAsset.assetId]],
          additionalAssets: [['extra.png', secondAsset.assetId, 'png']],
          ccAssets: [{ type: 'icon', uri: secondAsset.assetId, name: 'alt', ext: 'png' }],
          prebuiltAssetExclude: [secondAsset.assetId],
          vits: { files: { greeting: firstAsset.assetId } },
          gptSoVitsConfig: {
            ref_audio_data: { fileName: 'ref.wav', assetId: secondAsset.assetId },
          },
        },
      },
    })
    expect(character.statusCode).toBe(200)
    expect(character.json().event).toMatchObject({
      type: 'character.updated',
      resource: 'character',
      id: 'char-a',
    })

    const module = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/modules/mod-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: character.json().revision,
        patch: { assets: [['module.png', firstAsset.assetId, 'png']] },
      },
    })
    expect(module.statusCode).toBe(200)
    expect(module.json().event).toMatchObject({ type: 'module.updated', id: 'mod-a' })

    const persona = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/personas/persona-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: module.json().revision,
        patch: { icon: secondAsset.assetId },
        mirrorLegacyProfile: true,
      },
    })
    expect(persona.statusCode).toBe(200)

    const settings = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: persona.json().revision,
        patch: { customBackground: firstAsset.assetId },
      },
    })
    expect(settings.statusCode).toBe(200)

    const reordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: settings.json().revision,
        characterOrder: [
          {
            id: 'folder-a',
            name: 'Folder A',
            color: '',
            imgFile: secondAsset.assetId,
            img: `/api/v1/assets/${secondAsset.assetId}`,
            data: ['char-a', 'char-b'],
          },
        ],
      },
    })
    expect(reordered.statusCode).toBe(200)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    const database = bootstrap.json().database
    expect(database.characters[0]).toMatchObject({
      image: firstAsset.assetId,
      emotionImages: [['happy', firstAsset.assetId]],
      additionalAssets: [['extra.png', secondAsset.assetId, 'png']],
      ccAssets: [{ type: 'icon', uri: secondAsset.assetId, name: 'alt', ext: 'png' }],
      prebuiltAssetExclude: [secondAsset.assetId],
      vits: { files: { greeting: firstAsset.assetId } },
      gptSoVitsConfig: {
        ref_audio_data: { fileName: 'ref.wav', assetId: secondAsset.assetId },
      },
    })
    expect(database.characters[1]).toMatchObject({
      chaId: 'char-b',
      vits: { files: { greeting: firstAsset.assetId } },
      gptSoVitsConfig: {
        ref_audio_data: { fileName: 'ref.wav', assetId: secondAsset.assetId },
      },
    })
    expect(database.modules[0].assets).toEqual([['module.png', firstAsset.assetId, 'png']])
    expect(database.personas[0].icon).toBe(secondAsset.assetId)
    expect(database.customBackground).toBe(firstAsset.assetId)
    expect(database.characterOrder[0].imgFile).toBe(secondAsset.assetId)
  })

  it('rejects malformed and missing asset references without bumping revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const uploaded = await uploadAsset(harness.app, assertion, Buffer.from('valid-ref'))
    const revision = await importDatabase(harness.app, assertion, {
      characters: [{ chaId: 'char-a', name: 'A', chats: [], chatFolders: [] }],
      characterOrder: ['char-a'],
      modules: [{ id: 'mod-a', name: 'Module', description: '' }],
      personas: [{ id: 'persona-a', name: 'A', icon: '', personaPrompt: '', note: '' }],
      selectedPersona: 0,
    })
    const missingAssetId = '0'.repeat(64)

    const malformed = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/characters/char-a',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { image: 'assets/not-server.png' } },
    })
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json().error).toBe('patch.image must be a server asset id')

    const missing = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/modules/mod-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { assets: [['missing.png', missingAssetId, 'png']] },
      },
    })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().error).toBe('patch.assets[0][1] references a missing server asset')

    const missingOrderImage = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters/reorder',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        characterOrder: [
          {
            id: 'folder-a',
            name: 'Folder A',
            color: '',
            img: missingAssetId,
            data: ['char-a'],
          },
        ],
      },
    })
    expect(missingOrderImage.statusCode).toBe(400)
    expect(missingOrderImage.json().error).toBe(
      'characterOrder[0].img references a missing server asset',
    )

    const valid = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/personas/persona-a',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { icon: uploaded.assetId } },
    })
    expect(valid.statusCode).toBe(200)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision + 1)
    expect(bootstrap.json().database.characters[0].image).toBeUndefined()
    expect(bootstrap.json().database.modules[0].assets).toBeUndefined()
    expect(bootstrap.json().database.personas[0].icon).toBe(uploaded.assetId)
  })

  it('rejects malformed and missing character audio asset refs on create and patch', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      characters: [{ chaId: 'char-a', name: 'A', chats: [], chatFolders: [] }],
      characterOrder: ['char-a'],
    })
    const missingAssetId = '0'.repeat(64)

    const malformedCreate = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        character: {
          chaId: 'char-b',
          name: 'B',
          vits: { files: { greeting: 'assets/not-server.wav' } },
        },
      },
    })
    expect(malformedCreate.statusCode).toBe(400)
    expect(malformedCreate.json().error).toBe(
      'character.vits.files.greeting must be a server asset id',
    )

    const missingCreate = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/characters',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        character: {
          chaId: 'char-b',
          name: 'B',
          gptSoVitsConfig: {
            ref_audio_data: { fileName: 'ref.wav', assetId: missingAssetId },
          },
        },
      },
    })
    expect(missingCreate.statusCode).toBe(400)
    expect(missingCreate.json().error).toBe(
      'character.gptSoVitsConfig.ref_audio_data.assetId references a missing server asset',
    )

    const malformedPatch = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/characters/char-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: {
          gptSoVitsConfig: {
            ref_audio_data: { fileName: 'ref.wav', assetId: 'assets/not-server.wav' },
          },
        },
      },
    })
    expect(malformedPatch.statusCode).toBe(400)
    expect(malformedPatch.json().error).toBe(
      'patch.gptSoVitsConfig.ref_audio_data.assetId must be a server asset id',
    )

    const missingPatch = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/characters/char-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { vits: { files: { greeting: missingAssetId } } },
      },
    })
    expect(missingPatch.statusCode).toBe(400)
    expect(missingPatch.json().error).toBe(
      'patch.vits.files.greeting references a missing server asset',
    )

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(revision)
    expect(bootstrap.json().database.characters).toHaveLength(1)
    expect(bootstrap.json().database.characters[0]).toMatchObject({
      chaId: 'char-a',
      name: 'A',
      chats: [],
      chatFolders: [],
    })
    expect(bootstrap.json().database.characters[0].vits).toBeUndefined()
    expect(bootstrap.json().database.characters[0].gptSoVitsConfig).toBeUndefined()
  })

  it('accepts optional character audio clear refs on create and patch', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    let revision = await importDatabase(harness.app, assertion, {
      characters: [{ chaId: 'char-a', name: 'A', chats: [], chatFolders: [] }],
      characterOrder: ['char-a'],
    })
    const clearValues = [null, '', '-'] as const

    for (const [index, clearValue] of clearValues.entries()) {
      const created = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/commands/characters',
        headers: { 'risu-auth': assertion },
        payload: {
          baseRevision: revision,
          character: {
            chaId: `char-clear-${index}`,
            name: `Clear ${index}`,
            vits: { files: { greeting: clearValue } },
            gptSoVitsConfig: {
              ref_audio_data: { fileName: 'ref.wav', assetId: clearValue },
            },
          },
        },
      })
      expect(created.statusCode).toBe(200)
      revision = created.json().revision

      const patched = await harness.app.inject({
        method: 'PATCH',
        url: '/api/v1/commands/characters/char-a',
        headers: { 'risu-auth': assertion },
        payload: {
          baseRevision: revision,
          patch: {
            vits: { files: { greeting: clearValue } },
            gptSoVitsConfig: {
              ref_audio_data: { fileName: 'ref.wav', assetId: clearValue },
            },
          },
        },
      })
      expect(patched.statusCode).toBe(200)
      revision = patched.json().revision
    }

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    const characters = bootstrap.json().database.characters
    for (const [index, clearValue] of clearValues.entries()) {
      expect(
        characters.find(
          (character: { chaId: string }) => character.chaId === `char-clear-${index}`,
        ),
      ).toMatchObject({
        vits: { files: { greeting: clearValue } },
        gptSoVitsConfig: {
          ref_audio_data: { fileName: 'ref.wav', assetId: clearValue },
        },
      })
    }
    expect(
      characters.find((character: { chaId: string }) => character.chaId === 'char-a'),
    ).toMatchObject({
      vits: { files: { greeting: '-' } },
      gptSoVitsConfig: {
        ref_audio_data: { fileName: 'ref.wav', assetId: '-' },
      },
    })
  })
})
