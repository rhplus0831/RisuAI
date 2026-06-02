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

// --- mutation-range write capture -------------------------------------------
// A command mutation runs entirely synchronously inside one `BEGIN IMMEDIATE`
// transaction, so a single module-level recorder safely captures which physical
// SQLite tables that mutation wrote. The mutation helper opens a capture; the
// repository and message-store writers report each table they touch; the helper
// reads the set back for the `command_mutation` metric's `writtenTables`
// dimension. This turns "the write narrowed" into a checkable before/after
// table-set diff rather than a timing inference.
//
// Capture is armed only when metrics are enabled, so the hot path pays at most a
// single null check per write when metrics are off, and never allocates.

let activeTableWrites: Set<string> | null = null

/** Arm a fresh table-write capture for the current synchronous mutation region.
 *  A no-op (capture stays disarmed) when protocol metrics are off. */
export function beginTableWriteCapture(): void {
  activeTableWrites = protocolMetricsEnabled() ? new Set<string>() : null
}

/** Report that `table` was physically written. Cheap no-op when no capture is
 *  armed. Called from the SQLite write boundary (repository + message store). */
export function recordTableWrite(table: string): void {
  activeTableWrites?.add(table)
}

/** Close the current capture and return the sorted set of tables written, or
 *  null when capture was disarmed (metrics off). Idempotent — a second call
 *  returns null. Always call this to release the recorder, including on the
 *  error path, so a partial set never leaks into the next mutation. */
export function takeTableWrites(): string[] | null {
  const captured = activeTableWrites
  activeTableWrites = null
  return captured ? [...captured].sort() : null
}
