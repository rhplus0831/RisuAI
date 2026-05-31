import type { FastifyBaseLogger } from 'fastify'
import { performance } from 'node:perf_hooks'

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on'])

export function protocolMetricsEnabled(): boolean {
  return ENABLED_VALUES.has((process.env.RISU_PROTOCOL_METRICS ?? '').toLowerCase())
}

export function protocolNowMs(): number {
  return performance.now()
}

export function protocolDurationMs(startMs: number): number {
  return Math.round((performance.now() - startMs) * 100) / 100
}

export function jsonPayloadBytes(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return null
  }
}

export function emitProtocolMetric(
  name: string,
  fields: Record<string, unknown>,
  logger?: FastifyBaseLogger,
): void {
  if (!protocolMetricsEnabled()) return
  const payload = { metric: name, ...fields }
  if (logger) {
    logger.info(payload, 'protocol metric')
    return
  }
  console.info(`[protocol-metric] ${JSON.stringify(payload)}`)
}
