let fallbackCounter: number | undefined

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function markAsUuidV4(bytes: Uint8Array): Uint8Array {
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return bytes
}

function createFallbackUuid(): string {
  const bytes = new Uint8Array(16)
  let timestamp = Math.max(0, Math.floor(Date.now()))
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256
    timestamp = Math.floor(timestamp / 256)
  }

  fallbackCounter = ((fallbackCounter ?? Math.floor(Math.random() * 0x1_0000_0000)) + 1) >>> 0
  bytes[9] = fallbackCounter >>> 24
  bytes[10] = fallbackCounter >>> 16
  bytes[11] = fallbackCounter >>> 8
  bytes[12] = fallbackCounter

  for (const index of [6, 7, 8, 13, 14, 15]) {
    bytes[index] = Math.floor(Math.random() * 256)
  }

  return formatUuid(markAsUuidV4(bytes))
}

/**
 * Creates an RFC4122-shaped ID for non-security-sensitive entities and request correlation only.
 * Do not use this helper for secrets, authentication/session identifiers, encryption material, or IVs.
 */
export function createNonSecurityUuid(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID()
    } catch {
      // Some supported LAN WebViews expose incomplete WebCrypto methods.
    }
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    try {
      const bytes = new Uint8Array(16)
      cryptoApi.getRandomValues(bytes)
      return formatUuid(markAsUuidV4(bytes))
    } catch {
      // Fall through to a non-cryptographic entity ID.
    }
  }

  return createFallbackUuid()
}
