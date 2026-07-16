const TRUSTED_REMOTE_LOGIN_ORIGINS = new Set(['https://sv.risuai.xyz', 'https://nightly.sv.risuai.xyz'])

export function isTrustedLoginMessageOrigin(origin: string, currentOrigin: string): boolean {
  if ((origin !== 'null' && origin === currentOrigin) || TRUSTED_REMOTE_LOGIN_ORIGINS.has(origin)) return true

  try {
    const parsed = new URL(origin)
    return parsed.origin === origin && parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1'
  } catch {
    return false
  }
}
