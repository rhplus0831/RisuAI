import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Deterministic work counters only: stack capture makes these unsuitable for timing. */
export interface JsonWorkCounter {
  count: number
  bytes: number
}

export async function measureJsonWork<T>(
  operation: () => Promise<T>,
  classify: (stack: string) => string | undefined,
): Promise<{ result: T; counters: Record<string, JsonWorkCounter> }> {
  const stringify = JSON.stringify
  const counters: Record<string, JsonWorkCounter> = {}
  JSON.stringify = function (value: unknown, replacer?: unknown, space?: unknown) {
    const output = (stringify as (...args: unknown[]) => string | undefined)(value, replacer, space)
    const category = classify(new Error().stack ?? '')
    if (category && output !== undefined) {
      const counter = (counters[category] ??= { count: 0, bytes: 0 })
      counter.count += 1
      counter.bytes += new TextEncoder().encode(output).byteLength
    }
    return output
  } as typeof JSON.stringify
  try {
    return { result: await operation(), counters }
  } finally {
    JSON.stringify = stringify
  }
}

const recordedEvidence = new Map<string, unknown[]>()

export function reportBrowserWork(finding: string, evidence: unknown): void {
  const samples = recordedEvidence.get(finding) ?? []
  samples.push(evidence)
  recordedEvidence.set(finding, samples)
  const directory = resolve('fast-bootstrap-results/maintainability')
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    resolve(directory, `${finding}-browser-work.json`),
    `${JSON.stringify({ finding, evidenceKind: 'structural-work-counters', node: process.version, samples }, null, 2)}\n`,
  )
  console.info(`[browser-work:${finding}] ${JSON.stringify(evidence)}`)
}
