import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { applyMigrations, CURRENT_SCHEMA_VERSION, getSchemaState, openDatabase } from '../src/db.js'

const dataDirs: string[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-db-'))
  dataDirs.push(dataDir)
  return dataDir
}

function seedSchemaVersion(dataDir: string, version: number, revision = 0): void {
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    db.exec(`
      CREATE TABLE schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0
      )
    `)
    db.prepare('INSERT INTO schema_version (id, version, revision) VALUES (1, ?, ?)').run(
      version,
      revision,
    )
  } finally {
    db.close()
  }
}

function listTables(db: DatabaseSync): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string
    }[]
  ).map((row) => row.name)
}

function insertMemoryChunk(db: DatabaseSync, id = 'chunk-1'): void {
  db.prepare(
    `
      INSERT INTO memory_chunks (
        id,
        chat_id,
        message_id,
        range_start_seq,
        range_end_seq,
        text,
        status
      ) VALUES (?, 'chat-1', 'message-1', 0, 3, 'chunk text', 'pending')
    `,
  ).run(id)
}

afterEach(() => {
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

describe('schema migrations', () => {
  it('opens a fresh database at the current schema version', () => {
    const db = openDatabase(makeDataDir())
    try {
      expect(getSchemaState(db)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 0 })
      expect(listTables(db)).toEqual([
        'chat_hypa_v3',
        'memory_chunks',
        'memory_embeddings',
        'memory_jobs',
        'memory_summaries',
        'messages',
        'schema_version',
      ])
    } finally {
      db.close()
    }
  })

  it('applies the migration runner version bump without changing revision', () => {
    const dataDir = makeDataDir()
    seedSchemaVersion(dataDir, 0, 7)

    const db = openDatabase(dataDir)
    try {
      expect(getSchemaState(db)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 7 })
      expect(listTables(db)).toEqual([
        'chat_hypa_v3',
        'memory_chunks',
        'memory_embeddings',
        'memory_jobs',
        'memory_summaries',
        'messages',
        'schema_version',
      ])
    } finally {
      db.close()
    }
  })

  it('adds the reroll-alternate column to a pre-v6 messages table, preserving rows (v6)', () => {
    const dataDir = makeDataDir()
    // Reconstruct an existing v5 database: schema_version at 5 + the OLD messages
    // table (no `alternate` column) with a row.
    const seed = new DatabaseSync(path.join(dataDir, 'risu.db'))
    try {
      seed.exec(`
        CREATE TABLE schema_version (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL,
          revision INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO schema_version (id, version, revision) VALUES (1, 5, 9);
        CREATE TABLE messages (
          chat_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          uid TEXT NOT NULL,
          role TEXT NOT NULL,
          data TEXT NOT NULL,
          disabled TEXT,
          json TEXT NOT NULL,
          PRIMARY KEY (chat_id, seq)
        );
        INSERT INTO messages (chat_id, seq, uid, role, data, json)
          VALUES ('chat-1', 0, 'm-0', 'user', 'hi', '{"chatId":"m-0","role":"user","data":"hi"}');
      `)
    } finally {
      seed.close()
    }

    const db = openDatabase(dataDir)
    try {
      expect(getSchemaState(db)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 9 })
      const columns = (
        db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
      ).map((row) => row.name)
      expect(columns).toContain('alternate')
      // The pre-existing row defaults to an active (alternate = 0) row, intact.
      const row = db
        .prepare('SELECT data, alternate FROM messages WHERE chat_id = ? AND seq = 0')
        .get('chat-1')
      expect(row).toEqual({ data: 'hi', alternate: 0 })
    } finally {
      db.close()
    }
  })

  it('is safe to reopen and reapply after migrations are current', () => {
    const dataDir = makeDataDir()
    seedSchemaVersion(dataDir, 0, 3)

    const first = openDatabase(dataDir)
    first.close()

    const second = openDatabase(dataDir)
    try {
      applyMigrations(second, getSchemaState(second).version)
      expect(getSchemaState(second)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 3 })
      insertMemoryChunk(second)
      const chunk = second
        .prepare('SELECT id, status FROM memory_chunks WHERE id = ?')
        .get('chunk-1')
      expect(chunk).toEqual({ id: 'chunk-1', status: 'pending' })
    } finally {
      second.close()
    }
  })

  it('enforces memory table status, kind, and payload constraints', () => {
    const db = openDatabase(makeDataDir())
    try {
      expect(() => {
        db.prepare(
          `
            INSERT INTO memory_chunks (
              id,
              chat_id,
              range_start_seq,
              range_end_seq,
              text,
              status
            ) VALUES ('chunk-1', 'chat-1', 0, 1, 'text', 'queued')
          `,
        ).run()
      }).toThrow()

      expect(() => {
        db.prepare(
          `
            INSERT INTO memory_jobs (
              id,
              chat_id,
              kind,
              status,
              payload_json
            ) VALUES ('job-1', 'chat-1', 'translate', 'pending', '{}')
          `,
        ).run()
      }).toThrow()

      expect(() => {
        db.prepare(
          `
            INSERT INTO memory_jobs (
              id,
              chat_id,
              kind,
              status,
              payload_json
            ) VALUES ('job-2', 'chat-1', 'chunk', 'pending', 'not json')
          `,
        ).run()
      }).toThrow()
    } finally {
      db.close()
    }
  })

  it('cascades summaries and embeddings when a memory chunk is deleted', () => {
    const db = openDatabase(makeDataDir())
    try {
      insertMemoryChunk(db)
      db.prepare(
        `
          INSERT INTO memory_summaries (
            id,
            chat_id,
            chunk_id,
            model,
            text,
            tokens
          ) VALUES ('summary-1', 'chat-1', 'chunk-1', 'model-a', 'summary text', 12)
        `,
      ).run()
      db.prepare(
        `
          INSERT INTO memory_embeddings (
            id,
            chat_id,
            chunk_id,
            model,
            vector_blob,
            dim
          ) VALUES ('embedding-1', 'chat-1', 'chunk-1', 'model-a', X'00010203', 4)
        `,
      ).run()

      db.prepare("DELETE FROM memory_chunks WHERE id = 'chunk-1'").run()

      expect(db.prepare('SELECT COUNT(*) AS count FROM memory_summaries').get()).toEqual({
        count: 0,
      })
      expect(db.prepare('SELECT COUNT(*) AS count FROM memory_embeddings').get()).toEqual({
        count: 0,
      })
    } finally {
      db.close()
    }
  })

  it('rejects databases newer than the app schema version', () => {
    const dataDir = makeDataDir()
    seedSchemaVersion(dataDir, CURRENT_SCHEMA_VERSION + 1)

    expect(() => openDatabase(dataDir)).toThrow(/newer than supported version/)

    const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
    try {
      expect(listTables(db)).toEqual(['schema_version'])
    } finally {
      db.close()
    }
  })

  it('requires the singleton schema_version row when applying migrations', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(`
        CREATE TABLE schema_version (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL,
          revision INTEGER NOT NULL DEFAULT 0
        )
      `)

      expect(() => applyMigrations(db, 0)).toThrow(/schema_version row missing/)
    } finally {
      db.close()
    }
  })
})
