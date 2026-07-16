import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { getSchemaState } from '../src/db.js'
import { getDatabaseLineage } from '../src/databaseLineage.js'
import { setupAuthedClient } from './helpers/auth.js'

interface Harness {
  app: FastifyInstance
  commandEvents: CommandEventSink
  dataDir: string
}

interface DeleteCase {
  body?: Record<string, unknown>
  event: { id: string; resource: string; type: string }
  extra?: Record<string, unknown>
  name: string
  url: string
}

let assertion: string
let databaseLineage: string
let harness: Harness
let revision: number

function lorebookEntry(id: string) {
  return {
    id,
    key: id,
    secondkey: '',
    insertorder: 100,
    comment: id,
    content: `${id} content`,
    mode: 'normal',
    alwaysActive: false,
    selective: false,
  }
}

function durableDeleteSeed(): Record<string, unknown> {
  return {
    currentChar: 0,
    characterOrder: ['char-chat', 'char-delete'],
    characters: [
      {
        chaId: 'char-chat',
        name: 'Chat owner',
        globalLore: [lorebookEntry('entry-character')],
        chats: [
          {
            id: 'chat-delete',
            name: 'Delete chat',
            note: '',
            message: [],
            localLore: [lorebookEntry('entry-chat')],
            folderId: 'folder-delete',
          },
          { id: 'chat-stay', name: 'Stay chat', note: '', message: [], localLore: [] },
        ],
        chatFolders: [{ id: 'folder-delete', name: 'Delete folder', folded: false }],
        chatPage: 0,
      },
      {
        chaId: 'char-delete',
        name: 'Delete character',
        globalLore: [],
        chats: [],
        chatFolders: [],
        chatPage: 0,
      },
    ],
    modelPresetsId: 0,
    modelPresets: [
      { id: 'model-delete', name: 'Delete model preset' },
      { id: 'model-stay', name: 'Stay model preset' },
    ],
    promptPresetsId: 0,
    promptPresets: [
      {
        id: 'prompt-delete',
        name: 'Delete prompt preset',
        promptTemplate: [{ id: 'item-delete', type: 'plain', text: 'Delete item' }],
      },
      { id: 'prompt-stay', name: 'Stay prompt preset' },
    ],
    promptTemplate: [{ id: 'root-item-delete', type: 'memory', text: 'Delete root item' }],
    personas: [
      { id: 'persona-delete', name: 'Delete persona', icon: '', personaPrompt: '', note: '' },
      { id: 'persona-stay', name: 'Stay persona', icon: '', personaPrompt: '', note: '' },
    ],
    selectedPersona: 0,
    username: 'Delete persona',
    userIcon: '',
    personaPrompt: '',
    userNote: '',
    translatorPresets: [
      { id: 'translator-delete', name: 'Delete translator preset', prompt: '', maxResponse: 100 },
      { id: 'translator-stay', name: 'Stay translator preset', prompt: '', maxResponse: 100 },
    ],
    translatorPresetId: 0,
    translatorPrompt: '',
    translatorMaxResponse: 100,
    modules: [
      {
        id: 'module-delete',
        name: 'Delete module',
        description: '',
        lorebook: [lorebookEntry('entry-module')],
      },
      { id: 'module-stay', name: 'Stay module', description: '', lorebook: [] },
    ],
    loreBookPage: 0,
    loreBook: [
      { id: 'book-delete', name: 'Delete lorebook', data: [lorebookEntry('entry-global')] },
      { id: 'book-stay', name: 'Stay lorebook', data: [] },
    ],
  }
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-durable-delete-'))
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
    assetGc: false,
    memoryWorker: false,
  })
  return { app, commandEvents, dataDir }
}

async function importDatabase(database: Record<string, unknown>): Promise<number> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json().revision as number
}

function openRawDatabase(): DatabaseSync {
  return new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
}

function readDatabaseLineage(): string {
  const db = openRawDatabase()
  try {
    return getDatabaseLineage(db)
  } finally {
    db.close()
  }
}

function readRevision(): number {
  const db = openRawDatabase()
  try {
    return getSchemaState(db).revision
  } finally {
    db.close()
  }
}

function receiptCount(): number {
  const db = openRawDatabase()
  try {
    const row = db.prepare('SELECT COUNT(*) AS count FROM command_mutation_receipts').get() as { count: number }
    return row.count
  } finally {
    db.close()
  }
}

async function deleteCommand(testCase: Pick<DeleteCase, 'body' | 'url'>, baseRevision: number, mutationId?: string) {
  return harness.app.inject({
    method: 'DELETE',
    url: testCase.url,
    headers: {
      'risu-auth': assertion,
      ...(mutationId
        ? {
            'risu-writer-session': 'writer-durable-delete',
            'risu-mutation-id': mutationId,
            'risu-database-lineage': databaseLineage,
          }
        : {}),
    },
    payload: { baseRevision, ...testCase.body },
  })
}

beforeEach(async () => {
  harness = await startHarness()
  assertion = (await setupAuthedClient(harness.app)).assertion
  revision = await importDatabase(durableDeleteSeed())
  databaseLineage = readDatabaseLineage()
  harness.commandEvents.clear()
})

afterEach(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

const DURABLE_DELETE_CASES: DeleteCase[] = [
  {
    name: 'characters',
    url: '/api/v1/commands/characters/char-delete',
    event: { type: 'character.deleted', resource: 'character', id: 'char-delete' },
    extra: { selectedCharacterId: 'char-chat' },
  },
  {
    name: 'chats',
    url: '/api/v1/commands/chats/chat-delete',
    event: { type: 'chat.deleted', resource: 'characterRow', id: 'chat-delete' },
    extra: { selectedChatId: 'chat-stay' },
  },
  {
    name: 'chat folders',
    url: '/api/v1/commands/chat-folders/folder-delete',
    event: { type: 'chatFolder.deleted', resource: 'characterRow', id: 'folder-delete' },
  },
  {
    name: 'prompt items',
    url: '/api/v1/commands/prompt-items/item-delete',
    body: { promptPresetId: 'prompt-delete' },
    event: { type: 'prompt.item.deleted', resource: 'promptItem', id: 'item-delete' },
  },
  {
    name: 'root prompt items',
    url: '/api/v1/commands/prompt-items/root-item-delete',
    event: { type: 'prompt.item.deleted', resource: 'promptItem', id: 'root-item-delete' },
  },
  {
    name: 'personas',
    url: '/api/v1/commands/personas/persona-delete',
    body: { selectPersonaId: 'persona-stay', mirrorLegacyProfile: true, saveCurrent: true },
    event: { type: 'persona.deleted', resource: 'persona', id: 'persona-delete' },
    extra: { selectedPersonaId: 'persona-stay', cascadedChatCount: 0, cascadedLoadoutCount: 0 },
  },
  {
    name: 'model presets',
    url: '/api/v1/commands/model-presets/model-delete',
    body: { modelPresetId: 'model-stay' },
    event: { type: 'modelPreset.deleted', resource: 'modelPreset', id: 'model-delete' },
    extra: { selectedModelPresetId: 'model-stay', cascadedChatCount: 0, cascadedLoadoutCount: 0 },
  },
  {
    name: 'prompt presets',
    url: '/api/v1/commands/prompt-presets/prompt-delete',
    body: { promptPresetId: 'prompt-stay' },
    event: { type: 'promptPreset.deleted', resource: 'promptPreset', id: 'prompt-delete' },
    extra: { selectedPromptPresetId: 'prompt-stay', cascadedChatCount: 0, cascadedLoadoutCount: 0 },
  },
  {
    name: 'translator presets',
    url: '/api/v1/commands/translator-presets/translator-delete',
    body: { selectPresetId: 'translator-stay' },
    event: { type: 'translatorPreset.deleted', resource: 'translatorPreset', id: 'translator-delete' },
    extra: { selectedPresetId: 'translator-stay' },
  },
  {
    name: 'modules',
    url: '/api/v1/commands/modules/module-delete',
    event: { type: 'module.deleted', resource: 'module', id: 'module-delete' },
  },
  {
    name: 'global lorebooks',
    url: '/api/v1/commands/lorebooks/book-delete',
    event: { type: 'lorebook.deleted', resource: 'globalLorebook', id: 'book-delete' },
  },
  {
    name: 'global lorebook entries',
    url: '/api/v1/commands/lorebooks/book-delete/entries/entry-global',
    event: { type: 'lorebook.entries.replaced', resource: 'globalLorebook', id: 'book-delete' },
  },
  {
    name: 'character lorebook entries',
    url: '/api/v1/commands/characters/char-chat/lorebooks/entries/entry-character',
    event: { type: 'lorebook.entries.replaced', resource: 'characterLorebook', id: 'char-chat' },
  },
  {
    name: 'chat lorebook entries',
    url: '/api/v1/commands/chats/chat-delete/lorebooks/entries/entry-chat',
    event: { type: 'lorebook.entries.replaced', resource: 'characterRow', id: 'chat-delete' },
  },
  {
    name: 'module lorebook entries',
    url: '/api/v1/commands/modules/module-delete/lorebooks/entries/entry-module',
    event: { type: 'lorebook.entries.replaced', resource: 'moduleUpdated', id: 'module-delete' },
  },
]

describe('durable DELETE idempotency', () => {
  it.each(DURABLE_DELETE_CASES)('$name accepts a second intent after the target was removed', async (testCase) => {
    const first = await deleteCommand(testCase, revision, `${testCase.name.replaceAll(' ', '-')}-first`)
    expect(first.statusCode, first.body).toBe(200)
    expect(first.json()).toMatchObject({
      revision: revision + 1,
      event: { ...testCase.event, revision: revision + 1 },
      ...testCase.extra,
    })

    const second = await deleteCommand(testCase, first.json().revision, `${testCase.name.replaceAll(' ', '-')}-second`)
    expect(second.statusCode, second.body).toBe(200)
    expect(second.json()).toMatchObject({
      revision: revision + 2,
      event: { ...testCase.event, revision: revision + 2 },
      ...testCase.extra,
    })
    if (testCase.name.endsWith('entries')) {
      expect(second.json().entryIndex).toBe(-1)
    }
    expect(readRevision()).toBe(revision + 2)
    expect(receiptCount()).toBe(2)
    expect(harness.commandEvents.list()).toHaveLength(2)
  })

  const ONE_ITEM_ABSENT_CASES: DeleteCase[] = [
    {
      name: 'model preset',
      url: '/api/v1/commands/model-presets/missing-model',
      body: { modelPresetId: 'missing-replacement' },
      event: { type: 'modelPreset.deleted', resource: 'modelPreset', id: 'missing-model' },
      extra: { selectedModelPresetId: 'only-model', cascadedChatCount: 0, cascadedLoadoutCount: 0 },
    },
    {
      name: 'prompt preset',
      url: '/api/v1/commands/prompt-presets/missing-prompt',
      body: { promptPresetId: 'missing-replacement' },
      event: { type: 'promptPreset.deleted', resource: 'promptPreset', id: 'missing-prompt' },
      extra: { selectedPromptPresetId: 'only-prompt', cascadedChatCount: 0, cascadedLoadoutCount: 0 },
    },
    {
      name: 'persona',
      url: '/api/v1/commands/personas/missing-persona',
      body: { selectPersonaId: 'missing-replacement' },
      event: { type: 'persona.deleted', resource: 'persona', id: 'missing-persona' },
      extra: { selectedPersonaId: 'only-persona', cascadedChatCount: 0, cascadedLoadoutCount: 0 },
    },
    {
      name: 'translator preset',
      url: '/api/v1/commands/translator-presets/missing-translator',
      body: { selectPresetId: 'missing-replacement' },
      event: {
        type: 'translatorPreset.deleted',
        resource: 'translatorPreset',
        id: 'missing-translator',
      },
      extra: { selectedPresetId: 'only-translator' },
    },
    {
      name: 'chat',
      url: '/api/v1/commands/chats/missing-chat',
      event: { type: 'chat.deleted', resource: 'characterRow', id: 'missing-chat' },
      extra: { selectedChatId: 'only-chat' },
    },
    {
      name: 'global lorebook',
      url: '/api/v1/commands/lorebooks/missing-book',
      event: { type: 'lorebook.deleted', resource: 'globalLorebook', id: 'missing-book' },
    },
  ]

  it.each(ONE_ITEM_ABSENT_CASES)('$name checks target absence before the last-item guard', async (testCase) => {
    revision = await importDatabase({
      modelPresetsId: 0,
      modelPresets: [{ id: 'only-model', name: 'Only model preset' }],
      promptPresetsId: 0,
      promptPresets: [{ id: 'only-prompt', name: 'Only prompt preset' }],
      personas: [{ id: 'only-persona', name: 'Only persona', icon: '', personaPrompt: '', note: '' }],
      selectedPersona: 0,
      translatorPresets: [{ id: 'only-translator', name: 'Only translator', prompt: '', maxResponse: 100 }],
      translatorPresetId: 0,
      currentChar: 0,
      characters: [
        {
          chaId: 'only-character',
          name: 'Only character',
          chats: [{ id: 'only-chat', name: 'Only chat', note: '', message: [], localLore: [] }],
          chatFolders: [],
          chatPage: 0,
        },
      ],
      characterOrder: ['only-character'],
      loreBookPage: 0,
      loreBook: [{ id: 'only-book', name: 'Only lorebook', data: [] }],
    })
    databaseLineage = readDatabaseLineage()
    harness.commandEvents.clear()

    const response = await deleteCommand(testCase, revision)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      revision: revision + 1,
      event: { ...testCase.event, revision: revision + 1 },
      ...testCase.extra,
    })
    expect(readRevision()).toBe(revision + 1)
  })

  const INVALID_REPLACEMENT_CASES = [
    {
      name: 'model preset',
      url: '/api/v1/commands/model-presets/model-delete',
      body: { modelPresetId: 'missing-model' },
      error: 'Model preset not found: missing-model',
    },
    {
      name: 'prompt preset',
      url: '/api/v1/commands/prompt-presets/prompt-delete',
      body: { promptPresetId: 'missing-prompt' },
      error: 'Prompt preset not found: missing-prompt',
    },
    {
      name: 'persona',
      url: '/api/v1/commands/personas/persona-delete',
      body: { selectPersonaId: 'missing-persona' },
      error: 'Persona not found: missing-persona',
    },
    {
      name: 'translator preset',
      url: '/api/v1/commands/translator-presets/translator-delete',
      body: { selectPresetId: 'missing-translator' },
      error: 'Translator preset not found: missing-translator',
    },
  ]

  it.each(INVALID_REPLACEMENT_CASES)(
    '$name still rejects a missing replacement for an existing target',
    async (testCase) => {
      const response = await deleteCommand(testCase, revision)
      expect(response.statusCode, response.body).toBe(404)
      expect(response.json()).toEqual({ error: testCase.error })
      expect(readRevision()).toBe(revision)
      expect(harness.commandEvents.list()).toHaveLength(0)
    },
  )

  const MISSING_OWNER_CASES: DeleteCase[] = [
    {
      name: 'prompt item',
      url: '/api/v1/commands/prompt-items/missing-item',
      body: { promptPresetId: 'missing-prompt' },
      event: { type: 'prompt.item.deleted', resource: 'promptItem', id: 'missing-item' },
    },
    {
      name: 'global lorebook entry',
      url: '/api/v1/commands/lorebooks/missing-book/entries/missing-entry',
      event: { type: 'lorebook.entries.replaced', resource: 'globalLorebook', id: 'missing-book' },
    },
    {
      name: 'character lorebook entry',
      url: '/api/v1/commands/characters/missing-character/lorebooks/entries/missing-entry',
      event: {
        type: 'lorebook.entries.replaced',
        resource: 'characterLorebook',
        id: 'missing-character',
      },
    },
    {
      name: 'chat lorebook entry',
      url: '/api/v1/commands/chats/missing-chat/lorebooks/entries/missing-entry',
      event: { type: 'lorebook.entries.replaced', resource: 'characterRow', id: 'missing-chat' },
    },
    {
      name: 'module lorebook entry',
      url: '/api/v1/commands/modules/missing-module/lorebooks/entries/missing-entry',
      event: { type: 'lorebook.entries.replaced', resource: 'moduleUpdated', id: 'missing-module' },
    },
  ]

  it.each(MISSING_OWNER_CASES)('$name treats a missing owner as an absent target', async (testCase) => {
    const response = await deleteCommand(testCase, revision)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      revision: revision + 1,
      event: { ...testCase.event, revision: revision + 1 },
    })
    if (testCase.name.endsWith('entry')) {
      expect(response.json().entryIndex).toBe(-1)
    }
    expect(readRevision()).toBe(revision + 1)
  })
})
