import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
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
  assertDisjointDirs(canonicalPath(source), canonicalPath(sandbox), source, sandbox)
  const sandboxExists = validateSandboxDestination(sandbox)

  if (opts.mode === 'keep' && sandboxExists) {
    return `kept existing sandbox at ${sandbox}`
  }

  const parent = path.dirname(sandbox)
  fs.mkdirSync(parent, { recursive: true })
  const staging = fs.mkdtempSync(path.join(parent, `.${path.basename(sandbox)}.staging-`))

  try {
    const summary = await populateSandbox(source, staging, sandbox, opts.mode)
    replaceSandbox(staging, sandbox, sandboxExists)
    return summary
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw err
  }
}

async function populateSandbox(
  source: string,
  staging: string,
  sandbox: string,
  mode: AgentDataSandboxMode,
): Promise<string> {
  if (mode === 'fresh' || !fs.existsSync(source)) {
    return `created empty sandbox at ${sandbox}`
  }

  const cloned: string[] = []

  const sourceDb = path.join(source, 'risu.db')
  if (fs.existsSync(sourceDb)) {
    await snapshotSqliteDatabase(sourceDb, path.join(staging, 'risu.db'))
    cloned.push('risu.db')
  }

  for (const dir of HARDLINKED_DIRS) {
    const from = path.join(source, dir)
    if (fs.existsSync(from) && fs.statSync(from).isDirectory()) {
      const files = linkTree(from, path.join(staging, dir))
      cloned.push(`${dir}/ (${files} file${files === 1 ? '' : 's'})`)
    }
  }

  if (cloned.length === 0) {
    return `created empty sandbox at ${sandbox} (nothing to clone from ${source})`
  }
  return `cloned ${cloned.join(', ')} from ${source}`
}

function pathExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

function canonicalPath(filePath: string): string {
  const suffix: string[] = []
  let existing = filePath
  while (!pathExists(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    suffix.unshift(path.basename(existing))
    existing = parent
  }
  return path.resolve(fs.realpathSync(existing), ...suffix)
}

function validateSandboxDestination(sandbox: string): boolean {
  if (!pathExists(sandbox)) return false
  const stat = fs.lstatSync(sandbox)
  if (stat.isSymbolicLink()) {
    throw new Error(`Agent data sandbox (${sandbox}) must not be a symbolic link`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`Agent data sandbox (${sandbox}) must be a directory`)
  }
  return true
}

// The sandbox is replaced recursively; refuse canonical nesting between the two
// dirs so aliases through symlinked parents cannot target the human data dir.
function assertDisjointDirs(canonicalSource: string, canonicalSandbox: string, source: string, sandbox: string): void {
  const contains = (parent: string, child: string): boolean => {
    const rel = path.relative(parent, child)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  }
  if (contains(canonicalSource, canonicalSandbox) || contains(canonicalSandbox, canonicalSource)) {
    throw new Error(`Agent data sandbox (${sandbox}) must be disjoint from the source data dir (${source})`)
  }
}

function replaceSandbox(staging: string, sandbox: string, sandboxExisted: boolean): void {
  const stillExists = validateSandboxDestination(sandbox)
  if (stillExists !== sandboxExisted) {
    throw new Error(`Agent data sandbox (${sandbox}) changed while it was being prepared`)
  }

  if (!sandboxExisted) {
    fs.renameSync(staging, sandbox)
    return
  }

  const previous = `${sandbox}.previous-${randomUUID()}`
  fs.renameSync(sandbox, previous)
  try {
    fs.renameSync(staging, sandbox)
  } catch (err) {
    fs.renameSync(previous, sandbox)
    throw err
  }
  fs.rmSync(previous, { recursive: true })
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
