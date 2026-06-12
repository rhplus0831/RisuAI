import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Phase 8 verification budget: clone-cost gate completeness.
 *
 * The deep-clone narrowing plan replaced whole-`Database` / whole-`characters`
 * rollback snapshots with scalar, single-row, or single-chat snapshots on each
 * Critical/High hot path. Every such narrowing must keep a clone-cost gate (a
 * test importing `cloneCostHarness` that proves the path no longer reaches the
 * whole-collection clone) and, for the snapshot/watcher paths, a
 * rollback-correctness gate (a failed command restores only the narrowed slice).
 *
 * This file is the single budget surface for those gates. It is a pure static
 * invariant (no app harness): it scans `src` for every `*.test.ts` that imports
 * the clone-cost harness and cross-checks that set against `NARROWED_HOT_PATHS`.
 * A new clone-cost gate that is not registered, a registered gate that is
 * renamed or deleted, or a Critical/High narrowing that loses its rollback gate
 * all fail here before the coverage can silently drift.
 */

// `vitest run` executes from the repo root (the package.json directory), so the
// source tree is `<cwd>/src`. (import.meta.url is not a file: URL under the
// client vite test transform, so it cannot anchor this scan.)
const SRC_DIR = path.resolve(process.cwd(), 'src')
const HARNESS_NEEDLE = 'cloneCostHarness'
// This self-check references the harness module name as a literal, so exclude it
// from the importer scan to avoid a self-referential gate.
const SELF = 'ts/__tests__/cloneCostGateCompleteness.test.ts'

type Severity = 'critical' | 'high' | 'medium' | 'low'
type Kind = 'guard' | 'snapshot' | 'watcher'

interface GateEntry {
  /** The narrowed hot path. */
  area: string
  /** The plan phase that landed the narrowing. */
  phase: number
  severity: Severity
  kind: Kind
  /** The narrowed snapshot/guard symbol at least one gate file must exercise. */
  helper: string
  /** Test files (importing the harness) that prove the path stays narrow. */
  cloneCostGates: string[]
  /** Test files that prove a failed command restores only the narrowed slice. */
  rollbackGates: string[]
}

// Paths are relative to `src`. Every Critical/High snapshot/watcher path carries
// both a clone-cost gate and a rollback-correctness gate; the Phase 1 guard
// (the per-write clone amplifier fix) carries a clone-cost gate plus an
// immutability/refreeze gate in place of an optimistic rollback.
const NARROWED_HOT_PATHS: GateEntry[] = [
  {
    area: 'Projection write guard (copy-on-write unwrap/refreeze)',
    phase: 1,
    severity: 'critical',
    kind: 'guard',
    helper: 'withTrustedServerProjectionWrite',
    cloneCostGates: ['ts/server/projectionWriteGuard.test.ts'],
    rollbackGates: ['ts/server/projectionWriteGuard.test.ts'],
  },
  {
    area: 'Chat-scoped message/metadata/scriptstate snapshots',
    phase: 2,
    severity: 'critical',
    kind: 'snapshot',
    helper: 'restoreChatScopedState',
    cloneCostGates: ['ts/chatCommands.test.ts'],
    rollbackGates: ['ts/chatCommands.test.ts'],
  },
  {
    area: 'Chat-metadata watcher (chatBridge)',
    phase: 2,
    severity: 'critical',
    kind: 'watcher',
    helper: 'restoreChatState',
    cloneCostGates: ['ts/server/chatBridge.svelte.test.ts'],
    rollbackGates: ['ts/server/chatBridge.svelte.test.ts'],
  },
  {
    area: 'Character-row snapshot (setCurrentCharacter / v2Set* triggers)',
    phase: 2,
    severity: 'high',
    kind: 'snapshot',
    helper: 'currentCharacterRowSnapshot',
    cloneCostGates: ['ts/characterCommands.test.ts'],
    rollbackGates: ['ts/characterCommands.test.ts'],
  },
  {
    area: 'Global-lorebook snapshot + lorebook triggers',
    phase: 2,
    severity: 'high',
    kind: 'snapshot',
    helper: 'restoreScopedLorebookState',
    cloneCostGates: ['ts/server/lorebookBridge.test.ts'],
    rollbackGates: ['ts/server/lorebookBridge.test.ts'],
  },
  {
    area: 'Scriptstate var writes / runTrigger lazy char clone',
    phase: 3,
    severity: 'high',
    kind: 'snapshot',
    helper: 'materializeChar',
    cloneCostGates: ['ts/process/triggers.cloneCost.test.ts'],
    rollbackGates: ['ts/process/__tests__/triggers.projectionGuard.test.ts'],
  },
  {
    area: 'Reroll / swipe tail-clone and rollback',
    phase: 3,
    severity: 'high',
    kind: 'snapshot',
    helper: 'recordGeneratedReroll',
    cloneCostGates: ['ts/process/rerollNavigation.test.ts'],
    rollbackGates: ['ts/process/rerollNavigation.rollback.test.ts'],
  },
  {
    area: 'Script-definition watcher (scriptDefinitionBridge)',
    phase: 4,
    severity: 'high',
    kind: 'watcher',
    helper: 'watchServerBackedScriptDefinitions',
    cloneCostGates: ['ts/server/scriptDefinitionBridge.svelte.test.ts'],
    rollbackGates: ['ts/server/scriptDefinitionBridge.svelte.test.ts'],
  },
  {
    area: 'Prompt-template keystroke (promptTemplateBridge)',
    phase: 5,
    severity: 'high',
    kind: 'snapshot',
    helper: 'restorePromptItemProjectionWrite',
    cloneCostGates: ['ts/server/promptTemplateBridge.svelte.test.ts'],
    rollbackGates: ['ts/server/promptTemplateBridge.svelte.test.ts'],
  },
  {
    area: 'Lorebook watcher scope (lorebookBridge)',
    phase: 6,
    severity: 'high',
    kind: 'watcher',
    helper: 'watchServerBackedLorebooks',
    cloneCostGates: ['ts/server/lorebookBridge.svelte.test.ts'],
    rollbackGates: ['ts/server/lorebookBridge.test.ts'],
  },
  {
    area: 'Character image/emotion scoped rollback',
    phase: 7,
    severity: 'low',
    kind: 'snapshot',
    helper: 'rmCharEmotion',
    cloneCostGates: ['ts/characters.imageEmotion.test.ts'],
    rollbackGates: ['ts/characters.imageEmotion.test.ts'],
  },
  // Landed by the v1 stability/performance plan (now archived at
  // .archived-docs/audit-stability-and-performance/, Phase 1 H2), not the
  // original clone-narrowing phases; registered here because this is the one
  // budget surface for clone-cost gates.
  {
    area: 'Chat-selection scalar snapshot (changeChatTo / sidebar selectChat) — stability plan H2',
    phase: 1,
    severity: 'high',
    kind: 'snapshot',
    helper: 'restoreChatSelection',
    cloneCostGates: ['ts/globalApi.changeChatTo.test.ts', 'ts/chatCommands.test.ts'],
    rollbackGates: ['ts/chatCommands.test.ts'],
  },
  // Landed by the stability/performance plan Phase 3 (client clone narrowing).
  // `phase` below still refers to THIS registry's narrowing-plan phase column;
  // these entries reuse the plan phase that landed the underlying helper.
  {
    area: 'Send-context single-row rollback (setupSendChatContext) — stability plan M14',
    phase: 2,
    severity: 'medium',
    kind: 'snapshot',
    helper: 'setupSendChatContext',
    cloneCostGates: ['ts/process/__tests__/sendChatContext.test.ts'],
    rollbackGates: ['ts/process/__tests__/sendChatContext.test.ts'],
  },
  {
    area: 'Chat-scoped module toggle (toggleSelectedChatModule) — stability plan L34',
    phase: 2,
    severity: 'low',
    kind: 'snapshot',
    helper: 'toggleSelectedChatModule',
    cloneCostGates: ['ts/moduleCommands.test.ts'],
    rollbackGates: ['ts/moduleCommands.test.ts'],
  },
  {
    area: 'MCP setCharacterInfo single-row rollback — stability plan L35',
    phase: 2,
    severity: 'low',
    kind: 'snapshot',
    helper: 'dispatchUpdateCharacterScoped',
    cloneCostGates: ['ts/characterCommands.test.ts'],
    rollbackGates: ['ts/process/mcp/risuaccess/tests/characters.setCharacterInfo.test.ts'],
  },
  {
    area: 'setCurrentChat chat-scoped snapshot — stability plan U4',
    phase: 2,
    severity: 'low',
    kind: 'snapshot',
    helper: 'setCurrentChat',
    cloneCostGates: ['ts/chatCommands.test.ts'],
    rollbackGates: ['ts/chatCommands.test.ts'],
  },
  {
    area: 'Modules $effect dependency read (readModuleUpdateSignals) — stability plan L33',
    phase: 2,
    severity: 'low',
    kind: 'guard',
    helper: 'readModuleUpdateSignals',
    cloneCostGates: ['ts/stores.modulesEffect.svelte.test.ts'],
    rollbackGates: [],
  },
]

// Paths that intentionally keep a broad snapshot. Recorded with a reason so
// "no clone-cost gate" is never ambiguous.
const INTENTIONALLY_BROAD: { area: string; reason: string }[] = [
  {
    area: 'create / delete / reorder / fork (currentCharacterStateSnapshot, currentChatStateSnapshot)',
    reason:
      'Genuine restructures must restore the whole collection; the plan reserves the full-array snapshot for them and only stops hot paths from reaching it.',
  },
  {
    area: 'MCP lorebook / module-apply lorebook callers',
    reason:
      'Lower-frequency callers (MCP character/module lorebook edits, applyModule) still use the broad lorebook snapshot; the LoreBook sidebar editors were scoped by the stability plan L32.',
  },
  {
    area: 'PersonaSettings whole-personas snapshot',
    reason: 'Personas are small bounded config (sub-ms); kept whole, deduped to one clone per keystroke in Phase 7.',
  },
  {
    area: 'Local-assembler clones (buildMemoryWindow, request.ts, lorebook.svelte.ts, chatTemplate.ts)',
    reason:
      'Dead on the default server send route; downgraded to inventory-only in the audit (latent foot-guns, not live freezes).',
  },
]

function listTestFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listTestFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

/** Relative-to-`src`, posix-separated path. */
function relPosix(full: string): string {
  return path.relative(SRC_DIR, full).split(path.sep).join('/')
}

/** Every `*.test.ts` under `src` that imports the clone-cost harness. */
function collectHarnessGateFiles(): string[] {
  const files: string[] = []
  for (const full of listTestFiles(SRC_DIR)) {
    const rel = relPosix(full)
    if (rel === SELF) continue
    if (readFileSync(full, 'utf8').includes(HARNESS_NEEDLE)) files.push(rel)
  }
  return files.sort()
}

function readGate(rel: string): string {
  return readFileSync(path.join(SRC_DIR, rel), 'utf8')
}

const ALL_REGISTERED = [...new Set(NARROWED_HOT_PATHS.flatMap((e) => [...e.cloneCostGates, ...e.rollbackGates]))].sort()

const ROLLBACK_TOKENS = /assertRollbackRestoresOnly|rollback|restore|refreeze|read-only|reactiv/i

describe('clone-cost gate completeness', () => {
  it('finds the known clone-cost gate tests (the scan is not vacuous)', () => {
    const harnessFiles = collectHarnessGateFiles()
    // There is at least one clone-cost gate per landed phase plus the partners.
    expect(harnessFiles.length).toBeGreaterThanOrEqual(NARROWED_HOT_PATHS.length)
  })

  it('every registered gate file exists on disk', () => {
    for (const rel of ALL_REGISTERED) {
      expect(() => readGate(rel), `registered gate "${rel}" is missing`).not.toThrow()
    }
  })

  it('every clone-cost gate imports the harness and exercises a clone primitive', () => {
    const harnessFiles = collectHarnessGateFiles()
    for (const entry of NARROWED_HOT_PATHS) {
      for (const rel of entry.cloneCostGates) {
        expect(harnessFiles, `${entry.area}: clone-cost gate "${rel}" does not import the harness`).toContain(rel)
        const text = readGate(rel)
        const exercisesClone =
          text.includes('withCloneInstrumentation') ||
          text.includes('assertSnapshotIsScalar') ||
          text.includes('assertSnapshotOmitsCollections')
        expect(exercisesClone, `${entry.area}: clone-cost gate "${rel}" never measures clone cost`).toBe(true)
      }
    }
  })

  it('every rollback gate asserts a rollback / immutability property', () => {
    for (const entry of NARROWED_HOT_PATHS) {
      for (const rel of entry.rollbackGates) {
        expect(
          ROLLBACK_TOKENS.test(readGate(rel)),
          `${entry.area}: rollback gate "${rel}" asserts no rollback/immutability property`,
        ).toBe(true)
      }
    }
  })

  it('every entry has a gate file that exercises its narrowed helper', () => {
    for (const entry of NARROWED_HOT_PATHS) {
      const referenced = [...entry.cloneCostGates, ...entry.rollbackGates].some((rel) =>
        readGate(rel).includes(entry.helper),
      )
      expect(referenced, `${entry.area}: no gate references the narrowed helper "${entry.helper}"`).toBe(true)
    }
  })

  it('every Critical/High narrowed path has both a clone-cost and a rollback gate', () => {
    for (const entry of NARROWED_HOT_PATHS) {
      if (entry.severity !== 'critical' && entry.severity !== 'high') continue
      expect(entry.cloneCostGates.length, `${entry.area} lacks a clone-cost gate`).toBeGreaterThanOrEqual(1)
      expect(entry.rollbackGates.length, `${entry.area} lacks a rollback gate`).toBeGreaterThanOrEqual(1)
    }
  })

  it('the registry covers every clone-cost gate in the suite (fails on drift)', () => {
    const harnessFiles = collectHarnessGateFiles()
    // No clone-cost gate may exist unregistered: a new gate must be added here.
    const unregistered = harnessFiles.filter((rel) => !ALL_REGISTERED.includes(rel))
    expect(unregistered, 'clone-cost gate tests not registered in NARROWED_HOT_PATHS').toEqual([])
    // The registry's harness-importing files are exactly the suite's gate set:
    // a renamed/deleted gate also fails the registered-files-exist check above.
    const registeredHarness = ALL_REGISTERED.filter((rel) => harnessFiles.includes(rel))
    expect(registeredHarness).toEqual(harnessFiles)
  })

  it('covers every landed narrowing phase (1-7)', () => {
    const phases = new Set(NARROWED_HOT_PATHS.map((e) => e.phase))
    for (const phase of [1, 2, 3, 4, 5, 6, 7]) {
      expect(phases.has(phase), `no registered narrowed path for phase ${phase}`).toBe(true)
    }
  })

  it('records every intentionally-broad path with a reason', () => {
    expect(INTENTIONALLY_BROAD.length).toBeGreaterThan(0)
    for (const broad of INTENTIONALLY_BROAD) {
      expect(broad.reason.trim().length, `intentionally-broad "${broad.area}" needs a reason`).toBeGreaterThan(20)
    }
  })
})
