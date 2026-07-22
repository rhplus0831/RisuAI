import fs from 'node:fs'
import path from 'node:path'
import { backup as backupSqliteDatabase, DatabaseSync } from 'node:sqlite'

export type AgentDataSandboxMode = 'clone' | 'keep' | 'fresh'

export function parseAgentDataSandboxMode(raw: string | undefined): AgentDataSandboxMode {
  if (!raw) return 'clone'
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'clone' || normalized === 'keep' || normalized === 'fresh') {
    return normalized
  }
  throw new Error(`Invalid RISU_AGENT_DATA_MODE: ${raw} (expected clone, keep, or fresh)`)
}

// What a clone carries over from the source data dir. Auth state (__password,
// __known_*.json) and web-push VAPID keys are intentionally left behind: agent
// mode bypasses auth and the server regenerates push keys on demand. backups/
// and trace/ are excluded for size; the sandbox accumulates its own.
const HARDLINKED_DIRS = ['assets', 'save'] as const

export interface PrepareAgentDataSandboxOptions {
  sourceDataDir: string
  sandboxDataDir: string
  mode: AgentDataSandboxMode
}

/**
 * Prepare a disposable data directory for `dev:agent` so agent-driven sessions
 * never mutate the human database. Returns a human-readable summary of what
 * happened for the dev-server log.
 */
export async function prepareAgentDataSandbox(opts: PrepareAgentDataSandboxOptions): Promise<string> {
  const source = path.resolve(opts.sourceDataDir)
  const sandbox = path.resolve(opts.sandboxDataDir)
  assertDisjointDirs(source, sandbox)

  if (opts.mode === 'keep' && fs.existsSync(sandbox)) {
    return `kept existing sandbox at ${sandbox}`
  }

  fs.rmSync(sandbox, { recursive: true, force: true })
  fs.mkdirSync(sandbox, { recursive: true })

  if (opts.mode === 'fresh' || !fs.existsSync(source)) {
    return `created empty sandbox at ${sandbox}`
  }

  const cloned: string[] = []

  const sourceDb = path.join(source, 'risu.db')
  if (fs.existsSync(sourceDb)) {
    await snapshotSqliteDatabase(sourceDb, path.join(sandbox, 'risu.db'))
    cloned.push('risu.db')
  }

  for (const dir of HARDLINKED_DIRS) {
    const from = path.join(source, dir)
    if (fs.existsSync(from) && fs.statSync(from).isDirectory()) {
      const files = linkTree(from, path.join(sandbox, dir))
      cloned.push(`${dir}/ (${files} file${files === 1 ? '' : 's'})`)
    }
  }

  if (cloned.length === 0) {
    return `created empty sandbox at ${sandbox} (nothing to clone from ${source})`
  }
  return `cloned ${cloned.join(', ')} from ${source}`
}

// The sandbox gets wiped with rm -rf; refuse any nesting between the two dirs
// so a misconfigured path can never destroy the human data directory.
function assertDisjointDirs(source: string, sandbox: string): void {
  const contains = (parent: string, child: string): boolean => {
    const rel = path.relative(parent, child)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  }
  if (contains(source, sandbox) || contains(sandbox, source)) {
    throw new Error(`Agent data sandbox (${sandbox}) must be disjoint from the source data dir (${source})`)
  }
}

// The online backup API yields a transactionally consistent, fully
// checkpointed destination even while another process (dev:human) holds the
// source open and keeps writing to its WAL.
async function snapshotSqliteDatabase(from: string, to: string): Promise<void> {
  const db = new DatabaseSync(from)
  try {
    await backupSqliteDatabase(db, to)
  } finally {
    db.close()
  }
}

// Asset/save payloads are written once and never modified in place, so
// hardlinks are safe: deleting a file in either tree only unlinks that tree's
// entry. Falls back to a byte copy when linking fails (e.g. the sandbox lives
// on a different filesystem).
function linkTree(sourceDir: string, targetDir: string): number {
  fs.mkdirSync(targetDir, { recursive: true })
  let files = 0
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const from = path.join(sourceDir, entry.name)
    const to = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      files += linkTree(from, to)
    } else if (entry.isFile()) {
      try {
        fs.linkSync(from, to)
      } catch {
        fs.copyFileSync(from, to)
      }
      files += 1
    }
  }
  return files
}
