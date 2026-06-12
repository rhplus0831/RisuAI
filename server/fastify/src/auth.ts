import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, webcrypto } from 'node:crypto'
import { Buffer } from 'node:buffer'

const subtle = webcrypto.subtle

// Soft cap on the in-memory and on-disk known-key set. Evicts the
// least-recently-seen hash when the set would otherwise exceed the cap. The
// cap is deliberately conservative; the only operational cost of eviction is
// that an evicted client must log in again.
const KNOWN_KEY_HASH_CAP = 4096

export interface AuthState {
  passwordPath: string
  knownKeysPath: string
  sessionTokensPath: string
  agentDevAuthBypass: boolean
  password: string
  // The Set preserves insertion order; we treat `delete` + `add` as
  // "touch" to maintain an LRU on `verifyAssertion` / `registerPublicKey`.
  knownKeyHashes: Set<string>
  knownSessionTokenHashes: Set<string>
}

interface AuthStateOptions {
  agentDevAuthBypass?: boolean
}

export function createAuthState(dataDir: string, opts: AuthStateOptions = {}): AuthState {
  fs.mkdirSync(dataDir, { recursive: true })
  const passwordPath = path.join(dataDir, '__password')
  const knownKeysPath = path.join(dataDir, '__known_public_key_hashes.json')
  const sessionTokensPath = path.join(dataDir, '__known_session_token_hashes.json')

  const password = fs.existsSync(passwordPath) ? fs.readFileSync(passwordPath, 'utf-8') : ''
  const knownKeyHashes = loadHashSet(knownKeysPath)
  const knownSessionTokenHashes = loadHashSet(sessionTokensPath)

  return {
    passwordPath,
    knownKeysPath,
    sessionTokensPath,
    agentDevAuthBypass: opts.agentDevAuthBypass === true,
    password,
    knownKeyHashes,
    knownSessionTokenHashes,
  }
}

function loadHashSet(filePath: string): Set<string> {
  const hashes = new Set<string>()
  if (fs.existsSync(filePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (Array.isArray(raw)) {
        for (const h of raw) {
          if (typeof h === 'string') hashes.add(h)
        }
      }
    } catch {
      // ignore malformed cache; will be rewritten on next login
    }
  }
  trimToCap(hashes)
  return hashes
}

function trimToCap(set: Set<string>): void {
  while (set.size > KNOWN_KEY_HASH_CAP) {
    const oldest = set.values().next().value
    if (oldest === undefined) break
    set.delete(oldest)
  }
}

function touch(set: Set<string>, hash: string): void {
  // Move-to-end LRU: delete and re-add to make this hash the most recent.
  set.delete(hash)
  set.add(hash)
}

export function hasPassword(state: AuthState): boolean {
  return state.password.trim().length > 0
}

export function isAgentDevAuthBypassed(state: AuthState): boolean {
  return state.agentDevAuthBypass
}

export function setPassword(state: AuthState, password: string): void {
  state.password = password
  fs.writeFileSync(state.passwordPath, password, 'utf-8')
}

function persistKnownKeys(state: AuthState): void {
  fs.writeFileSync(state.knownKeysPath, JSON.stringify(Array.from(state.knownKeyHashes)), 'utf-8')
}

export function registerPublicKey(state: AuthState, publicKey: unknown): void {
  const hash = hashJSON(publicKey)
  if (state.knownKeyHashes.has(hash)) {
    touch(state.knownKeyHashes, hash)
    persistKnownKeys(state)
    return
  }
  state.knownKeyHashes.add(hash)
  trimToCap(state.knownKeyHashes)
  persistKnownKeys(state)
}

export function registerSessionToken(state: AuthState): string {
  const token = `session.${randomBytes(32).toString('base64url')}`
  state.knownSessionTokenHashes.add(hashToken(token))
  trimToCap(state.knownSessionTokenHashes)
  persistKnownSessionTokens(state)
  return token
}

function persistKnownSessionTokens(state: AuthState): void {
  fs.writeFileSync(state.sessionTokensPath, JSON.stringify(Array.from(state.knownSessionTokenHashes)), 'utf-8')
}

export function passwordMatches(state: AuthState, candidate: string | undefined): boolean {
  if (typeof candidate !== 'string') return false
  if (!hasPassword(state)) return false
  return candidate.trim() === state.password.trim()
}

function hashJSON(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

interface AssertionShape {
  header: { alg: string; typ?: string }
  payload: { iat?: number; exp: number; pub: JsonWebKey }
  signingInput: string
  signature: Buffer
}

function decodeAssertion(token: string): AssertionShape | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, s] = parts
  if (!h || !p || !s) return null
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf-8'))
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf-8'))
    const signature = Buffer.from(s, 'base64url')
    if (
      typeof header?.alg !== 'string' ||
      typeof payload?.exp !== 'number' ||
      typeof payload?.pub !== 'object' ||
      payload?.pub === null
    ) {
      return null
    }
    return { header, payload, signature, signingInput: `${h}.${p}` }
  } catch {
    return null
  }
}

export type VerifyResult =
  | { ok: true }
  | {
      ok: false
      reason: 'missing' | 'malformed' | 'expired' | 'unknown-key' | 'bad-alg' | 'bad-signature' | 'error'
    }

export async function verifyAssertion(state: AuthState, token: string): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: 'missing' }
  if (token.startsWith('session.')) {
    const hash = hashToken(token)
    if (!state.knownSessionTokenHashes.has(hash)) return { ok: false, reason: 'unknown-key' }
    touch(state.knownSessionTokenHashes, hash)
    return { ok: true }
  }
  const decoded = decodeAssertion(token)
  if (!decoded) return { ok: false, reason: 'malformed' }

  const now = Math.floor(Date.now() / 1000)
  if (decoded.payload.exp < now) return { ok: false, reason: 'expired' }

  if (decoded.header.alg !== 'ES256') return { ok: false, reason: 'bad-alg' }

  const pubHash = hashJSON(decoded.payload.pub)
  if (!state.knownKeyHashes.has(pubHash)) return { ok: false, reason: 'unknown-key' }

  // Touch on successful verification so the LRU keeps recently-active keys.
  // Persistence happens lazily on register; the in-memory LRU is the gate.
  touch(state.knownKeyHashes, pubHash)

  try {
    const key = await subtle.importKey('jwk', decoded.payload.pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'verify',
    ])
    const valid = await subtle.verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      key,
      decoded.signature,
      Buffer.from(decoded.signingInput),
    )
    return valid ? { ok: true } : { ok: false, reason: 'bad-signature' }
  } catch {
    return { ok: false, reason: 'error' }
  }
}
