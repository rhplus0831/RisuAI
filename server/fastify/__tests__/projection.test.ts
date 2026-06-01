import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { MASKED_PROVIDER_SECRET } from '../src/providerSecrets.js'
import { loadPersistedDatabaseFields, loadStubbedProjectionFields } from '../src/repository.js'
import { resourceProjectionFields } from '../src/routes/projection.js'
import type { FastifyInstance } from 'fastify'
import { setupAuthedClient } from './helpers/auth.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-projection-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
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

async function getProjection(resource: string) {
  return harness.app.inject({
    method: 'GET',
    url: `/api/v1/projection/${resource}`,
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

  it('does not load db.json for the empty asset projection resource', async () => {
    writeFileSync(path.join(harness.dataDir, 'db.json'), '{not valid json')

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
    expect(resourceProjectionFields('settings')).toBeNull()
    expect(resourceProjectionFields('state')).toBeNull()
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
    writeFileSync(
      path.join(harness.dataDir, 'db.json'),
      JSON.stringify({
        _version: 1,
        database: {
          botPresets: [{ id: 'p1', openAIKey: 'sk-secret' }],
          botPresetsId: 2,
          characters: [{ chaId: 'char-a', chats: [{ id: 'chat-a', message: [{ data: 'hi' }] }] }],
          language: 'en',
        },
        assets: [],
      }),
    )

    expect(loadPersistedDatabaseFields(harness.dataDir, ['botPresets', 'botPresetsId'])).toEqual({
      botPresets: [{ id: 'p1', openAIKey: 'sk-secret' }],
      botPresetsId: 2,
    })
  })

  it('selects character fields with chat and lorebook stubs', () => {
    writeFileSync(
      path.join(harness.dataDir, 'db.json'),
      JSON.stringify({
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
      }),
    )

    expect(
      loadStubbedProjectionFields(harness.dataDir, ['characters', 'characterOrder', 'currentChar']),
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
