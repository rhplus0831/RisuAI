import { execFileSync } from 'node:child_process'
import net from 'node:net'

export type AgentDevHostSource = 'configured' | 'tailscale' | 'loopback'

export interface AgentDevHostResolution {
  host: string
  source: AgentDevHostSource
}

type TailscaleIpv4Lookup = () => string | undefined

export function isTailscaleIpv4(host: string): boolean {
  if (!net.isIPv4(host)) return false
  const [first, second] = host.split('.').map(Number)
  return first === 100 && second >= 64 && second <= 127
}

export function detectTailscaleIpv4(): string | undefined {
  try {
    const output = execFileSync('tailscale', ['ip', '-4'], {
      encoding: 'utf8',
      maxBuffer: 4_096,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    })
    return output.split(/\s+/).find(isTailscaleIpv4)
  } catch {
    return undefined
  }
}

export function resolveAgentDevHost(
  configuredHost: string | undefined,
  traceMode: string | undefined,
  lookupTailscaleIpv4: TailscaleIpv4Lookup = detectTailscaleIpv4,
): AgentDevHostResolution {
  if (configuredHost?.trim()) {
    return { host: configuredHost.trim(), source: 'configured' }
  }
  if (traceMode !== 'human') {
    return { host: '127.0.0.1', source: 'loopback' }
  }

  const tailscaleIpv4 = lookupTailscaleIpv4()
  if (tailscaleIpv4 && isTailscaleIpv4(tailscaleIpv4)) {
    return { host: tailscaleIpv4, source: 'tailscale' }
  }
  return { host: '127.0.0.1', source: 'loopback' }
}
