import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { getSchemaState, openDatabase } from '../src/db.js'
import {
  COMMAND_EVENT_CATALOG,
  createCommandEventSink,
  type CommandEventDraft,
  type CommandEventSink,
} from '../src/commands/events.js'
import { TARGETED_MUTATION_PATHS, applyTargetedCommandMutation } from '../src/commands/mutations.js'
import {
  writePersistedWithMessages,
  writePluginStorageKey,
  writeSettingsOnly,
  writeSingleCharacterRow,
  writeSingleChatRow,
  writeSingleCollectionRow,
} from '../src/repository.js'
import { assertCommandMetricGate, type CommandMutationMetric } from './helpers/commandMetricGates.js'

// Targeted-mutation-path regression. Each `mutationPath` label is reachable
// through `applyTargetedCommandMutation` + the writer kit, reports its label and
// narrow `writtenTables` to the metric, and produces the same single revision
// bump / single persisted event / narrow return shape as the generic helpers.

const PREVIOUS_PROTOCOL_METRICS = process.env.RISU_PROTOCOL_METRICS

let dataDir: string
let db: DatabaseSync
let eventSink: CommandEventSink
let metrics: CommandMutationMetric[]
let infoSpy: ReturnType<typeof vi.spyOn>

function seedDatabase(): void {
  const database = {
    currentChar: 0,
    theme: 'dark',
    botPresets: [{ name: 'preset-0' }, { name: 'preset-1' }],
    pluginCustomStorage: { existing: { mode: 'baseline' } },
    characters: [
      {
        chaId: 'char-a',
        name: 'A',
        chats: [
          { id: 'chat-a-1', name: 'A1', message: [] },
          { id: 'chat-a-2', name: 'A2', message: [] },
        ],
      },
      { chaId: 'char-b', name: 'B', chats: [{ id: 'chat-b-1', name: 'B1', message: [] }] },
    ],
  }
  writePersistedWithMessages(db, dataDir, { _version: 1, database, assets: [] })
}

function readJsonColumn(table: string, where: string, key: string): Record<string, unknown> {
  const row = db.prepare(`SELECT ${key} AS j FROM ${table} WHERE ${where}`).get() as { j: string }
  return JSON.parse(row.j) as Record<string, unknown>
}

interface PathCase {
  label: (typeof TARGETED_MUTATION_PATHS)[keyof typeof TARGETED_MUTATION_PATHS]
  draft: CommandEventDraft
  write: (innerDb: DatabaseSync) => void
  expectedTables: string[]
}

const CASES: PathCase[] = [
  {
    label: TARGETED_MUTATION_PATHS.settings,
    draft: COMMAND_EVENT_CATALOG.settingsUpdated,
    write: (innerDb) => {
      const settings = readJsonColumn('settings', 'id = 1', 'data_json')
      settings.theme = 'light'
      writeSettingsOnly(innerDb, settings)
    },
    expectedTables: ['settings'],
  },
  {
    label: TARGETED_MUTATION_PATHS.characterRow,
    draft: { ...COMMAND_EVENT_CATALOG.characterUpdated, id: 'char-b' },
    write: (innerDb) => {
      const character = readJsonColumn('characters', "id = 'char-b'", 'data_json')
      character.name = 'B renamed'
      writeSingleCharacterRow(innerDb, 'char-b', character)
    },
    expectedTables: ['characters'],
  },
  {
    label: TARGETED_MUTATION_PATHS.chatRow,
    draft: { ...COMMAND_EVENT_CATALOG.chatUpdated, id: 'chat-a-1' },
    write: (innerDb) => {
      const chat = readJsonColumn('chats', "id = 'chat-a-1'", 'data_json')
      chat.name = 'A1 renamed'
      writeSingleChatRow(innerDb, 'chat-a-1', chat)
    },
    expectedTables: ['chats'],
  },
  {
    label: TARGETED_MUTATION_PATHS.collection,
    draft: COMMAND_EVENT_CATALOG.presetUpdated,
    write: (innerDb) => {
      writeSingleCollectionRow(innerDb, 'botPresets', 0, { name: 'preset-0 renamed' })
    },
    expectedTables: ['bot_presets'],
  },
  {
    label: TARGETED_MUTATION_PATHS.pluginStorage,
    draft: { ...COMMAND_EVENT_CATALOG.pluginStorageUpdated, id: 'fresh' },
    write: (innerDb) => {
      writePluginStorageKey(innerDb, 'fresh', { mode: 'added' })
    },
    expectedTables: ['plugin_custom_storage'],
  },
]

beforeEach(() => {
  process.env.RISU_PROTOCOL_METRICS = '1'
  metrics = []
  infoSpy = vi.spyOn(console, 'info').mockImplementation((message: unknown) => {
    if (typeof message !== 'string' || !message.startsWith('[protocol-metric] ')) return
    metrics.push(JSON.parse(message.slice('[protocol-metric] '.length)) as CommandMutationMetric)
  })
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-targeted-paths-'))
  db = openDatabase(dataDir)
  seedDatabase()
  eventSink = createCommandEventSink()
})

afterEach(() => {
  infoSpy.mockRestore()
  if (PREVIOUS_PROTOCOL_METRICS === undefined) {
    delete process.env.RISU_PROTOCOL_METRICS
  } else {
    process.env.RISU_PROTOCOL_METRICS = PREVIOUS_PROTOCOL_METRICS
  }
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('targeted mutation paths', () => {
  for (const testCase of CASES) {
    it(`${testCase.label} bumps one revision, persists one event, writes only ${testCase.expectedTables.join('+')}`, () => {
      const baseRevision = getSchemaState(db).revision
      eventSink.clear()
      metrics = []

      const result = applyTargetedCommandMutation({
        db,
        dataDir,
        baseRevision,
        eventSink,
        mutationPath: testCase.label,
        mutate: (_database, innerDb) => {
          testCase.write(innerDb)
          return { event: { ...testCase.draft } }
        },
      })

      // Same revision/event shape as the generic path: one bump, draft + revision.
      expect(result.revision).toBe(baseRevision + 1)
      expect(result.event).toEqual({ ...testCase.draft, revision: baseRevision + 1 })
      expect(getSchemaState(db).revision).toBe(baseRevision + 1)

      // Exactly one live event and one durable command-event row at this revision.
      expect(eventSink.list()).toEqual([{ ...testCase.draft, revision: baseRevision + 1 }])
      const persisted = db
        .prepare('SELECT type, resource FROM command_events WHERE revision = ?')
        .all(baseRevision + 1) as Array<{ type: string; resource: string }>
      expect(persisted).toEqual([{ type: testCase.draft.type, resource: testCase.draft.resource }])

      // Metric reports the label, the narrow written-table set, dbJsonWriteMs 0,
      // and satisfies its review gate.
      const metric = metrics.find((entry) => entry.metric === 'command_mutation' && entry.status === 'ok')
      expect(metric, `missing metric for ${testCase.label}`).toBeTruthy()
      expect(metric?.mutationPath).toBe(testCase.label)
      expect(metric?.writtenTables).toEqual(testCase.expectedTables)
      expect(metric?.dbJsonWriteMs).toBe(0)
      assertCommandMetricGate(metric as CommandMutationMetric)
    })
  }

  it('rolls back the targeted write and revision on a callback error', () => {
    const baseRevision = getSchemaState(db).revision
    eventSink.clear()

    expect(() =>
      applyTargetedCommandMutation({
        db,
        dataDir,
        baseRevision,
        eventSink,
        mutationPath: TARGETED_MUTATION_PATHS.settings,
        mutate: (_database, innerDb) => {
          writeSettingsOnly(innerDb, { theme: 'should-roll-back' })
          throw new Error('boom')
        },
      }),
    ).toThrow('boom')

    // No revision bump, no event, and the write rolled back.
    expect(getSchemaState(db).revision).toBe(baseRevision)
    expect(eventSink.list()).toEqual([])
    expect(readJsonColumn('settings', 'id = 1', 'data_json').theme).toBe('dark')
  })
})
