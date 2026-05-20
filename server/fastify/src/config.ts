import path from 'node:path'
import process from 'node:process'

export interface AppConfig {
  host: string
  port: number
  dataDir: string
  bodyLimit: number
  trustProxy: boolean | number | string
  staticRoot?: string | null
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = env.RISU_API_DATA_DIR
    ? path.resolve(env.RISU_API_DATA_DIR)
    : path.join(repoRoot(), 'data')

  return {
    host: env.RISU_API_HOST ?? '0.0.0.0',
    port: parsePort(env.RISU_API_PORT, 6002),
    dataDir,
    bodyLimit: parseBodyLimit(env.RISU_API_BODY_LIMIT, 100 * 1024 * 1024),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    staticRoot: parseStaticRoot(env.RISU_API_STATIC_ROOT, path.join(repoRoot(), 'dist')),
  }
}
