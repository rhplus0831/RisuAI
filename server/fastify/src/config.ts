import path from 'node:path'
import process from 'node:process'

export interface AppConfig {
  host: string
  port: number
  dataDir: string
  bodyLimit: number
  /**
   * Max upload size for device backup imports (`.risu.zip` / legacy `.bin`).
   * Decoupled from `bodyLimit` because full backups (database + all assets) are
   * routinely far larger than ordinary request bodies; the import streams the
   * upload to disk and decodes it in bounded batches rather than buffering it.
   *
   * Defaults to unlimited (`Number.POSITIVE_INFINITY`) so multi-GB backups (large
   * assets push real backups well past 4 GiB) import without per-deployment
   * tuning — peak memory stays bounded regardless of file size. Set
   * `RISU_API_IMPORT_MAX_BYTES` to a positive byte count to impose a ceiling.
   */
  importMaxBytes: number
  trustProxy: boolean | number | string
  staticRoot?: string | null
  hubUrl: string
  realmUrl?: string
}

function repoRoot(): string {
  return process.cwd()
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid RISU_API_PORT: ${raw}`)
  }
  return n
}

function parseBodyLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid RISU_API_BODY_LIMIT: ${raw}`)
  }
  return Math.floor(n)
}

function parseImportMaxBytes(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  // Explicit opt-out: the import streams to disk with bounded memory, so a
  // self-host owner can lift the ceiling entirely for very large backups.
  const normalized = raw.trim().toLowerCase()
  if (
    normalized === '0' ||
    normalized === 'unlimited' ||
    normalized === 'none' ||
    normalized === 'infinity'
  ) {
    return Number.POSITIVE_INFINITY
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid RISU_API_IMPORT_MAX_BYTES: ${raw}`)
  }
  return Math.floor(n)
}

function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (!raw) return false
  const n = Number(raw)
  if (Number.isInteger(n)) return n
  if (raw === 'true') return true
  if (raw === 'false') return false
  return raw
}

function parseStaticRoot(raw: string | undefined, fallback: string): string | null {
  if (raw === undefined) return fallback
  if (raw === '' || raw.toLowerCase() === 'none' || raw.toLowerCase() === 'off') {
    return null
  }
  return path.resolve(raw)
}

function parseHubUrl(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('protocol must be http or https')
    }
    return raw.replace(/\/+$/, '')
  } catch (err) {
    throw new Error(`Invalid RISU_HUB_URL: ${raw} (${(err as Error).message})`)
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = env.RISU_API_DATA_DIR
    ? path.resolve(env.RISU_API_DATA_DIR)
    : path.join(repoRoot(), 'data')

  return {
    host: env.RISU_API_HOST ?? '0.0.0.0',
    port: parsePort(env.RISU_API_PORT, 6002),
    dataDir,
    bodyLimit: parseBodyLimit(env.RISU_API_BODY_LIMIT, 100 * 1024 * 1024),
    importMaxBytes: parseImportMaxBytes(env.RISU_API_IMPORT_MAX_BYTES, Number.POSITIVE_INFINITY),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    staticRoot: parseStaticRoot(env.RISU_API_STATIC_ROOT, path.join(repoRoot(), 'dist')),
    hubUrl: parseHubUrl(env.RISU_HUB_URL, 'https://sv.risuai.xyz'),
    realmUrl: parseHubUrl(env.RISU_REALM_URL, 'https://realm.risuai.net'),
  }
}
