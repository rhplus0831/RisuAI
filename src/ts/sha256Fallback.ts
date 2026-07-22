import { Sha256 } from '@aws-crypto/sha256-js'

export async function sha256Bytes(value: string | Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    return new Uint8Array(await subtle.digest('SHA-256', input))
  }

  const hash = new Sha256()
  hash.update(input)
  return new Uint8Array(await hash.digest())
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const digest = await sha256Bytes(value)
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
