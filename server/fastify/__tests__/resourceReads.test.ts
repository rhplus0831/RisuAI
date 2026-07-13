import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { COLLECTION_FIELDS } from '../src/repository.js'
import { MASKED_PROVIDER_SECRET } from '../src/providerSecrets.js'
import { setupAuthedClient } from './helpers/auth.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-resource-reads-'))
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
    memoryWorker: false,
    assetGc: false,
  })
  return { app, dataDir }
}

let harness: Harness
let assertion: string
let revision: number

beforeEach(async () => {
  harness = await startHarness()
  ;({ assertion } = await setupAuthedClient(harness.app))
  const imported = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: {
      database: {
        currentChar: 0,
        characterOrder: ['char-a', 'char-b'],
        enableLorebookStubs: true,
        localNetworkMode: true,
        localNetworkTimeoutSec: 45,
        openAIKey: 'root-secret',
        modules: [{ id: 'module-a', name: 'Module A', cjs: 'module.exports = true' }],
        plugins: [{ name: 'plugin-a', displayName: 'Plugin A', script: 'Risuai.log("plugin")' }],
        modelPresets: [{ id: 'model-a', name: 'Model A', openAIKey: 'model-secret' }],
        promptPresets: [
          {
            id: 'prompt-a',
            name: 'Prompt A',
            promptTemplate: [{ id: 'prompt-item-a', type: 'plain', text: 'Prompt text', role: 'system' }],
          },
          { id: 'prompt-empty', name: 'Prompt Empty' },
        ],
        botPresets: [{ id: 'legacy-a', name: 'Legacy A', openAIKey: 'legacy-secret', temperature: 0.7 }],
        promptTemplate: [{ id: 'root-prompt', type: 'plain', text: 'Root prompt', role: 'system' }],
        personas: [{ id: 'persona-a', name: 'Persona A' }],
        loadouts: [{ id: 'loadout-a', name: 'Loadout A' }],
        loreBook: [{ id: 'lorebook-a', name: 'Lorebook A', data: [] }],
        translatorPresets: [{ id: 'translator-a', name: 'Translator A' }],
        hypaV3Presets: [{ id: 'hypa-a', name: 'Hypa A' }],
        pluginCustomStorage: { 'plugin-a:state': { enabled: true } },
        characters: [
          {
            chaId: 'char-a',
            name: 'Ada',
            lastInteraction: 123,
            desc: 'Full character detail',
            oaiTTSConfig: { apiKey: 'tts-secret' },
            globalLore: [{ key: ['Ada'], content: 'Character lore' }],
            chats: [
              {
                id: 'chat-a',
                name: 'Chat A',
                message: [
                  { uid: 'message-a', role: 'user', data: 'one' },
                  { uid: 'message-b', role: 'char', data: 'two' },
                ],
                hypaV3Data: { mainChunks: [{ text: 'summary' }] },
              },
            ],
          },
          {
            chaId: 'char-b',
            name: 'Bea',
            globalLore: [{ key: ['Bea'], content: 'Second lore' }],
            chats: [],
          },
        ],
      },
    },
  })
  expect(imported.statusCode).toBe(200)
  revision = imported.json().revision as number
})

afterEach(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

function authHeaders(): Record<string, string> {
  return { 'risu-auth': assertion }
}

describe('authenticated resource read routes', () => {
  it('returns settings without collection fields and masks provider secrets', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/settings',
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      revision,
      settings: {
        currentChar: 0,
        characterOrder: ['char-a', 'char-b'],
        openAIKey: MASKED_PROVIDER_SECRET,
      },
    })
    expect(response.json().settings).not.toHaveProperty('characters')
    expect(response.json().settings).not.toHaveProperty('modules')
  })

  it('returns an allowlisted, masked settings group without collection-owned memory presets', async () => {
    const providers = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/settings/providers',
      headers: authHeaders(),
    })
    expect(providers.statusCode).toBe(200)
    expect(providers.json()).toMatchObject({
      revision,
      group: 'providers',
      settings: { openAIKey: MASKED_PROVIDER_SECRET },
    })
    expect(providers.json().settings).not.toHaveProperty('enableLorebookStubs')
    expect(providers.json().settings).not.toHaveProperty('hypaV3Presets')

    const memory = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/settings/memory',
      headers: authHeaders(),
    })
    expect(memory.statusCode).toBe(200)
    expect(memory.json()).toMatchObject({ revision, group: 'memory' })
    expect(memory.json().settings).not.toHaveProperty('hypaV3Presets')

    const runtime = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/settings/runtime',
      headers: authHeaders(),
    })
    expect(runtime.statusCode).toBe(200)
    expect(runtime.json().settings).toMatchObject({ localNetworkMode: true, localNetworkTimeoutSec: 45 })

    const sidebar = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/settings/sidebar',
      headers: authHeaders(),
    })
    expect(sidebar.statusCode).toBe(200)
    expect(sidebar.json().settings).toMatchObject({ lastLoadedLoadoutName: '' })

    const account = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/settings/account',
      headers: authHeaders(),
    })
    expect(account.statusCode).toBe(200)
    expect(account.json().settings).not.toHaveProperty('localNetworkMode')
    expect(account.json().settings).not.toHaveProperty('localNetworkTimeoutSec')

    const unknown = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/settings/not-a-group',
      headers: authHeaders(),
    })
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json().error).toBe('settings_group_not_found')
  })

  it('returns aggregate and allowlisted targeted collections with masked secrets', async () => {
    const aggregate = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/collections',
      headers: authHeaders(),
    })
    expect(aggregate.statusCode).toBe(200)
    const aggregateBody = aggregate.json()
    expect(aggregateBody.revision).toBe(revision)
    expect(Object.keys(aggregateBody.collections).sort()).toEqual([...COLLECTION_FIELDS, 'pluginCustomStorage'].sort())
    expect(aggregateBody.collections.modules).toEqual([
      expect.objectContaining({ id: 'module-a', cjs: 'module.exports = true' }),
    ])
    expect(aggregateBody.collections.modelPresets[0].openAIKey).toBe(MASKED_PROVIDER_SECRET)
    expect(aggregateBody.collections.pluginCustomStorage).toEqual({ 'plugin-a:state': { enabled: true } })

    const targeted = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/collections/modelPresets',
      headers: authHeaders(),
    })
    expect(targeted.statusCode).toBe(200)
    expect(targeted.json()).toEqual({
      revision,
      collections: {
        modelPresets: [expect.objectContaining({ id: 'model-a', openAIKey: MASKED_PROVIDER_SECRET })],
      },
    })

    const unknown = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/collections/not-a-collection',
      headers: authHeaders(),
    })
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json().error).toBe('collection_not_found')
  })

  it('returns character/chat metadata with matching chat and lorebook stubs', async () => {
    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/characters',
      headers: authHeaders(),
    })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toMatchObject({
      revision,
      currentChar: 0,
      characterOrder: ['char-a', 'char-b'],
    })
    const listedAda = list.json().characters.find((character: { chaId?: string }) => character.chaId === 'char-a')
    expect(listedAda).toMatchObject({
      chaId: 'char-a',
      desc: 'Full character detail',
      oaiTTSConfig: { apiKey: MASKED_PROVIDER_SECRET },
      chats: [{ id: 'chat-a', name: 'Chat A', message: [] }],
    })
    expect(listedAda).not.toHaveProperty('globalLore')
    expect(listedAda.chats[0]).not.toHaveProperty('hypaV3Data')

    const detail = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/characters/char-a',
      headers: authHeaders(),
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().character).toMatchObject({
      chaId: 'char-a',
      chats: [{ id: 'chat-a', message: [] }],
    })
    expect(detail.json().character).not.toHaveProperty('globalLore')
    expect(detail.json().character.oaiTTSConfig.apiKey).toBe(MASKED_PROVIDER_SECRET)

    const missing = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/characters/missing',
      headers: authHeaders(),
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('character_not_found')
  })

  it('keeps character lorebooks resident when lorebook stubs are disabled', async () => {
    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: authHeaders(),
      payload: {
        database: {
          enableLorebookStubs: false,
          characters: [
            {
              chaId: 'char-full-lore',
              name: 'Lore keeper',
              globalLore: [{ key: ['resident'], content: 'Resident lore' }],
              chats: [],
            },
          ],
        },
      },
    })
    expect(imported.statusCode).toBe(200)

    const aggregate = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/characters',
      headers: authHeaders(),
    })
    const detail = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/characters/char-full-lore',
      headers: authHeaders(),
    })

    expect(aggregate.statusCode).toBe(200)
    expect(detail.statusCode).toBe(200)
    expect(aggregate.json().characters[0].globalLore).toEqual([
      expect.objectContaining({ key: 'resident', content: 'Resident lore' }),
    ])
    expect(detail.json().character.globalLore).toEqual([
      expect.objectContaining({ key: 'resident', content: 'Resident lore' }),
    ])
  })

  it('returns narrow character order and selection resources', async () => {
    const order = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/characters/order',
      headers: authHeaders(),
    })
    expect(order.statusCode).toBe(200)
    expect(order.json()).toEqual({
      revision,
      characterOrder: ['char-a', 'char-b'],
    })

    const selection = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/characters/char-a/selection',
      headers: authHeaders(),
    })
    expect(selection.statusCode).toBe(200)
    expect(selection.json()).toEqual({
      revision,
      characterId: 'char-a',
      currentChar: 0,
      lastInteraction: 123,
    })

    const missing = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/characters/missing/selection',
      headers: authHeaders(),
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('character_not_found')
  })

  it('serves full, ranged, and bulk chat message reads', async () => {
    const full = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/chats/chat-a/messages',
      headers: authHeaders(),
    })
    expect(full.statusCode).toBe(200)
    expect(full.json()).toMatchObject({
      revision,
      chatId: 'chat-a',
      message: [
        { uid: 'message-a', data: 'one' },
        { uid: 'message-b', data: 'two' },
      ],
      hypaV3Data: { mainChunks: [{ text: 'summary' }] },
      alternates: [],
    })

    const tail = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/chats/chat-a/messages?tail=1',
      headers: authHeaders(),
    })
    expect(tail.statusCode).toBe(200)
    expect(tail.json()).toMatchObject({
      message: [{ uid: 'message-b', data: 'two' }],
      messageStart: 1,
      messageTotal: 2,
    })

    const generationWindow = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/chats/chat-a/messages?generationMessageId=${encodeURIComponent(full.json().message[1].chatId)}`,
      headers: authHeaders(),
    })
    expect(generationWindow.statusCode).toBe(200)
    expect(generationWindow.json()).toMatchObject({
      chatId: 'chat-a',
      message: [{ uid: 'message-b', data: 'two' }],
      messageStart: 1,
      messageTotal: 2,
      alternates: [],
    })

    const bulk = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/chats/messages/bulk',
      headers: authHeaders(),
      payload: { ids: ['chat-a', 'missing', 'chat-a'] },
    })
    expect(bulk.statusCode).toBe(200)
    expect(bulk.json()).toMatchObject({
      revision,
      chats: [{ chatId: 'chat-a', message: [{ uid: 'message-a' }, { uid: 'message-b' }] }],
      missing: ['missing'],
    })

    const invalid = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/chats/chat-a/messages?tail=1&start=0',
      headers: authHeaders(),
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error).toBe('invalid_chat_message_range')

    const invalidGenerationWindow = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/chats/chat-a/messages?generationMessageId=${encodeURIComponent(full.json().message[1].chatId)}&tail=1`,
      headers: authHeaders(),
    })
    expect(invalidGenerationWindow.statusCode).toBe(400)
    expect(invalidGenerationWindow.json().error).toBe('invalid_chat_message_range')
  })

  it('serves full single and bulk character lorebooks while character rows are stubbed', async () => {
    const single = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/characters/char-a/lorebook',
      headers: authHeaders(),
    })
    expect(single.statusCode).toBe(200)
    expect(single.json()).toMatchObject({
      revision,
      characterId: 'char-a',
      globalLore: [expect.objectContaining({ key: 'Ada', content: 'Character lore' })],
    })

    const bulk = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/characters/lorebooks/bulk',
      headers: authHeaders(),
      payload: { ids: ['char-a', 'missing', 'char-b'] },
    })
    expect(bulk.statusCode).toBe(200)
    expect(bulk.json()).toMatchObject({
      revision,
      characters: [
        {
          characterId: 'char-a',
          globalLore: [expect.objectContaining({ key: 'Ada', content: 'Character lore' })],
        },
        {
          characterId: 'char-b',
          globalLore: [expect.objectContaining({ key: 'Bea', content: 'Second lore' })],
        },
      ],
      missing: ['missing'],
    })
  })

  it('serves masked legacy preset detail and prompt-preset templates', async () => {
    const legacy = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/legacy-presets/legacy-a',
      headers: authHeaders(),
    })
    expect(legacy.statusCode).toBe(200)
    expect(legacy.json()).toEqual({
      revision,
      preset: expect.objectContaining({
        id: 'legacy-a',
        name: 'Legacy A',
        openAIKey: MASKED_PROVIDER_SECRET,
        temperature: 0.7,
      }),
    })

    const template = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/prompt-presets/prompt-a/template',
      headers: authHeaders(),
    })
    expect(template.statusCode).toBe(200)
    expect(template.json()).toEqual({
      revision,
      promptPresetId: 'prompt-a',
      promptTemplate: [{ id: 'prompt-item-a', type: 'plain', text: 'Prompt text', role: 'system' }],
    })

    const empty = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/prompt-presets/prompt-empty/template',
      headers: authHeaders(),
    })
    expect(empty.statusCode).toBe(200)
    expect(empty.json()).toEqual({ revision, promptPresetId: 'prompt-empty', promptTemplate: null })

    const missing = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/prompt-presets/missing/template',
      headers: authHeaders(),
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toBe('prompt_preset_not_found')
  })
})
