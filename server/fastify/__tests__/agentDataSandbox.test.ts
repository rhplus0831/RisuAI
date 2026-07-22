import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseAgentDataSandboxMode, prepareAgentDataSandbox } from '../src/agentDataSandbox.js'

let root: string
let source: string
let sandbox: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'risu-agent-sandbox-'))
  source = path.join(root, 'data')
  sandbox = path.join(root, 'data-agent')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function populateSourceDataDir(): void {
  mkdirSync(path.join(source, 'assets', 'nested'), { recursive: true })
  mkdirSync(path.join(source, 'save'), { recursive: true })
  mkdirSync(path.join(source, 'backups'), { recursive: true })
  mkdirSync(path.join(source, 'trace'), { recursive: true })

  const db = new DatabaseSync(path.join(source, 'risu.db'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('CREATE TABLE greetings (value TEXT)')
  db.prepare('INSERT INTO greetings (value) VALUES (?)').run('hello')
  db.close()

  writeFileSync(path.join(source, 'assets', 'a.bin'), 'asset-a')
  writeFileSync(path.join(source, 'assets', 'nested', 'b.bin'), 'asset-b')
  writeFileSync(path.join(source, 'save', 'local.json'), '{}')
  writeFileSync(path.join(source, 'backups', 'old-backup.db'), 'backup payload')
  writeFileSync(path.join(source, 'trace', 'agent.jsonl'), '{"uid":"x"}\n')
  writeFileSync(path.join(source, '__password'), 'hunter2')
  writeFileSync(path.join(source, '__known_public_key_hashes.json'), '[]')
  writeFileSync(path.join(source, '__web_push_vapid_keys.json'), '{}')
  writeFileSync(path.join(source, 'stray-root-file.jpeg'), 'not part of the app data')
}

function readGreetings(databasePath: string): string[] {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const rows = db.prepare('SELECT value FROM greetings ORDER BY value').all() as Array<{ value: string }>
    return rows.map((row) => row.value)
  } finally {
    db.close()
  }
}

describe('prepareAgentDataSandbox', () => {
  it('clones risu.db, assets, and save while excluding auth files, backups, trace, and stray files', async () => {
    populateSourceDataDir()

    const summary = await prepareAgentDataSandbox({ sourceDataDir: source, sandboxDataDir: sandbox, mode: 'clone' })

    expect(summary).toContain('risu.db')
    expect(readGreetings(path.join(sandbox, 'risu.db'))).toEqual(['hello'])
    expect(existsSync(path.join(sandbox, 'assets', 'a.bin'))).toBe(true)
    expect(existsSync(path.join(sandbox, 'assets', 'nested', 'b.bin'))).toBe(true)
    expect(existsSync(path.join(sandbox, 'save', 'local.json'))).toBe(true)

    expect(existsSync(path.join(sandbox, 'backups'))).toBe(false)
    expect(existsSync(path.join(sandbox, 'trace'))).toBe(false)
    expect(existsSync(path.join(sandbox, '__password'))).toBe(false)
    expect(existsSync(path.join(sandbox, '__known_public_key_hashes.json'))).toBe(false)
    expect(existsSync(path.join(sandbox, '__web_push_vapid_keys.json'))).toBe(false)
    expect(existsSync(path.join(sandbox, 'stray-root-file.jpeg'))).toBe(false)
  })

  it('hardlinks asset payloads instead of copying them', async () => {
    populateSourceDataDir()

    await prepareAgentDataSandbox({ sourceDataDir: source, sandboxDataDir: sandbox, mode: 'clone' })

    const original = statSync(path.join(source, 'assets', 'a.bin'))
    const cloned = statSync(path.join(sandbox, 'assets', 'a.bin'))
    expect(cloned.ino).toBe(original.ino)
  })

  it('captures rows committed to the WAL of a still-open source connection', async () => {
    populateSourceDataDir()
    const liveWriter = new DatabaseSync(path.join(source, 'risu.db'))
    try {
      liveWriter.prepare('INSERT INTO greetings (value) VALUES (?)').run('while-open')

      await prepareAgentDataSandbox({ sourceDataDir: source, sandboxDataDir: sandbox, mode: 'clone' })

      expect(readGreetings(path.join(sandbox, 'risu.db'))).toEqual(['hello', 'while-open'])
    } finally {
      liveWriter.close()
    }
  })

  it('replaces prior sandbox contents on clone', async () => {
    populateSourceDataDir()
    mkdirSync(sandbox, { recursive: true })
    writeFileSync(path.join(sandbox, 'leftover-from-last-session.txt'), 'stale')

    await prepareAgentDataSandbox({ sourceDataDir: source, sandboxDataDir: sandbox, mode: 'clone' })

    expect(existsSync(path.join(sandbox, 'leftover-from-last-session.txt'))).toBe(false)
    expect(readGreetings(path.join(sandbox, 'risu.db'))).toEqual(['hello'])
  })

  it('keep leaves an existing sandbox untouched', async () => {
    populateSourceDataDir()
    mkdirSync(sandbox, { recursive: true })
    writeFileSync(path.join(sandbox, 'agent-state.txt'), 'precious')

    const summary = await prepareAgentDataSandbox({ sourceDataDir: source, sandboxDataDir: sandbox, mode: 'keep' })

    expect(summary).toContain('kept existing sandbox')
    expect(existsSync(path.join(sandbox, 'agent-state.txt'))).toBe(true)
    expect(existsSync(path.join(sandbox, 'risu.db'))).toBe(false)
  })

  it('keep clones when the sandbox does not exist yet', async () => {
    populateSourceDataDir()

    await prepareAgentDataSandbox({ sourceDataDir: source, sandboxDataDir: sandbox, mode: 'keep' })

    expect(readGreetings(path.join(sandbox, 'risu.db'))).toEqual(['hello'])
  })

  it('fresh produces an empty sandbox even when the source has data', async () => {
    populateSourceDataDir()
    mkdirSync(sandbox, { recursive: true })
    writeFileSync(path.join(sandbox, 'leftover.txt'), 'stale')

    await prepareAgentDataSandbox({ sourceDataDir: source, sandboxDataDir: sandbox, mode: 'fresh' })

    expect(readdirSync(sandbox)).toEqual([])
  })

  it('clones assets even when the source has no risu.db yet', async () => {
    mkdirSync(path.join(source, 'assets'), { recursive: true })
    writeFileSync(path.join(source, 'assets', 'a.bin'), 'asset-a')

    await prepareAgentDataSandbox({ sourceDataDir: source, sandboxDataDir: sandbox, mode: 'clone' })

    expect(existsSync(path.join(sandbox, 'risu.db'))).toBe(false)
    expect(existsSync(path.join(sandbox, 'assets', 'a.bin'))).toBe(true)
  })

  it('creates an empty sandbox when the source data dir is missing', async () => {
    await prepareAgentDataSandbox({ sourceDataDir: source, sandboxDataDir: sandbox, mode: 'clone' })

    expect(readdirSync(sandbox)).toEqual([])
  })

  it('refuses identical or nested source/sandbox paths', async () => {
    await expect(
      prepareAgentDataSandbox({ sourceDataDir: source, sandboxDataDir: source, mode: 'clone' }),
    ).rejects.toThrow(/disjoint/)
    await expect(
      prepareAgentDataSandbox({ sourceDataDir: source, sandboxDataDir: path.join(source, 'agent'), mode: 'clone' }),
    ).rejects.toThrow(/disjoint/)
    await expect(
      prepareAgentDataSandbox({ sourceDataDir: path.join(sandbox, 'data'), sandboxDataDir: sandbox, mode: 'clone' }),
    ).rejects.toThrow(/disjoint/)
  })
})

describe('parseAgentDataSandboxMode', () => {
  it('defaults to clone and normalizes casing/whitespace', () => {
    expect(parseAgentDataSandboxMode(undefined)).toBe('clone')
    expect(parseAgentDataSandboxMode(' KEEP ')).toBe('keep')
    expect(parseAgentDataSandboxMode('fresh')).toBe('fresh')
  })

  it('rejects unknown modes', () => {
    expect(() => parseAgentDataSandboxMode('bogus')).toThrow(/RISU_AGENT_DATA_MODE/)
  })
})
