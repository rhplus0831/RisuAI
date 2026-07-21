import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assessDatabaseInitialization } from '../src/databaseInitialization.js'
import { openDatabase } from '../src/db.js'

const dataDirs: string[] = []

function makeDatabase() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-initialization-'))
  dataDirs.push(dataDir)
  return openDatabase(dataDir)
}

afterEach(() => {
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

describe('database initialization assessment', () => {
  it('classifies an empty schema as uninitialized and a settings object as initialized', () => {
    const db = makeDatabase()
    try {
      expect(assessDatabaseInitialization(db)).toEqual({ state: 'uninitialized', evidence: [] })

      db.prepare("INSERT INTO settings (id, data_json) VALUES (1, '{}')").run()
      expect(assessDatabaseInitialization(db)).toEqual({ state: 'initialized', evidence: [] })
    } finally {
      db.close()
    }
  })

  it('allows a malformed settings row to be replaced only when no protected data exists', () => {
    const db = makeDatabase()
    try {
      db.prepare("INSERT INTO settings (id, data_json) VALUES (1, '[]')").run()
      expect(assessDatabaseInitialization(db)).toEqual({ state: 'uninitialized', evidence: [] })
    } finally {
      db.close()
    }
  })

  it.each([
    {
      label: 'characters',
      seed: (db: ReturnType<typeof makeDatabase>) =>
        db
          .prepare('INSERT INTO characters (id, position, data_json) VALUES (\'char-a\', 0, \'{"chaId":"char-a"}\')')
          .run(),
      evidence: 'characters',
    },
    {
      label: 'chats',
      seed: (db: ReturnType<typeof makeDatabase>) => {
        db.prepare(
          'INSERT INTO characters (id, position, data_json) VALUES (\'char-a\', 0, \'{"chaId":"char-a"}\')',
        ).run()
        db.prepare(
          "INSERT INTO chats (id, character_id, position, data_json) VALUES ('chat-a', 'char-a', 0, '{\"id\":\"chat-a\"}')",
        ).run()
      },
      evidence: 'chats',
    },
    {
      label: 'messages',
      seed: (db: ReturnType<typeof makeDatabase>) =>
        db
          .prepare(
            "INSERT INTO messages (chat_id, seq, uid, role, data, json) VALUES ('chat-a', 0, 'message-a', 'user', 'hello', '{}')",
          )
          .run(),
      evidence: 'messages',
    },
    {
      label: 'a positive revision',
      seed: (db: ReturnType<typeof makeDatabase>) =>
        db.prepare('UPDATE schema_version SET revision = 4 WHERE id = 1').run(),
      evidence: 'revision=4',
    },
    {
      label: 'command event history',
      seed: (db: ReturnType<typeof makeDatabase>) =>
        db.prepare("INSERT INTO command_events (revision, type, resource) VALUES (0, 'test.event', 'state')").run(),
      evidence: 'command_events',
    },
  ])('classifies $label without settings as a conflict', ({ seed, evidence }) => {
    const db = makeDatabase()
    try {
      seed(db)
      const assessment = assessDatabaseInitialization(db)
      expect(assessment.state).toBe('conflict')
      expect(assessment.evidence).toContain(evidence)
    } finally {
      db.close()
    }
  })
})
