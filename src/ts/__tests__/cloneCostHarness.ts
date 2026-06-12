import { expect } from 'vitest'
import type { character } from '../storage/database.svelte'

/**
 * Clone-cost regression harness (test-only).
 *
 * The frontend deep-clone narrowing plan replaces whole-`Database` /
 * whole-`characters` rollback snapshots with scalar, single-row, or single-chat
 * snapshots. This module is the shared proof surface for those slices:
 *
 * - `assertSnapshotIsScalar` / `assertSnapshotOmitsCollections` are structural:
 *   they prove a snapshot never carries a full collection (and, for scalar
 *   snapshots, never carries a chat's `message` / `localLore` payload).
 * - `assertRollbackRestoresOnly` is behavioral: it generalizes the reference
 *   fix's two-part proof (the mutated slice is restored, unrelated rows are not
 *   clobbered).
 * - `withCloneInstrumentation` measures clone cost by spying on the two clone
 *   primitives (`JSON.stringify`, used by every per-file `cloneJsonValue`, and
 *   `structuredClone`, used by `safeStructuredClone`) so a test can assert a hot
 *   path performs zero whole-collection clones.
 *
 * It is intentionally independent of any specific snapshot helper and must
 * never ship a runtime instrumentation hook.
 */

// Keys whose presence in a snapshot means the whole collection was captured.
const WHOLE_COLLECTION_KEYS = ['characters', 'characterOrder', 'modules'] as const
// Keys whose presence means a full chat (message history / chat lore) leaked
// into a snapshot that is supposed to be scalar.
const CHAT_PAYLOAD_KEYS = ['message', 'localLore'] as const

function walkObjects(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  const seen = new Set<unknown>()
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (seen.has(node)) continue
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item)
      continue
    }
    const record = node as Record<string, unknown>
    visit(record)
    for (const key of Object.keys(record)) stack.push(record[key])
  }
}

/**
 * Assert a snapshot never carries a whole collection (`characters`,
 * `characterOrder`, `modules`) anywhere in its tree. Tolerates a single embedded
 * row (e.g. one `chat` or one `character`), so it fits both scalar and
 * single-row snapshots.
 */
export function assertSnapshotOmitsCollections(snapshot: unknown): void {
  walkObjects(snapshot, (node) => {
    for (const key of WHOLE_COLLECTION_KEYS) {
      if (Array.isArray(node[key])) {
        throw new Error(`snapshot unexpectedly captured the whole "${key}" collection`)
      }
    }
  })
  // Reaching here means no whole-collection array was found.
  expect(true).toBe(true)
}

/**
 * Stricter check for scalar-only snapshots: in addition to omitting whole
 * collections, the snapshot must not embed any chat payload (`message` /
 * `localLore` arrays) — i.e. it never cloned a chat row at all.
 */
export function assertSnapshotIsScalar(snapshot: unknown): void {
  assertSnapshotOmitsCollections(snapshot)
  walkObjects(snapshot, (node) => {
    for (const key of CHAT_PAYLOAD_KEYS) {
      if (Array.isArray(node[key])) {
        throw new Error(`scalar snapshot unexpectedly captured a chat "${key}" payload`)
      }
    }
  })
  expect(true).toBe(true)
}

export interface RollbackRestoresOnlySpec<S> {
  /** Capture the narrow rollback snapshot from the current state. */
  capture: () => S
  /** Apply the optimistic mutation that the failing command must undo. */
  mutate: () => void
  /** Restore from the captured snapshot (the command's rollback). */
  restore: (snapshot: S) => void
  /** Sanity: after `mutate`, the targeted slice really changed. */
  expectMutated: () => void
  /** After `restore`, the targeted slice is back to its captured value. */
  expectRestored: () => void
  /** After `restore`, unrelated rows/fields were never clobbered. */
  expectUntouched?: () => void
}

/**
 * Drive an optimistic-write-then-rollback and assert that only the mutated slice
 * is restored. Generalizes the reference fix's two assertions: the slice comes
 * back, and the rollback does not re-write unrelated concurrent state the
 * full-array restore would have wiped.
 */
export function assertRollbackRestoresOnly<S>(spec: RollbackRestoresOnlySpec<S>): void {
  const snapshot = spec.capture()
  spec.mutate()
  spec.expectMutated()
  spec.restore(snapshot)
  spec.expectRestored()
  spec.expectUntouched?.()
}

export interface CloneInstrumentation {
  /** `cloneJsonValue`-style clones (`JSON.parse(JSON.stringify(x))`). */
  jsonCloneCount: number
  /** `safeStructuredClone`-style clones (`structuredClone(x)`). */
  structuredCloneCount: number
  /** Total clone primitive invocations observed. */
  totalCloneCount: number
  /** Largest cloned payload observed, in serialized characters. */
  maxClonedSize: number
}

export interface CloneInstrumentationResult<T> extends CloneInstrumentation {
  result: T
}

export interface CloneInstrumentationCall {
  value: unknown
  stack: string
}

export interface CloneInstrumentationOptions {
  /**
   * Optional predicate for broader flows that include non-clone
   * `JSON.stringify` calls (fetch bodies, SSE frames, diagnostics). Omit it to
   * preserve the original "count every stringify" behavior used by focused
   * snapshot tests.
   */
  countJsonStringify?: (call: CloneInstrumentationCall) => boolean
  countStructuredClone?: (call: CloneInstrumentationCall) => boolean
}

/**
 * Run `fn` while spying on the two clone primitives, returning the call counts
 * and the largest cloned payload size. Restores the primitives in a `finally`.
 *
 * `fn` should be a tight, fetch-free body (a snapshot call), so the only
 * `JSON.stringify` calls observed are the clone primitive's. A whole-characters
 * clone shows up as a `maxClonedSize` at least the size of the characters array;
 * a scalar snapshot performs no large clone at all.
 */
export function withCloneInstrumentation<T>(
  fn: () => T,
  options: CloneInstrumentationOptions = {},
): CloneInstrumentationResult<T> {
  const originalStringify = JSON.stringify
  const originalStructuredClone = globalThis.structuredClone
  let jsonCloneCount = 0
  let structuredCloneCount = 0
  let maxClonedSize = 0

  const measure = (value: unknown): number => {
    // Always measure with the captured original so the structuredClone spy does
    // not recurse into the JSON.stringify spy (which would double-count).
    try {
      return (originalStringify as (input: unknown) => string)(value)?.length ?? 0
    } catch {
      return 0
    }
  }

  const trackedStringify = function trackedStringify(
    this: unknown,
    value: unknown,
    replacer?: unknown,
    space?: unknown,
  ) {
    const stack = options.countJsonStringify ? (new Error().stack ?? '') : ''
    const shouldCount = options.countJsonStringify?.({ value, stack }) ?? true
    if (shouldCount) jsonCloneCount += 1
    const out = (originalStringify as (...args: unknown[]) => string).call(this, value, replacer, space)
    if (shouldCount && typeof out === 'string' && out.length > maxClonedSize) {
      maxClonedSize = out.length
    }
    return out
  } as unknown as typeof JSON.stringify

  const trackedStructuredClone = function trackedStructuredClone<V>(value: V): V {
    const stack = options.countStructuredClone ? (new Error().stack ?? '') : ''
    const shouldCount = options.countStructuredClone?.({ value, stack }) ?? true
    if (shouldCount) {
      structuredCloneCount += 1
      const size = measure(value)
      if (size > maxClonedSize) maxClonedSize = size
    }
    return (originalStructuredClone as (input: V) => V)(value)
  } as typeof structuredClone

  JSON.stringify = trackedStringify
  globalThis.structuredClone = trackedStructuredClone
  try {
    const result = fn()
    return {
      result,
      jsonCloneCount,
      structuredCloneCount,
      totalCloneCount: jsonCloneCount + structuredCloneCount,
      maxClonedSize,
    }
  } finally {
    JSON.stringify = originalStringify
    globalThis.structuredClone = originalStructuredClone
  }
}

export async function withAsyncCloneInstrumentation<T>(
  fn: () => Promise<T>,
  options: CloneInstrumentationOptions = {},
): Promise<CloneInstrumentationResult<T>> {
  const originalStringify = JSON.stringify
  const originalStructuredClone = globalThis.structuredClone
  let jsonCloneCount = 0
  let structuredCloneCount = 0
  let maxClonedSize = 0

  const measure = (value: unknown): number => {
    try {
      return (originalStringify as (input: unknown) => string)(value)?.length ?? 0
    } catch {
      return 0
    }
  }

  const trackedStringify = function trackedStringify(
    this: unknown,
    value: unknown,
    replacer?: unknown,
    space?: unknown,
  ) {
    const stack = options.countJsonStringify ? (new Error().stack ?? '') : ''
    const shouldCount = options.countJsonStringify?.({ value, stack }) ?? true
    if (shouldCount) jsonCloneCount += 1
    const out = (originalStringify as (...args: unknown[]) => string).call(this, value, replacer, space)
    if (shouldCount && typeof out === 'string' && out.length > maxClonedSize) {
      maxClonedSize = out.length
    }
    return out
  } as unknown as typeof JSON.stringify

  const trackedStructuredClone = function trackedStructuredClone<V>(value: V): V {
    const stack = options.countStructuredClone ? (new Error().stack ?? '') : ''
    const shouldCount = options.countStructuredClone?.({ value, stack }) ?? true
    if (shouldCount) {
      structuredCloneCount += 1
      const size = measure(value)
      if (size > maxClonedSize) maxClonedSize = size
    }
    return (originalStructuredClone as (input: V) => V)(value)
  } as typeof structuredClone

  JSON.stringify = trackedStringify
  globalThis.structuredClone = trackedStructuredClone
  try {
    const result = await fn()
    return {
      result,
      jsonCloneCount,
      structuredCloneCount,
      totalCloneCount: jsonCloneCount + structuredCloneCount,
      maxClonedSize,
    }
  } finally {
    JSON.stringify = originalStringify
    globalThis.structuredClone = originalStructuredClone
  }
}

export interface SeedCloneCostDbOptions {
  /** Number of characters to seed (default 3). */
  characterCount?: number
  /** Messages in the first character's hydrated chat (default 40). */
  hydratedMessageCount?: number
  /** Approximate byte length of each message body (default 200). */
  messageBodySize?: number
}

/**
 * Build a multi-character DB with at least one multi-message hydrated chat so a
 * whole-characters clone is distinguishable from a single-row clone by size.
 * Returned as a plain object the caller assigns to `DBState.db` (cast as any in
 * tests, mirroring the existing command-test seeds).
 */
export function seedCloneCostDb(options: SeedCloneCostDbOptions = {}): {
  characters: character[]
  characterOrder: string[]
  currentChar: number
  loreBook: { id: string; name: string; data: unknown[] }[]
  loreBookPage: number
  modules: unknown[]
} {
  const characterCount = options.characterCount ?? 3
  const hydratedMessageCount = options.hydratedMessageCount ?? 40
  const body = 'x'.repeat(options.messageBodySize ?? 200)

  const characters: character[] = []
  for (let i = 0; i < characterCount; i += 1) {
    const chaId = `char-${i}`
    const messages =
      i === 0
        ? Array.from({ length: hydratedMessageCount }, (_unused, index) => ({
            role: index % 2 === 0 ? 'user' : 'char',
            data: `${body}-${index}`,
            chatId: `msg-${i}-${index}`,
          }))
        : [{ role: 'user', data: `${body}-0`, chatId: `msg-${i}-0` }]
    characters.push({
      chaId,
      name: `Character ${i}`,
      chatPage: 0,
      chats: [
        {
          id: `chat-${i}`,
          name: `Chat ${i}`,
          note: `note-${i}`,
          folderId: null,
          message: messages,
          localLore: [],
          scriptstate: { $score: String(i), $old: 'gone' },
        },
      ],
      chatFolders: [],
      globalLore: [],
      lastInteraction: i,
    } as unknown as character)
  }

  return {
    characters,
    characterOrder: characters.map((c) => c.chaId as string),
    currentChar: 0,
    loreBook: [{ id: 'global-a', name: 'Global', data: [] }],
    loreBookPage: 0,
    modules: [],
  }
}
