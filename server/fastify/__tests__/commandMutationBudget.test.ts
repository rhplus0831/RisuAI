import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TARGETED_MUTATION_PATHS } from '../src/commands/mutations.js'
import {
  BROAD_WRITE_TABLES,
  COMMAND_METRIC_REVIEW_GATES,
  type CommandMetricGate,
} from './helpers/commandMetricGates.js'

// Phase 7 verification budget: the gate map is the single budget surface for
// every command write path, so it must stay in lock-step with the runtime and
// no narrow path may quietly lose its `dbJsonWriteMs: 0` floor or its
// written-table budget. These are pure static invariants (no app harness): they
// scan the server source for the `mutationPath` labels the runtime can emit and
// cross-check them against `COMMAND_METRIC_REVIEW_GATES`. A new route, a renamed
// label, or a loosened gate fails here before it can silently widen a write.

const SRC_DIR = path.resolve(fileURLToPath(new URL('../src', import.meta.url)))

/** Every `.ts` file under `server/fastify/src`, recursively. */
function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSourceFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

/**
 * The set of `mutationPath` labels the runtime can actually emit, gathered from
 * the two emission shapes: a string literal (`mutationPath: 'targeted-message'`)
 * and a reference to the shared vehicle table
 * (`mutationPath: TARGETED_MUTATION_PATHS.collection`), resolved through the
 * imported object. The `mutationPath: args.mutationPath` pass-through and the
 * `mutationPath: string` type field are intentionally not matched.
 */
function collectEmittedMutationPaths(): Set<string> {
  const literalRe = /mutationPath:\s*'([a-z-]+)'/g
  const refRe = /mutationPath:\s*TARGETED_MUTATION_PATHS\.([A-Za-z]+)/g
  const labels = new Set<string>()
  for (const file of listSourceFiles(SRC_DIR)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(literalRe)) labels.add(match[1])
    for (const match of text.matchAll(refRe)) {
      const key = match[1] as keyof typeof TARGETED_MUTATION_PATHS
      const value = TARGETED_MUTATION_PATHS[key]
      expect(value, `TARGETED_MUTATION_PATHS.${key} referenced by a route is not defined`).toBeTruthy()
      labels.add(value)
    }
  }
  return labels
}

const GATE_KEYS = Object.keys(COMMAND_METRIC_REVIEW_GATES)
const GATE_ENTRIES = Object.entries(COMMAND_METRIC_REVIEW_GATES) as Array<[string, CommandMetricGate]>

// The broad before-state baselines. They are intentionally not narrow: they
// carry a documented table budget but not the `dbJsonWriteMs: 0` floor a
// targeted path must hold.
const BROAD_BASELINE_GATES = ['hydrated', 'message-free'] as const

function hasTableBudget(gate: CommandMetricGate): boolean {
  return Boolean(gate.expectedTables || gate.maxTables || gate.forbiddenTables)
}

describe('command mutation-range budgets', () => {
  it('every mutationPath the runtime emits has a review gate', () => {
    const emitted = collectEmittedMutationPaths()
    // Sanity: the scan found the labels we know exist, so an empty/over-narrow
    // regex can never make this assertion vacuously pass.
    expect(emitted.size).toBeGreaterThanOrEqual(GATE_KEYS.length)
    const ungated = [...emitted].filter((label) => !(label in COMMAND_METRIC_REVIEW_GATES)).sort()
    expect(ungated, 'runtime mutationPath labels with no review gate').toEqual([])
  })

  it('every review gate maps to a mutationPath the runtime still emits', () => {
    const emitted = collectEmittedMutationPaths()
    const orphaned = GATE_KEYS.filter((key) => !emitted.has(key)).sort()
    expect(orphaned, 'review gates with no runtime emitter (stale budget)').toEqual([])
  })

  it('the gate set and the emitted set are exactly equal', () => {
    const emitted = [...collectEmittedMutationPaths()].sort()
    expect(emitted).toEqual([...GATE_KEYS].sort())
  })

  it('every targeted-* gate fixes dbJsonWriteMs: 0 and declares a written-table budget', () => {
    const targeted = GATE_ENTRIES.filter(([key]) => key.startsWith('targeted-'))
    // There is at least one targeted path per Tier write family.
    expect(targeted.length).toBeGreaterThanOrEqual(5)
    for (const [key, gate] of targeted) {
      expect(gate.dbJsonWriteMs, `${key} must fix dbJsonWriteMs to 0`).toBe(0)
      expect(hasTableBudget(gate), `${key} must declare a written-table budget`).toBe(true)
    }
  })

  it('the broad baselines keep a documented written-table budget', () => {
    for (const key of BROAD_BASELINE_GATES) {
      const gate = COMMAND_METRIC_REVIEW_GATES[key]
      expect(hasTableBudget(gate), `${key} must keep its broad table budget`).toBe(true)
    }
  })

  it('no table budget escapes the known physical-table universe', () => {
    const universe = new Set<string>([...BROAD_WRITE_TABLES, 'chat_hypa_v3', 'messages'])
    for (const [key, gate] of GATE_ENTRIES) {
      for (const field of ['expectedTables', 'maxTables', 'forbiddenTables'] as const) {
        for (const table of gate[field] ?? []) {
          expect(universe.has(table), `${key}.${field} names unknown table "${table}"`).toBe(true)
        }
      }
    }
  })
})
