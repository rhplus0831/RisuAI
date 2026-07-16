import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { getSchemaState } from '../src/db.js'
import { setupAuthedClient } from './helpers/auth.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: CommandEventSink
}

let harness: Harness
let assertion: string
let revision: number

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-command-receipts-'))
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
  return { app, dataDir, commandEvents }
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

function readSettings(): Record<string, unknown> {
  const db = openRawDatabase()
  try {
    const row = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as { data_json: string }
    return JSON.parse(row.data_json) as Record<string, unknown>
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

beforeEach(async () => {
  harness = await startHarness()
  assertion = (await setupAuthedClient(harness.app)).assertion
  revision = await importDatabase({
    theme: 'dark',
    characters: [],
    modelProfiles: [],
    agentPresets: [],
  })
  harness.commandEvents.clear()
})

afterEach(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

describe('transactional command mutation receipts', () => {
  it('replays the original result before the revision check without writing or emitting twice', async () => {
    const first = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
        'risu-mutation-id': 'autosave-1',
      },
      payload: { baseRevision: revision, patch: { theme: 'light' } },
    })
    expect(first.statusCode, first.body).toBe(200)
    const firstBody = first.json() as Record<string, unknown>
    const acceptedRevision = firstBody.revision as number
    expect(acceptedRevision).toBe(revision + 1)
    expect(readSettings().theme).toBe('light')
    expect(harness.commandEvents.list()).toHaveLength(1)
    expect(receiptCount()).toBe(1)

    const replay = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
        'risu-mutation-id': 'autosave-1',
      },
      // Durable replays rebuild the transport cursor. The receipt lookup must
      // still win even when that cursor is now stale or otherwise different.
      payload: { baseRevision: acceptedRevision + 100, patch: { theme: 'light' } },
    })
    expect(replay.statusCode, replay.body).toBe(200)
    expect(replay.json()).toEqual(firstBody)
    expect(readSettings().theme).toBe('light')
    expect(harness.commandEvents.list()).toHaveLength(1)
    expect(receiptCount()).toBe(1)

    const db = openRawDatabase()
    try {
      expect(getSchemaState(db).revision).toBe(acceptedRevision)
      expect(db.prepare('SELECT COUNT(*) AS count FROM command_events').get()).toMatchObject({ count: 2 })
    } finally {
      db.close()
    }
  })

  it('replays across writer handoffs and rejects semantic mutation-id collisions globally', async () => {
    const first = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
        'risu-mutation-id': 'shared-id',
      },
      payload: { baseRevision: revision, patch: { theme: 'light' } },
    })
    expect(first.statusCode, first.body).toBe(200)
    const firstRevision = first.json().revision as number

    const writerHandoff = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-b',
      },
    })
    expect(writerHandoff.statusCode, writerHandoff.body).toBe(200)

    const replay = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-b',
        'risu-mutation-id': 'shared-id',
      },
      payload: { baseRevision: firstRevision + 100, patch: { theme: 'light' } },
    })
    expect(replay.statusCode, replay.body).toBe(200)
    expect(replay.json()).toEqual(first.json())
    expect(readSettings().theme).toBe('light')
    expect(harness.commandEvents.list()).toHaveLength(1)
    expect(receiptCount()).toBe(1)

    const collision = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-b',
        'risu-mutation-id': 'shared-id',
      },
      payload: { baseRevision: firstRevision, patch: { theme: 'dark' } },
    })
    expect(collision.statusCode, collision.body).toBe(409)
    expect(collision.json()).toEqual({ error: 'mutation_id_conflict' })
    expect(readSettings().theme).toBe('light')
  })

  it('requires a valid writer session whenever a mutation id is present', async () => {
    const missingWriter = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      headers: {
        'risu-auth': assertion,
        'risu-mutation-id': 'autosave-without-writer',
      },
      payload: { baseRevision: revision, patch: { theme: 'light' } },
    })
    expect(missingWriter.statusCode, missingWriter.body).toBe(400)
    expect(missingWriter.json()).toEqual({
      error: 'risu-mutation-id requires a valid risu-writer-session header',
    })
    expect(readSettings().theme).toBe('dark')
    expect(harness.commandEvents.list()).toHaveLength(0)
    expect(receiptCount()).toBe(0)
  })

  it('retains unacknowledged receipts instead of expiring them during later writes', async () => {
    const first = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
        'risu-mutation-id': 'unacknowledged-old',
      },
      payload: { baseRevision: revision, patch: { theme: 'light' } },
    })
    expect(first.statusCode, first.body).toBe(200)

    const db = openRawDatabase()
    try {
      db.prepare("UPDATE command_mutation_receipts SET created_at = '2000-01-01T00:00:00.000Z'").run()
    } finally {
      db.close()
    }

    const second = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
        'risu-mutation-id': 'unacknowledged-new',
      },
      payload: { baseRevision: first.json().revision as number, patch: { zoomsize: 91 } },
    })
    expect(second.statusCode, second.body).toBe(200)
    expect(receiptCount()).toBe(2)
  })

  it('lets the current writer acknowledge a completed multi-request intent from an earlier session', async () => {
    let currentRevision = revision
    for (const [index, mutationId] of ['intent-a', 'intent-a.1', 'intent-a.2'].entries()) {
      const response = await harness.app.inject({
        method: 'PATCH',
        url: '/api/v1/commands/settings/display',
        headers: {
          'risu-auth': assertion,
          'risu-writer-session': 'writer-a',
          'risu-mutation-id': mutationId,
        },
        payload: { baseRevision: currentRevision, patch: { zoomsize: 80 + index } },
      })
      expect(response.statusCode, response.body).toBe(200)
      currentRevision = response.json().revision as number
    }

    const writerHandoff = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-b',
      },
    })
    expect(writerHandoff.statusCode, writerHandoff.body).toBe(200)
    expect(receiptCount()).toBe(3)

    const acknowledged = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/mutation-receipts/ack',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-b',
      },
      payload: { mutationId: 'intent-a', requestCount: 3 },
    })
    expect(acknowledged.statusCode, acknowledged.body).toBe(200)
    expect(acknowledged.json()).toEqual({ acknowledged: 3, requested: 3 })
    expect(receiptCount()).toBe(0)

    const repeated = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/mutation-receipts/ack',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-b',
      },
      payload: { mutationId: 'intent-a', requestCount: 3 },
    })
    expect(repeated.statusCode, repeated.body).toBe(200)
    expect(repeated.json()).toEqual({ acknowledged: 0, requested: 3 })

    const db = openRawDatabase()
    try {
      expect(getSchemaState(db).revision).toBe(currentRevision)
      expect(db.prepare('SELECT mutation_id FROM command_mutation_receipts').all()).toEqual([])
    } finally {
      db.close()
    }
  })

  it('rolls back the domain write, revision, and event when receipt persistence fails', async () => {
    const db = openRawDatabase()
    try {
      db.exec(`
        CREATE TRIGGER fail_command_mutation_receipt_insert
        BEFORE INSERT ON command_mutation_receipts
        BEGIN
          SELECT RAISE(FAIL, 'injected receipt persistence failure');
        END;
      `)
    } finally {
      db.close()
    }

    const failed = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
        'risu-mutation-id': 'atomic-write',
      },
      payload: { baseRevision: revision, patch: { theme: 'light' } },
    })
    expect(failed.statusCode).toBe(500)
    expect(readSettings().theme).toBe('dark')
    expect(harness.commandEvents.list()).toHaveLength(0)
    expect(receiptCount()).toBe(0)

    const after = openRawDatabase()
    try {
      expect(getSchemaState(after).revision).toBe(revision)
      expect(after.prepare('SELECT COUNT(*) AS count FROM command_events').get()).toMatchObject({ count: 1 })
    } finally {
      after.close()
    }
  })

  it('threads receipts through model-profile and Agent Preset command wrappers', async () => {
    const profile = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/model-profiles',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
        'risu-mutation-id': 'profile-create',
      },
      payload: {
        baseRevision: revision,
        profile: { name: 'Durable profile', providerId: 'openai', modelId: 'gpt-5' },
      },
    })
    expect(profile.statusCode, profile.body).toBe(200)
    const profileBody = profile.json() as Record<string, unknown>
    const profileRevision = profileBody.revision as number

    const profileReplay = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/model-profiles',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
        'risu-mutation-id': 'profile-create',
      },
      payload: {
        baseRevision: profileRevision,
        profile: { name: 'Durable profile', providerId: 'openai', modelId: 'gpt-5' },
      },
    })
    expect(profileReplay.statusCode, profileReplay.body).toBe(200)
    expect(profileReplay.json()).toEqual(profileBody)

    const preset = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/agent-presets',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
        'risu-mutation-id': 'agent-preset-create',
      },
      payload: {
        baseRevision: profileRevision,
        preset: { name: 'Durable agent preset' },
      },
    })
    expect(preset.statusCode, preset.body).toBe(200)
    const presetBody = preset.json() as Record<string, unknown>

    const presetReplay = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/commands/agent-presets',
      headers: {
        'risu-auth': assertion,
        'risu-writer-session': 'writer-a',
        'risu-mutation-id': 'agent-preset-create',
      },
      payload: {
        baseRevision: presetBody.revision as number,
        preset: { name: 'Durable agent preset' },
      },
    })
    expect(presetReplay.statusCode, presetReplay.body).toBe(200)
    expect(presetReplay.json()).toEqual(presetBody)

    const settings = readSettings()
    expect(settings.modelProfiles).toHaveLength(1)
    expect(settings.agentPresets).toHaveLength(1)
    expect(receiptCount()).toBe(2)
  })
})
