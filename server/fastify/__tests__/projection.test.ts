import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { MASKED_PROVIDER_SECRET } from '../src/providerSecrets.js'
import { jsonPayloadBytes } from '../src/protocolMetrics.js'
import { ensureDbJsonImported, loadPersistedDatabaseFields, loadStubbedProjectionFields, writePersistedWithMessages } from '../src/repository.js'
import { openDatabase } from '../src/db.js'
import { fullBootstrapFallbackClass, resourceProjectionFields } from '../src/routes/projection.js'
import type { FastifyInstance } from 'fastify'
import { setupAuthedClient } from './helpers/auth.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
}

interface ProjectionMetric {
  metric: string
  resource?: string
  revision?: number
  mode?: string
  fallbackClass?: string | null
  payloadBytes?: number | null
}

// Capture opt-in protocol metrics regardless of the logger sink so the
// sprawling-resource full-bootstrap measurement can assert which resources
// trigger a `mode: 'full'` fallback and how the route classifies them.
const capturedMetrics = vi.hoisted((): ProjectionMetric[] => [])

vi.mock('../src/protocolMetrics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/protocolMetrics.js')>()
  return {
    ...actual,
    emitProtocolMetric: (name: string, fields: Record<string, unknown>) => {
      if (!actual.protocolMetricsEnabled()) return
      capturedMetrics.push({ metric: name, ...fields } as ProjectionMetric)
    },
  }
})

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-projection-'))
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
  })
  return { app, dataDir }
}

let harness: Harness
let assertion: string

beforeEach(async () => {
  harness = await startHarness()
  ;({ assertion } = await setupAuthedClient(harness.app))
})

afterEach(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

async function importDatabase(database: unknown): Promise<number> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(res.statusCode).toBe(200)
  return res.json().revision as number
}

async function getProjection(resource: string, query = '') {
  return harness.app.inject({
    method: 'GET',
    url: `/api/v1/projection/${resource}${query}`,
    headers: { 'risu-auth': assertion },
  })
}

describe('targeted projection route (lazy-projection Phase 2)', () => {
  it('returns the owned top-level fields for a structural resource', async () => {
    const revision = await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          chats: [
            {
              id: 'chat-a',
              message: [{ role: 'user', data: 'hello' }],
              hypaV3Data: { mainChunks: [{ text: 'summary' }] },
            },
          ],
          oaiTTSConfig: { apiKey: 'tts-secret' },
        },
      ],
      botPresets: [{ id: 'p1', openAIKey: 'sk-secret' }],
      language: 'en',
    })

    const res = await getProjection('character')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.revision).toBe(revision)
    expect(body.resource).toBe('character')
    expect(body.mode).toBe('fields')
    // Only the resource's owned keys are present.
    expect(Object.keys(body.fields).sort()).toEqual(['characterOrder', 'characters', 'currentChar'])
    expect(body.fields.characters[0]).toMatchObject({ chaId: 'char-a', name: 'Ada' })
    expect(body.fields.characters[0].oaiTTSConfig.apiKey).toBe(MASKED_PROVIDER_SECRET)
    expect(body.fields.characters[0].chats[0].message).toEqual([])
    expect(body.fields.characters[0].chats[0]).not.toHaveProperty('hypaV3Data')
    expect(body.fields).not.toHaveProperty('botPresets')
    expect(body.fields).not.toHaveProperty('language')
  })

  it('returns only character stubs for character-family resources', async () => {
    await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hello' }] }],
        },
      ],
      characterOrder: ['char-a'],
      currentChar: 'char-a',
      botPresets: [{ id: 'p1', openAIKey: 'sk-secret' }],
    })

    const body = (await getProjection('message')).json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields)).toEqual(['characters'])
    expect(body.fields.characters[0].chats[0].message).toEqual([])
    expect(body.fields).not.toHaveProperty('characterOrder')
    expect(body.fields).not.toHaveProperty('botPresets')
  })

  it('returns only the selected character pointer data for character selection', async () => {
    const revision = await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          lastInteraction: 111,
          chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hello' }] }],
        },
        {
          chaId: 'char-b',
          name: 'Babbage',
          lastInteraction: 222,
          chats: [{ id: 'chat-b', message: [{ role: 'char', data: 'hi' }] }],
        },
      ],
      characterOrder: ['char-a', 'char-b'],
      currentChar: 1,
    })

    const res = await getProjection('characterSelection', '?id=char-b')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual({
      revision,
      resource: 'characterSelection',
      mode: 'character-selection',
      characterId: 'char-b',
      currentChar: 1,
      lastInteraction: 222,
    })
    expect(body).not.toHaveProperty('fields')
    expect(JSON.stringify(body)).not.toContain('Ada')
    expect(JSON.stringify(body)).not.toContain('Babbage')
  })

  it('masks provider secrets in narrow returned fields', async () => {
    await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      botPresets: [{ id: 'p1', openAIKey: 'sk-secret', proxyKey: 'px-secret' }],
      language: 'en',
    })

    const res = await getProjection('preset')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields).sort()).toEqual(['botPresets', 'botPresetsId'])
    expect(body.fields.botPresets[0].openAIKey).toBe(MASKED_PROVIDER_SECRET)
    expect(body.fields.botPresets[0].proxyKey).toBe(MASKED_PROVIDER_SECRET)
    expect(body.fields).not.toHaveProperty('characters')
    expect(body.fields).not.toHaveProperty('language')
  })

  it('reships promptTemplate (not botPresets) for a promptItem refresh', async () => {
    // Phase 4 prompt-items slice co-fix: a foreign client refreshing on a
    // promptItem event must see the changed prompt-items collection, not the
    // unrelated botPresets the resource used to point at.
    await importDatabase({
      characters: [{ chaId: 'char-a', name: 'Ada' }],
      promptTemplate: [{ type: 'plain', text: 'item-0' }],
      botPresets: [{ id: 'p1', name: 'P1' }],
      language: 'en',
    })

    const res = await getProjection('promptItem')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields)).toEqual(['promptTemplate'])
    expect(body.fields.promptTemplate[0]).toMatchObject({ type: 'plain', text: 'item-0' })
    expect(body.fields).not.toHaveProperty('botPresets')
  })

  it('returns mode "full" for a sprawling resource (settings)', async () => {
    const revision = await importDatabase({ characters: [], language: 'en' })
    const res = await getProjection('settings')
    const body = res.json()
    expect(body.revision).toBe(revision)
    expect(body.mode).toBe('full')
    expect(body.fields).toBeUndefined()
  })

  it('returns mode "full" for an unknown resource', async () => {
    await importDatabase({ characters: [] })
    const res = await getProjection('does-not-exist')
    expect(res.json().mode).toBe('full')
  })

  it('returns empty fields for the asset resource (no projected change)', async () => {
    await importDatabase({ characters: [] })
    const res = await getProjection('asset')
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(body.fields).toEqual({})
  })

  it('returns empty fields for the asset resource even when no database is seeded', async () => {
    // db.json is never read; asset projection always returns empty fields.
    const res = await getProjection('asset')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.mode).toBe('fields')
    expect(body.fields).toEqual({})
  })

  it('maps every command-event resource to either fields or full', () => {
    // The structural resources the decision tree narrows; everything else
    // (settings/state/pluginStorage/unknown) intentionally falls back to full.
    expect(resourceProjectionFields('character')).toEqual([
      'characters',
      'characterOrder',
      'currentChar',
    ])
    expect(resourceProjectionFields('characterSelection')).toEqual([])
    expect(resourceProjectionFields('generation')).toEqual(['characters'])
    expect(resourceProjectionFields('module')).toEqual([
      'modules',
      'enabledModules',
      'loadouts',
      'characters',
    ])
    expect(resourceProjectionFields('lorebook')).toEqual([
      'characters',
      'modules',
      'loreBook',
      'loreBookPage',
    ])
    expect(resourceProjectionFields('asset')).toEqual([])
    expect(resourceProjectionFields('promptItem')).toEqual(['promptTemplate'])
    expect(resourceProjectionFields('settings')).toBeNull()
    expect(resourceProjectionFields('state')).toBeNull()
  })

  it('classifies full-bootstrap fallbacks as sprawling, unknown, or narrowable', () => {
    // Narrowable resources never trigger the fallback.
    expect(fullBootstrapFallbackClass('character')).toBeNull()
    expect(fullBootstrapFallbackClass('characterSelection')).toBeNull()
    expect(fullBootstrapFallbackClass('asset')).toBeNull()
    // Known sprawling resources fall back on purpose.
    expect(fullBootstrapFallbackClass('settings')).toBe('sprawling')
    expect(fullBootstrapFallbackClass('state')).toBe('sprawling')
    expect(fullBootstrapFallbackClass('pluginStorage')).toBe('sprawling')
    // Anything else is an unknown/foreign resource fallback.
    expect(fullBootstrapFallbackClass('does-not-exist')).toBe('unknown')
  })

  it('returns module deletion cross-writes with character stubs', async () => {
    const revision = await importDatabase({
      enabledModules: ['mod-a', 'mod-b'],
      loadouts: [{ id: 'load-a', modules: ['mod-a', 'mod-b'] }],
      modules: [
        { id: 'mod-a', name: 'Module A', description: '' },
        { id: 'mod-b', name: 'Module B', description: '' },
      ],
      characters: [
        {
          chaId: 'char-a',
          modules: ['mod-a', 'mod-b'],
          chats: [
            {
              id: 'chat-a',
              modules: ['mod-a', 'mod-b'],
              message: [{ role: 'user', data: 'hello' }],
              hypaV3Data: { mainChunks: [{ text: 'summary' }] },
            },
          ],
        },
      ],
    })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/modules/mod-b',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision },
    })
    expect(deleted.statusCode).toBe(200)

    const res = await getProjection('module')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.revision).toBe(revision + 1)
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields).sort()).toEqual([
      'characters',
      'enabledModules',
      'loadouts',
      'modules',
    ])
    expect(body.fields.modules.map((module: { id: string }) => module.id)).toEqual(['mod-a'])
    expect(body.fields.enabledModules).toEqual(['mod-a'])
    expect(body.fields.loadouts[0].modules).toEqual(['mod-a'])
    expect(body.fields.characters[0].modules).toEqual(['mod-a'])
    expect(body.fields.characters[0].chats[0].modules).toEqual(['mod-a'])
    expect(body.fields.characters[0].chats[0].message).toEqual([])
    expect(body.fields.characters[0].chats[0]).not.toHaveProperty('hypaV3Data')
  })

  it('returns lorebook page and mixed lorebook fields with stubs', async () => {
    await importDatabase({
      enableLorebookStubs: true,
      loreBook: [
        { id: 'lore-a', name: 'A', data: [] },
        { id: 'lore-b', name: 'B', data: [] },
      ],
      loreBookPage: 1,
      modules: [{ id: 'mod-a', name: 'Module A', description: '', lorebook: [] }],
      characters: [
        {
          chaId: 'char-a',
          globalLore: [{ key: 'secret', content: 'lore' }],
          chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'hello' }] }],
        },
      ],
    })

    const body = (await getProjection('lorebook')).json()
    expect(body.mode).toBe('fields')
    expect(Object.keys(body.fields).sort()).toEqual([
      'characters',
      'loreBook',
      'loreBookPage',
      'modules',
    ])
    expect(body.fields.loreBookPage).toBe(1)
    expect(body.fields.loreBook.map((lorebook: { id: string }) => lorebook.id)).toEqual([
      'lore-a',
      'lore-b',
    ])
    expect(body.fields.characters[0]).not.toHaveProperty('globalLore')
    expect(body.fields.characters[0].chats[0].message).toEqual([])
  })
})

describe('bulk chat message hydration route', () => {
  it('serves requested chat histories in one read-only response', async () => {
    const revision = await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          chats: [
            {
              id: 'chat-a',
              message: [{ role: 'user', data: 'hello', chatId: 'm1' }],
              hypaV3Data: { mainChunks: [{ text: 'summary' }] },
            },
            {
              id: 'chat-b',
              message: [{ role: 'char', data: 'hi', chatId: 'm2' }],
            },
          ],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/projection/chatMessages/bulk',
      headers: { 'risu-auth': assertion },
      payload: { ids: ['chat-a', 'missing-chat', 'chat-b', 'chat-a'] },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      revision,
      resource: 'chatMessages',
      mode: 'chat-messages-bulk',
      missing: ['missing-chat'],
    })
    expect(body.chats).toHaveLength(2)
    expect(body.chats[0]).toMatchObject({
      chatId: 'chat-a',
      message: [{ role: 'user', data: 'hello', chatId: 'm1' }],
      hypaV3Data: { mainChunks: [{ text: 'summary' }] },
      alternates: [],
    })
    expect(body.chats[1]).toMatchObject({
      chatId: 'chat-b',
      message: [{ role: 'char', data: 'hi', chatId: 'm2' }],
      alternates: [],
    })
    expect(body.chats[1]).not.toHaveProperty('hypaV3Data')
  })

  it('rejects malformed bulk chat ids', async () => {
    await importDatabase({ characters: [] })
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/projection/chatMessages/bulk',
      headers: { 'risu-auth': assertion },
      payload: { ids: ['chat-a', ''] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('invalid_chat_ids')
  })

  it('rejects malformed bulk chat envelope with the route error shape', async () => {
    await importDatabase({ characters: [] })

    for (const payload of [{}, { ids: 'chat-a' }, { ids: [123] }]) {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/projection/chatMessages/bulk',
        headers: { 'risu-auth': assertion },
        payload,
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({
        error: 'invalid_chat_ids',
        reason: 'Expected body.ids to be an array of non-empty chat ids.',
      })
    }
  })
})

describe('targeted projection field loader', () => {
  it('selects only requested persisted database fields', () => {
    const db = openDatabase(harness.dataDir)
    try {
      writePersistedWithMessages(db, harness.dataDir, {
        _version: 1,
        database: {
          botPresets: [{ id: 'p1', openAIKey: 'sk-secret' }],
          botPresetsId: 2,
          characters: [{ chaId: 'char-a', chats: [{ id: 'chat-a', message: [{ data: 'hi' }] }] }],
          language: 'en',
        },
        assets: [],
      })
      expect(loadPersistedDatabaseFields(db, harness.dataDir, ['botPresets', 'botPresetsId'])).toEqual({
        botPresets: [{ id: 'p1', openAIKey: 'sk-secret' }],
        botPresetsId: 2,
      })
    } finally {
      db.close()
    }
  })

  it('selects character fields with chat and lorebook stubs', () => {
    const db = openDatabase(harness.dataDir)
    try {
      writePersistedWithMessages(db, harness.dataDir, {
        _version: 1,
        database: {
          enableLorebookStubs: true,
          characters: [
            {
              chaId: 'char-a',
              globalLore: [{ key: 'k', content: 'secret lore' }],
              chats: [
                {
                  id: 'chat-a',
                  message: [{ data: 'hi' }],
                  hypaV3Data: { mainChunks: [{ text: 'summary' }] },
                },
              ],
            },
          ],
          characterOrder: ['char-a'],
          currentChar: 'char-a',
          botPresets: [{ id: 'p1', openAIKey: 'sk-secret' }],
        },
        assets: [],
      })
      expect(
        loadStubbedProjectionFields(db, harness.dataDir, ['characters', 'characterOrder', 'currentChar']),
      ).toEqual({
        characters: [
          {
            chaId: 'char-a',
            chats: [{ id: 'chat-a', message: [] }],
          },
        ],
        characterOrder: ['char-a'],
        currentChar: 'char-a',
      })
    } finally {
      db.close()
    }
  })
})

describe('Phase 5 lorebook stubs (enableLorebookStubs)', () => {
  const characterWithLore = (extra: Record<string, unknown> = {}) => ({
    characters: [
      {
        chaId: 'char-a',
        name: 'Ada',
        globalLore: [{ key: 'k', content: 'secret lore' }],
      },
    ],
    language: 'en',
    ...extra,
  })

  it('keeps character globalLore resident by default (stubs off)', async () => {
    await importDatabase(characterWithLore())
    const body = (await getProjection('character')).json()
    expect(body.fields.characters[0]).toHaveProperty('globalLore')
    expect(body.fields.characters[0].globalLore).toHaveLength(1)
  })

  it('strips character globalLore from the projection when enableLorebookStubs is on', async () => {
    await importDatabase(characterWithLore({ enableLorebookStubs: true }))
    const body = (await getProjection('character')).json()
    expect(body.fields.characters[0]).not.toHaveProperty('globalLore')
  })

  it('serves the full globalLore via /projection/characterLorebook even when stubbed', async () => {
    await importDatabase(characterWithLore({ enableLorebookStubs: true }))
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/projection/characterLorebook?id=char-a',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.mode).toBe('character-lorebook')
    expect(body.characterId).toBe('char-a')
    expect(body.globalLore).toHaveLength(1)
    expect(body.globalLore[0].content).toBe('secret lore')
  })

  it('serves requested character lorebooks in one read-only response', async () => {
    const revision = await importDatabase({
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          globalLore: [{ key: 'a', content: 'lore a' }],
        },
        {
          chaId: 'char-b',
          name: 'Babbage',
          globalLore: [{ key: 'b', content: 'lore b' }],
        },
        {
          chaId: 'char-empty',
          name: 'Empty',
        },
      ],
      enableLorebookStubs: true,
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/projection/characterLorebooks/bulk',
      headers: { 'risu-auth': assertion },
      payload: { ids: ['char-a', 'missing-char', 'char-empty', 'char-a'] },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      revision,
      resource: 'characterLorebooks',
      mode: 'character-lorebooks-bulk',
      missing: ['missing-char'],
    })
    expect(body.characters).toHaveLength(2)
    expect(body.characters[0].characterId).toBe('char-a')
    expect(body.characters[0].globalLore[0]).toMatchObject({ key: 'a', content: 'lore a' })
    expect(body.characters[1]).toEqual({
      characterId: 'char-empty',
      globalLore: [],
    })
  })

  it('rejects malformed bulk character lorebook ids', async () => {
    await importDatabase(characterWithLore())
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/projection/characterLorebooks/bulk',
      headers: { 'risu-auth': assertion },
      payload: { ids: ['char-a', ''] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: 'invalid_character_lorebook_ids',
      reason: 'Expected body.ids to be an array of non-empty character ids.',
    })
  })

  it('returns mode:full for a missing characterLorebook id', async () => {
    await importDatabase(characterWithLore())
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/projection/characterLorebook',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().mode).toBe('full')
  })
})

// Phase 3 sprawling-resource full-bootstrap measurement.
//
// Measurement-only: the route behavior is unchanged (these resources still
// return `mode: 'full'`). The opt-in `projection_response` metric now records
// `mode` plus a `fallbackClass` so the cost of expensive sprawling-resource and
// unknown-resource full-bootstrap fallbacks can be attributed per resource.
describe('sprawling-resource full-bootstrap measurement', () => {
  const PREVIOUS_PROTOCOL_METRICS = process.env.RISU_PROTOCOL_METRICS

  beforeEach(() => {
    process.env.RISU_PROTOCOL_METRICS = '1'
    capturedMetrics.length = 0
  })

  afterEach(() => {
    if (PREVIOUS_PROTOCOL_METRICS === undefined) {
      delete process.env.RISU_PROTOCOL_METRICS
    } else {
      process.env.RISU_PROTOCOL_METRICS = PREVIOUS_PROTOCOL_METRICS
    }
  })

  function latestProjectionMetric(resource: string): ProjectionMetric {
    const metric = [...capturedMetrics]
      .reverse()
      .find((entry) => entry.metric === 'projection_response' && entry.resource === resource)
    expect(metric, `missing projection_response metric for ${resource}`).toBeTruthy()
    return metric as ProjectionMetric
  }

  it('records mode and a sprawling fallback class for settings/state/pluginStorage', async () => {
    await importDatabase({ characters: [], language: 'en' })

    for (const resource of ['settings', 'state', 'pluginStorage']) {
      capturedMetrics.length = 0
      const res = await getProjection(resource)
      const body = res.json()
      expect(body.mode).toBe('full')

      const metric = latestProjectionMetric(resource)
      expect(metric.mode).toBe('full')
      expect(metric.fallbackClass).toBe('sprawling')
      expect(metric.payloadBytes).toBe(jsonPayloadBytes(body))
    }
  })

  it('records an unknown fallback class for foreign resources', async () => {
    await importDatabase({ characters: [] })
    const res = await getProjection('does-not-exist')
    expect(res.json().mode).toBe('full')

    const metric = latestProjectionMetric('does-not-exist')
    expect(metric.mode).toBe('full')
    expect(metric.fallbackClass).toBe('unknown')
  })

  it('records mode without a fallback class for narrowable resources', async () => {
    await importDatabase({ characters: [{ chaId: 'char-a', name: 'Ada', chats: [] }] })
    const res = await getProjection('character')
    expect(res.json().mode).toBe('fields')

    const metric = latestProjectionMetric('character')
    expect(metric.mode).toBe('fields')
    expect(metric.fallbackClass).toBeUndefined()
  })

  it('summarizes sprawling fallback payload sizes when RISU_PROJECTION_FULL_SUMMARY=1', async () => {
    await importDatabase({ characters: [], language: 'en' })
    capturedMetrics.length = 0

    const resources = ['settings', 'state', 'pluginStorage', 'does-not-exist']
    for (const resource of resources) {
      await getProjection(resource)
    }

    const fullFallbacks = capturedMetrics.filter(
      (entry) => entry.metric === 'projection_response' && entry.mode === 'full',
    )
    expect(fullFallbacks).toHaveLength(resources.length)

    if (process.env.RISU_PROJECTION_FULL_SUMMARY === '1') {
      console.log(
        JSON.stringify(
          fullFallbacks.map((entry) => ({
            resource: entry.resource,
            fallbackClass: entry.fallbackClass,
            payloadBytes: entry.payloadBytes,
          })),
          null,
          2,
        ),
      )
    }
  })
})
