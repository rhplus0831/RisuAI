import fs from 'node:fs'
import path from 'node:path'
import { createHash, webcrypto } from 'node:crypto'

const subtle = webcrypto.subtle

export interface AuthState {
  passwordPath: string
  knownKeysPath: string
  password: string
  knownKeyHashes: Set<string>
}

export function createAuthState(dataDir: string): AuthState {
  fs.mkdirSync(dataDir, { recursive: true })
  const passwordPath = path.join(dataDir, '__password')
  const knownKeysPath = path.join(dataDir, '__known_public_key_hashes.json')

  const password = fs.existsSync(passwordPath) ? fs.readFileSync(passwordPath, 'utf-8') : ''
  const knownKeyHashes = new Set<string>()
  if (fs.existsSync(knownKeysPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(knownKeysPath, 'utf-8'))
      if (Array.isArray(raw)) {
        for (const h of raw) {
          if (typeof h === 'string') knownKeyHashes.add(h)
        }
      }
    } catch {
      // ignore malformed cache; will be rewritten on next login
    }
  }

  return { passwordPath, knownKeysPath, password, knownKeyHashes }
}

export function hasPassword(state: AuthState): boolean {
  return state.password.trim().length > 0
}

export function setPassword(state: AuthState, password: string): void {
  state.password = password
  fs.writeFileSync(state.passwordPath, password, 'utf-8')
}

export function registerPublicKey(state: AuthState, publicKey: unknown): void {
  const hash = hashJSON(publicKey)
  if (state.knownKeyHashes.has(hash)) return
  state.knownKeyHashes.add(hash)
  fs.writeFileSync(state.knownKeysPath, JSON.stringify(Array.from(state.knownKeyHashes)), 'utf-8')
}

export function passwordMatches(state: AuthState, candidate: string | undefined): boolean {
  if (typeof candidate !== 'string') return false
  if (!hasPassword(state)) return false
  return candidate.trim() === state.password.trim()
}

function hashJSON(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
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
      reason:
        | 'missing'
        | 'malformed'
        | 'expired'
        | 'unknown-key'
        | 'bad-alg'
        | 'bad-signature'
        | 'error'
    }

export async function verifyAssertion(state: AuthState, token: string): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: 'missing' }
  const decoded = decodeAssertion(token)
  if (!decoded) return { ok: false, reason: 'malformed' }

  const now = Math.floor(Date.now() / 1000)
  if (decoded.payload.exp < now) return { ok: false, reason: 'expired' }

  if (decoded.header.alg !== 'ES256') return { ok: false, reason: 'bad-alg' }

  const pubHash = hashJSON(decoded.payload.pub)
  if (!state.knownKeyHashes.has(pubHash)) return { ok: false, reason: 'unknown-key' }

  try {
    const key = await subtle.importKey(
      'jwk',
      decoded.payload.pub,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
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
