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
    db.prepare('INSERT INTO schema_version (id, version, revision) VALUES (1, ?, ?)').run(version, revision)
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
        'assets',
        'bot_presets',
        'characters',
        'chat_hypa_v3',
        'chats',
        'command_events',
        'generation_finalization_retries',
        'hypa_v3_presets',
        'loadouts',
        'lore_books',
        'memory_chunks',
        'memory_embeddings',
        'memory_jobs',
        'memory_legacy_summary_tombstones',
        'memory_summaries',
        'messages',
        'model_presets',
        'modules',
        'personas',
        'plugin_custom_storage',
        'plugins',
        'prompt_presets',
        'prompt_templates',
        'push_subscriptions',
        'schema_version',
        'settings',
        'translator_presets',
      ])
    } finally {
      db.close()
    }
  })

  it('migrates finalization retries to retain multi-generation alternates', () => {
    const dataDir = makeDataDir()
    seedSchemaVersion(dataDir, 19, 4)
    const before = new DatabaseSync(path.join(dataDir, 'risu.db'))
    try {
      before.exec(`
        CREATE TABLE generation_finalization_retries (
          generation_id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          target_message_id TEXT,
          message_json TEXT NOT NULL,
          chat_var_mutations_json TEXT NOT NULL,
          target_snapshot_json TEXT,
          failure_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          terminal_error TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
    } finally {
      before.close()
    }

    const db = openDatabase(dataDir)
    try {
      expect(getSchemaState(db)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 4 })
      const columns = db.prepare('PRAGMA table_info(generation_finalization_retries)').all() as Array<{
        name: string
        dflt_value: string | null
      }>
      expect(columns.find((column) => column.name === 'alternate_messages_json')).toMatchObject({
        dflt_value: "'[]'",
      })
    } finally {
      db.close()
    }
  })

  it('migrates legacy-memory delete tombstones and records explicit row deletion', () => {
    const dataDir = makeDataDir()
    seedSchemaVersion(dataDir, 20, 5)

    const db = openDatabase(dataDir)
    try {
      expect(getSchemaState(db)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 5 })
      expect(listTables(db)).toContain('memory_legacy_summary_tombstones')

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
          ) VALUES ('legacy-summary', 'chat-1', 'chunk-1', 'legacy-hypav3', 'legacy text', 0)
        `,
      ).run()
      db.prepare("DELETE FROM memory_summaries WHERE id = 'legacy-summary'").run()

      expect(db.prepare('SELECT summary_id, chat_id FROM memory_legacy_summary_tombstones').all()).toEqual([
        { summary_id: 'legacy-summary', chat_id: 'chat-1' },
      ])
    } finally {
      db.close()
    }
  })

  it('drops retired projection body-cache tables without changing revision', () => {
    const dataDir = makeDataDir()
    seedSchemaVersion(dataDir, 21, 6)
    const before = new DatabaseSync(path.join(dataDir, 'risu.db'))
    try {
      before.exec(`
        CREATE TABLE projection_body_cache_state (
          id INTEGER PRIMARY KEY,
          epoch INTEGER NOT NULL
        );
        CREATE TABLE collection_body_revisions (
          collection_name TEXT NOT NULL,
          object_id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          PRIMARY KEY (collection_name, object_id)
        );
        INSERT INTO projection_body_cache_state (id, epoch) VALUES (1, 3);
        INSERT INTO collection_body_revisions (collection_name, object_id, revision)
          VALUES ('modules', 'module-a', 6);
      `)
    } finally {
      before.close()
    }

    const db = openDatabase(dataDir)
    try {
      expect(getSchemaState(db)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 6 })
      expect(listTables(db)).not.toContain('projection_body_cache_state')
      expect(listTables(db)).not.toContain('collection_body_revisions')
    } finally {
      db.close()
    }
  })

  it('L15: opens Fastify databases with WAL synchronous NORMAL', () => {
    const db = openDatabase(makeDataDir())
    try {
      const journalMode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
      const synchronous = db.prepare('PRAGMA synchronous').get() as { synchronous: number }

      expect(journalMode.journal_mode.toLowerCase()).toBe('wal')
      expect(synchronous.synchronous).toBe(1)
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
        'assets',
        'bot_presets',
        'characters',
        'chat_hypa_v3',
        'chats',
        'command_events',
        'generation_finalization_retries',
        'hypa_v3_presets',
        'loadouts',
        'lore_books',
        'memory_chunks',
        'memory_embeddings',
        'memory_jobs',
        'memory_legacy_summary_tombstones',
        'memory_summaries',
        'messages',
        'model_presets',
        'modules',
        'personas',
        'plugin_custom_storage',
        'plugins',
        'prompt_presets',
        'prompt_templates',
        'push_subscriptions',
        'schema_version',
        'settings',
        'translator_presets',
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
      const columns = (db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map(
        (row) => row.name,
      )
      expect(columns).toContain('alternate')
      // The pre-existing row defaults to an active (alternate = 0) row, intact.
      const row = db.prepare('SELECT data, alternate FROM messages WHERE chat_id = ? AND seq = 0').get('chat-1')
      expect(row).toEqual({ data: 'hi', alternate: 0 })
    } finally {
      db.close()
    }
  })

  it('adds the command event history table to a pre-v7 database', () => {
    const dataDir = makeDataDir()
    const seed = new DatabaseSync(path.join(dataDir, 'risu.db'))
    try {
      seed.exec(`
        CREATE TABLE schema_version (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL,
          revision INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO schema_version (id, version, revision) VALUES (1, 6, 11);
      `)
    } finally {
      seed.close()
    }

    const db = openDatabase(dataDir)
    try {
      expect(getSchemaState(db)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 11 })
      db.prepare(
        `
          INSERT INTO command_events (revision, type, resource)
          VALUES (11, 'settings.updated', 'settings')
        `,
      ).run()
      expect(db.prepare('SELECT revision, type, resource FROM command_events WHERE revision = 11').get()).toEqual({
        revision: 11,
        type: 'settings.updated',
        resource: 'settings',
      })
    } finally {
      db.close()
    }
  })

  it('rebuilds a command_events table that still carries the removed payload_json column (v9)', () => {
    const dataDir = makeDataDir()
    // Reconstruct a database whose `command_events` predates the table's final
    // shape: it still has a NOT NULL `payload_json` column (and a bare
    // `revision INTEGER PRIMARY KEY` without the `revision >= 0` check). The
    // canonical INSERT omits `payload_json`, so without the v9 rebuild every
    // command-event write fails with "NOT NULL constraint failed:
    // command_events.payload_json" — the failure seen on the first asset batch
    // of a device-backup import.
    const seed = new DatabaseSync(path.join(dataDir, 'risu.db'))
    try {
      seed.exec(`
        CREATE TABLE schema_version (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL,
          revision INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO schema_version (id, version, revision) VALUES (1, 8, 15);
        CREATE TABLE command_events (
          revision INTEGER PRIMARY KEY,
          type TEXT NOT NULL,
          resource TEXT NOT NULL,
          id TEXT,
          parent_id TEXT,
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        INSERT INTO command_events (revision, type, resource, payload_json)
          VALUES (15, 'settings.updated', 'settings', '{"legacy":true}');
      `)
    } finally {
      seed.close()
    }

    const db = openDatabase(dataDir)
    try {
      expect(getSchemaState(db)).toEqual({ version: CURRENT_SCHEMA_VERSION, revision: 15 })

      // The vestigial column is gone from the rebuilt table.
      const columns = (db.prepare('PRAGMA table_info(command_events)').all() as Array<{ name: string }>).map(
        (row) => row.name,
      )
      expect(columns).not.toContain('payload_json')

      // The durable replay row survived the rebuild (minus the dropped column).
      expect(db.prepare('SELECT revision, type, resource FROM command_events WHERE revision = 15').get()).toEqual({
        revision: 15,
        type: 'settings.updated',
        resource: 'settings',
      })

      // The canonical INSERT — the write that used to 500 on import — now works.
      expect(() =>
        db
          .prepare('INSERT INTO command_events (revision, type, resource) VALUES (16, ?, ?)')
          .run('asset.created', 'asset'),
      ).not.toThrow()
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
      const chunk = second.prepare('SELECT id, status FROM memory_chunks WHERE id = ?').get('chunk-1')
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
