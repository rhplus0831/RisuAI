function normalizeHost(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .split('%')[0]
}

function isIPv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) {
    return false
  }
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return false
    }
    const value = Number(part)
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return false
    }
  }
  return true
}

function isLocalIPv4(host: string): boolean {
  if (!isIPv4(host)) {
    return false
  }
  const [a, b] = host.split('.').map((v) => Number(v))
  if (a === 0 || a === 10 || a === 127) {
    return true
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true
  }
  if (a === 192 && b === 168) {
    return true
  }
  if (a === 169 && b === 254) {
    return true
  }
  return false
}

function mappedIPv4FromIPv6(host: string): string | null {
  const dottedTail = host.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (dottedTail && isIPv4(dottedTail)) return dottedTail

  const mapped = /^(?:::ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host)
  if (!mapped) return null
  const high = Number.parseInt(mapped[1], 16)
  const low = Number.parseInt(mapped[2], 16)
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

function isLocalIPv6(host: string): boolean {
  if (!host.includes(':')) {
    return false
  }

  if (host === '::1') {
    return true
  }

  const mappedIPv4 = mappedIPv4FromIPv6(host)
  if (mappedIPv4) return isLocalIPv4(mappedIPv4)

  const first = host.split(':')[0]
  if (!first) {
    return false
  }

  const firstHextet = Number.parseInt(first, 16)
  if (!Number.isFinite(firstHextet)) {
    return false
  }

  // fc00::/7
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) {
    return true
  }

  // fe80::/10
  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) {
    return true
  }

  return false
}

export function isLocalNetworkHost(hostname: string): boolean {
  const host = normalizeHost(hostname)
  if (!host) {
    return false
  }

  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') {
    return true
  }

  if (host.endsWith('.local')) {
    return true
  }

  if (isLocalIPv4(host)) {
    return true
  }

  if (isLocalIPv6(host)) {
    return true
  }

  return false
}

export function isLocalNetworkUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return isLocalNetworkHost(parsed.hostname)
  } catch {
    return false
  }
}
