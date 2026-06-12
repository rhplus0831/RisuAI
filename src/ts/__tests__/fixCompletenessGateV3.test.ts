import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * V3 fix-completeness gate, Phase 0.
 *
 * Phase 0 seeds the document universe plus the routing registry. Later phases
 * flip scheduled entries from PLANNED to DONE and attach regression proof
 * fields; while entries are PLANNED, proof fields are forbidden so the gate
 * cannot imply coverage before a fix lands.
 */

// `vitest run` executes from the repo root. Match the v1/v2 gates and keep
// v3 pointed at the archived closeout docs.
const ROOT = process.cwd()
const PLAN = '.archived-docs/audit-stability-and-performance-v3'
const AUDIT_DOC = path.join(ROOT, PLAN, 'audit-stability-and-performance-v3.md')
const RISK_DOC = path.join(ROOT, PLAN, 'active-risk-analysis.md')

type AuditKind = 'H' | 'M' | 'L' | 'I'
type ActiveRiskKind = AuditKind | 'K'
type V3DocKind = ActiveRiskKind | 'R'
type GateStatus = 'PLANNED' | 'DONE'
type ActiveRiskStatus = 'PENDING' | 'DONE'
type ActiveRiskRouting = 'scheduled' | 'no-action'
type RegistryBucket = ActiveRiskRouting
type Phase = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

interface ScheduledFix {
  /** V3 audit/risk finding id (`H*`, `M*`, `L*`, `K*`). */
  id: string
  /** Plan phase that owns the fix (1-8). */
  phase: Phase
  /** Target-fix label mirrored from active-risk-analysis.md. */
  fix: string
  status: GateStatus
  /** Repo-root-relative regression test path; forbidden while PLANNED. */
  testPath?: string
  /** A string the registered test must contain; forbidden while PLANNED. */
  testName?: string
  /** Additional regression proofs; forbidden while PLANNED. */
  extraTests?: Array<{ testPath: string; testName: string }>
}

interface RegistryReason {
  id: string
  reason: string
}

interface GateContextReason {
  reason: string
}

interface GuardRepairInventoryProof {
  surface: string
  disposition: 'fixed' | 'no-action' | 'deferred'
  proof: string
}

interface ActiveRiskRoutingRow {
  id: string
  routing: ActiveRiskRouting
  phase: number | null
  targetFix: string
  status: ActiveRiskStatus | null
  rawRouting: string
  rawStatus: string
}

interface KnownOverlapResidual {
  id: string
  phase: string
  targetFix: string
  status: string
}

interface GateProblemInput {
  scheduled?: readonly ScheduledFix[]
  noAction?: readonly RegistryReason[]
  auditText?: string
  riskText?: string
}

interface TestProof {
  testPath?: string
  testName?: string
}

function planned(id: string, phase: Phase, fix: string): ScheduledFix {
  return { id, phase, fix, status: 'PLANNED' }
}

function done(
  id: string,
  phase: Phase,
  fix: string,
  testPath: string,
  testName: string,
  extraTests?: Array<{ testPath: string; testName: string }>,
): ScheduledFix {
  return {
    id,
    phase,
    fix,
    status: 'DONE',
    testPath,
    testName,
    ...(extraTests ? { extraTests } : {}),
  }
}

function noAction(id: string, reason: string): RegistryReason {
  return { id, reason }
}

const SCHEDULED_FIXES: ScheduledFix[] = [
  done(
    'H1',
    1,
    "Guard the transport's post-loop fallthrough on `signal?.aborted` (+ in-loop re-check); durable-cancel regression test.",
    'server/fastify/__tests__/generation.chat.test.ts',
    'H1: durable DELETE cancel uses abort terminal path without post-generation',
    [
      {
        testPath: 'server/fastify/__tests__/generation.chat.test.ts',
        testName: 'H1: treats sliding-deadline silent transport return as aborted',
      },
      {
        testPath: 'server/fastify/__tests__/generation.chat.test.ts',
        testName: 'H1: re-checks abort before an in-loop provider done frame',
      },
      {
        testPath: 'server/fastify/__tests__/generation.chat.test.ts',
        testName: 'H1: treats non-streaming resultFrames-style silent return as aborted',
      },
    ],
  ),
  done(
    'M1',
    2,
    'Wire `chatScopedRead: hasVarWrite ? undefined : { chatId }` into `persistAssemblyMutations` (K1 shape; assert event parentId = character id).',
    'server/fastify/__tests__/generation.chat.test.ts',
    'M1: no-var editinput transcript persistence emits messages.replaced parented to the character',
    [
      {
        testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
        testName: 'M1: no-var editinput transcript replacement adds zero whole-corpus loads',
      },
      {
        testPath: 'server/fastify/__tests__/generation.chat.test.ts',
        testName:
          'reviews representative generation prompt metric families for next-slice selection',
      },
    ],
  ),
  done(
    'M2',
    3,
    'Supply tiktoken-fallback `getSummaryTokenCost` in the `selectPromptMemory` call (repairs existing `tokens:0` rows); optionally also measure at persist.',
    'server/fastify/__tests__/assemble.test.ts',
    'M2: budgets tokens:0 prompt summaries with memory and category ratios',
    [
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName:
          'M2: caps tokens:0 Hypa memory before final budgeting so old summaries do not overflow',
      },
    ],
  ),
  done(
    'M3',
    2,
    'Settings-scoped read for the settings/prompt-settings command routes (v2-L3 shape; broad fallback on the pre-extraction edge).',
    'server/fastify/__tests__/commandMutationReadNarrowing.test.ts',
    'M3: settings commands read only the settings row on extracted SQLite state',
    [
      {
        testPath: 'server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts',
        testName: 'prompt-settings writes only the settings row',
      },
    ],
  ),
  done(
    'M4',
    1,
    'Plain-append fast-path via the single-message append command + id-keyed rollback; keep replace for trigger-rewritten transcripts.',
    'src/ts/chatCommands.test.ts',
    'appends prepared plain-send user messages through one-message POST bodies',
    [
      {
        testPath: 'src/ts/chatCommands.test.ts',
        testName: 'rolls back failed send appends by appended message id only',
      },
      {
        testPath: 'src/ts/__tests__/sendCloneCountProbe.test.ts',
        testName: 'records the M4 plain-send append fast-path clone-count shape',
      },
    ],
  ),
  done(
    'M5',
    1,
    'Field-scoped send rollback (`lastInteraction`; messages only on the first-send backfill branch), `restoreCharacterSelection` shape.',
    'src/ts/process/__tests__/sendChatContext.test.ts',
    'M5: steady-state send rollback captures no character row or message payload',
    [
      {
        testPath: 'src/ts/process/__tests__/sendChatContext.test.ts',
        testName:
          'M5: failed first-send backfill restores only active chat messages and lastInteraction',
      },
      {
        testPath: 'src/ts/__tests__/sendCloneCountProbe.test.ts',
        testName: 'M5 field-scoped rollback clone-count shape',
      },
    ],
  ),
  done(
    'M6',
    6,
    '`$derived` + keyed each for the MobileCharacters sorted list (v2-L42/L43 helper shape, unit-testable pure function).',
    'src/lib/Others/GridCatalog.svelte.test.ts',
    'M6: MobileCharacters sorted rows recompute on corpus changes but not search-only changes',
    [
      {
        testPath: 'src/lib/Others/GridCatalog.svelte.test.ts',
        testName:
          'M6: MobileCharacters helper preserves sort, trash filtering, legacy keys, search, and ago text',
      },
    ],
  ),
  done(
    'M7',
    8,
    "Store `run()`'s cleanup closure on the SandboxHost instance; invoke from `terminate()`.",
    'src/ts/plugins/apiV3/factory.test.ts',
    'M7: terminate invokes the stored run cleanup once and removes the window message listener',
    [
      {
        testPath: 'src/ts/plugins/apiV3/factory.test.ts',
        testName: 'M7: run failure removes the window message listener and iframe',
      },
      {
        testPath: 'src/ts/plugins/apiV3/v3.svelte.test.ts',
        testName: 'M7/v4-L37: loadV3Plugins unloads every existing V3 instance from a snapshot',
      },
      {
        testPath: 'src/ts/plugins/apiV3/v3.svelte.test.ts',
        testName: 'M7/L43: throwing unload callbacks do not skip SandboxHost or provider cleanup',
      },
    ],
  ),
  done(
    'M8',
    5,
    '`flushAllPendingBridgePatches()` aggregator on `pagehide`/`visibilitychange(hidden)` + watcher teardown; `keepalive` dispatch.',
    'src/ts/server/bridgeFlush.test.ts',
    'M8: pagehide and hidden visibility flush with keepalive until teardown',
    [
      {
        testPath: 'src/ts/server/settingsBridge.svelte.test.ts',
        testName: 'M8: flushes pending watched settings with keepalive and clears the debounce',
      },
      {
        testPath: 'src/ts/server/settingsBridge.svelte.test.ts',
        testName: 'M8: watcher teardown flushes pending watched settings and clears the debounce',
      },
      {
        testPath: 'src/ts/server/characterBridge.svelte.test.ts',
        testName:
          'M8: flushes pending character profile edits with keepalive and clears the debounce',
      },
      {
        testPath: 'src/ts/server/characterBridge.svelte.test.ts',
        testName:
          'M8: watcher teardown flushes pending character profile edits and clears the debounce',
      },
      {
        testPath: 'src/ts/server/chatBridge.svelte.test.ts',
        testName:
          'M8: flushes pending chat and folder metadata with keepalive and clears debounces',
      },
      {
        testPath: 'src/ts/server/chatBridge.svelte.test.ts',
        testName:
          'M8: watcher teardown flushes pending chat and folder metadata and clears debounces',
      },
      {
        testPath: 'src/ts/server/lorebookBridge.svelte.test.ts',
        testName:
          'M8: bridge flush sends pending lorebook replacements with keepalive and clears debounce',
      },
      {
        testPath: 'src/ts/server/lorebookBridge.svelte.test.ts',
        testName: 'M8: watcher teardown flushes pending lorebook replacements and clears debounce',
      },
      {
        testPath: 'src/ts/server/promptTemplateBridge.svelte.test.ts',
        testName: 'M8: flushes pending prompt item updates with keepalive and clears debounce',
      },
      {
        testPath: 'src/ts/server/promptTemplateBridge.svelte.test.ts',
        testName: 'M8: PromptSettings component teardown flushes pending prompt-template patches',
      },
      {
        testPath: 'src/ts/server/scriptDefinitionBridge.svelte.test.ts',
        testName: 'M8: flushes pending script-definition edits with keepalive and clears debounce',
      },
      {
        testPath: 'src/ts/server/scriptDefinitionBridge.svelte.test.ts',
        testName:
          'M8: watcher teardown flushes pending script-definition edits and clears debounce',
      },
    ],
  ),
  done(
    'M9',
    4,
    "`process.once('SIGTERM'\\|'SIGINT')` -> `await app.close()` with a force-exit backstop.",
    'server/fastify/__tests__/index.test.ts',
    'M9: SIGTERM reaches Fastify app.close and onClose',
    [
      {
        testPath: 'server/fastify/__tests__/index.test.ts',
        testName: 'M9: SIGINT reaches Fastify app.close and onClose',
      },
      {
        testPath: 'server/fastify/__tests__/index.test.ts',
        testName: 'M9: duplicate shutdown signals reuse one app.close call',
      },
      {
        testPath: 'server/fastify/__tests__/index.test.ts',
        testName: 'M9: hung shutdown backstop is unrefd and exits with signal-style code',
      },
    ],
  ),
  done(
    'L1',
    7,
    'Read assembly asset bytes off the event loop (async pre-resolve or async resolver contract).',
    'server/fastify/__tests__/serverLoadCostHarness.test.ts',
    'L1: image-bearing chat send performs zero assembly-time readFileSync asset reads',
    [
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName:
          'L1: repeated asset prompt refs share one async stored-asset read during assembly',
      },
    ],
  ),
  done(
    'L2',
    4,
    'Thread `RequestAbort.refresh` into `pipeStream` on activity frames (mirror `streamAssembly`).',
    'server/fastify/__tests__/generation.completion.test.ts',
    'L2: active streaming completion survives past the original deadline',
    [
      {
        testPath: 'server/fastify/__tests__/generation.completion.test.ts',
        testName: 'L2: idle streaming completion aborts at the bounded deadline',
      },
    ],
  ),
  done(
    'L3',
    7,
    'Compute reformat flags first; return `rows` unchanged when no branch applies (or clone lazily per branch).',
    'server/fastify/__tests__/assemble.test.ts',
    'L3: returns default OpenAI-flag rows by reference without mutation or prompt clones',
    [
      {
        testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
        testName:
          'Phase 7 L3/K3: default chat dispatch performs zero prompt and restoration clones',
      },
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName: 'L3: preserves byte-identical output and isolation for $name',
      },
    ],
  ),
  done(
    'L4',
    4,
    '`AbortSignal.timeout` on the fire-and-forget Horde DELETE.',
    'server/fastify/__tests__/horde.test.ts',
    'L4: bounds a hung cleanup DELETE with its own abort signal',
  ),
  done(
    'L5',
    4,
    'Create proxy stream jobs with `slidingDeadline: true` (activity detection already exists in `pushRaw`).',
    'server/fastify/__tests__/streamJobs.test.ts',
    'L5: active proxy stream jobs extend deadlineAt on JSON activity',
    [
      {
        testPath: 'server/fastify/__tests__/streamJobs.test.ts',
        testName: 'L5: silent proxy stream jobs abort at the bounded deadline',
      },
    ],
  ),
  done(
    'L6',
    7,
    'Build the char+module asset table once per assembly; share with `buildAssetLookup`.',
    'server/fastify/__tests__/assemble.test.ts',
    'L6: shares one char+module asset table across lookup and history without changing winners',
    [
      {
        testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
        testName: 'L6: image-bearing chat send builds one shared asset table per assembly',
      },
    ],
  ),
  done(
    'L7',
    7,
    'Iterate the depth slice and recursive entries without the per-call concat.',
    'server/fastify/__tests__/lorebook.test.ts',
    'L7: preserves recursive activation output without per-query combined arrays',
  ),
  done(
    'L8',
    7,
    'Per-phase narrowing of the `runTrigger` chat clone (skip/limit for non-message-mutating trigger sets; do NOT share one clone across phases).',
    'server/fastify/__tests__/triggers.test.ts',
    'L8: %s triggers with no message-mutating effects do not clone the transcript',
    [
      {
        testPath: 'server/fastify/__tests__/triggers.test.ts',
        testName: 'L8: mutating output triggers get a private transcript clone',
      },
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName:
          'L8: input, start, and output chat-var triggers avoid full trigger transcript clones',
      },
      {
        testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
        testName:
          'Phase 7 L8: no-message input/start/output triggers perform zero full transcript clones',
      },
    ],
  ),
  done(
    'L9',
    7,
    'Bound user-regex execution (haystack/pattern caps or complexity screen); document non-interruptibility at minimum.',
    'server/fastify/__tests__/triggers.test.ts',
    'L9: rejects unsafe trigger regexes before synchronous execution',
    [
      {
        testPath: 'server/fastify/__tests__/triggers.test.ts',
        testName: 'L9: preserves valid trigger regex behavior under bounds',
      },
      {
        testPath: 'server/fastify/__tests__/lorebook.test.ts',
        testName: 'L9/v4-L7: imported lorebook useRegex rejects unsafe keys before search',
      },
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName: 'L9/v4-L7: customscript script.in rejects unsafe imported regex during assembly',
      },
      {
        testPath: 'server/fastify/__tests__/generation.chat.test.ts',
        testName:
          'L9/v4-L7: unsafe imported regex stops before provider dispatch and assistant persistence',
      },
      {
        testPath: 'server/fastify/__tests__/generation.chat.test.ts',
        testName:
          'L9/v4-L7: valid imported lorebook and customscript regexes preserve generation output',
      },
    ],
  ),
  done(
    'L10',
    7,
    'Bump the history-callback memo generation from every chat-var-dirty fold (all three un-bumped sites).',
    'server/fastify/__tests__/assemble.test.ts',
    'L10: sticky-lorebook chat-var writes invalidate cached history output',
    [
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName: 'L10: run-var chat-var-only writes invalidate cached history output',
      },
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName: 'L10: Lua editRequest chat-var writes invalidate cached history output',
      },
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName: 'L10: unchanged history references still hit the memo',
      },
    ],
  ),
  done(
    'L11',
    2,
    'Collection-scoped mutation reads for the preset/persona/loadout/plugin/global-lorebook/translator-preset routes (reuse `COLLECTION_TABLE_MAP` machinery).',
    'server/fastify/__tests__/commandMutationReadNarrowing.test.ts',
    'L11: collection commands read only settings plus requested collection tables',
    [
      {
        testPath: 'server/fastify/__tests__/commandMutationReadNarrowing.test.ts',
        testName:
          'L11: collection scoped reads fall back broad for unrelated embedded settings rows',
      },
    ],
  ),
  done(
    'L12',
    2,
    'Drop the discarded corpus-wide validate-only normalization; validate the target row only.',
    'server/fastify/__tests__/commands.test.ts',
    'L12: global lorebook commands skip unrelated child-lore validation and keep target payload checks strict',
    [
      {
        testPath: 'server/fastify/__tests__/commands.test.ts',
        testName:
          'L12: script and trigger routes skip unrelated definition validation and keep target payload checks strict',
      },
    ],
  ),
  done(
    'L13',
    2,
    '`skipDatabaseLoad: true` on the single-key plugin-storage PUT/DELETE.',
    'server/fastify/__tests__/commandMutationReadNarrowing.test.ts',
    'L13: single-key plugin-storage PUT/DELETE skip database loads while bulk merge still reads current storage',
  ),
  done(
    'L14',
    2,
    'Single-row read via `getCharacterRowsByIds` for the single lorebook hydration (mirror the bulk sibling).',
    'server/fastify/__tests__/serverLoadCostHarness.test.ts',
    'L14: single character-lorebook hydration performs zero whole-corpus payload reads',
    [
      {
        testPath: 'server/fastify/__tests__/projection.test.ts',
        testName: 'matches single and bulk character lorebook hydration for the same character',
      },
    ],
  ),
  done(
    'L15',
    3,
    'Per-row token memo (WeakMap/content-hash) so the immutable summarized prefix tokenizes once.',
    'server/fastify/__tests__/memoryPlanner.test.ts',
    'L15: memoizes already-summarized prefix token counts across repeated planner passes',
    [
      {
        testPath: 'server/fastify/__tests__/memoryPlanner.test.ts',
        testName: 'L15: re-encodes edited summarized-prefix content and updates token deltas',
      },
      {
        testPath: 'server/fastify/__tests__/memoryPlanner.test.ts',
        testName: 'L15: re-encodes when summarized-prefix tokenizer options change',
      },
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName:
          'L15: memoizes unchanged summarized-prefix token counts across assembly planning passes',
      },
    ],
  ),
  done(
    'L16',
    3,
    'Arm a default deadline on the already-threaded memory-fetch AbortController (clear in finally).',
    'server/fastify/__tests__/memoryEmbedJobHandler.test.ts',
    'L16: aborts a hung normal embedding provider call and continues the batch',
    [
      {
        testPath: 'server/fastify/__tests__/memoryEmbedJobHandler.test.ts',
        testName: 'L16: clears the embedding deadline after a provider call resolves under it',
      },
      {
        testPath: 'server/fastify/__tests__/memoryEmbedJobHandler.test.ts',
        testName:
          'L16: aborts a hung single contextual embedding provider call within the deadline',
      },
      {
        testPath: 'server/fastify/__tests__/memoryEmbedJobHandler.test.ts',
        testName: 'L16: aborts a hung contextual embedding provider call within the deadline',
      },
      {
        testPath: 'server/fastify/__tests__/memorySummarizeJobHandler.test.ts',
        testName: 'L16: aborts a hung summarize fetch through runOpenAI within the deadline',
      },
    ],
  ),
  done(
    'L17',
    4,
    'Per-import AbortSignal (client-close + wall-clock) threaded into all realm egress fetches, both route branches.',
    'server/fastify/__tests__/realmImport.test.ts',
    'L17: aborts a hung dynamic Realm download at the import deadline',
    [
      {
        testPath: 'server/fastify/__tests__/realmImport.test.ts',
        testName: 'L17: aborts upstream resource fetch when the SSE client disconnects',
      },
    ],
  ),
  done(
    'L18',
    4,
    'Per-asset + cumulative byte caps for JSON-card staging (charx shape); bound the dynamic `res.json()` body.',
    'server/fastify/__tests__/realmImport.test.ts',
    'L18: rejects known-length oversized Realm dynamic JSON before reading the body',
    [
      {
        testPath: 'server/fastify/__tests__/realmImport.test.ts',
        testName: 'L18: aborts unknown-length oversized Realm dynamic JSON once the cap is crossed',
      },
      {
        testPath: 'server/fastify/__tests__/realmImport.test.ts',
        testName:
          'L18: rejects JSON-card fetched resources above the per-asset cap before reading the body',
      },
      {
        testPath: 'server/fastify/__tests__/realmImport.test.ts',
        testName: 'L18: rejects cumulative JSON-card fetched assets and cleans staged files',
      },
      {
        testPath: 'server/fastify/__tests__/realmImport.test.ts',
        testName: 'L18: keeps valid JSON Realm import output unchanged with disk-staged assets',
      },
    ],
  ),
  done(
    'L19',
    4,
    'Register response compression (`@fastify/compress` or onSend gzip) with a sane threshold, default ON.',
    'server/fastify/__tests__/bootstrap.test.ts',
    'L19: gzip-compresses large bootstrap JSON without changing the body',
    [
      {
        testPath: 'server/fastify/__tests__/static.test.ts',
        testName: 'L19: gzip-compresses large static assets without changing the bytes',
      },
      {
        testPath: 'server/fastify/__tests__/static.test.ts',
        testName: 'L19: leaves small API responses below the compression threshold uncompressed',
      },
      {
        testPath: 'server/fastify/__tests__/generation.chat.test.ts',
        testName: 'L19: leaves chat SSE uncompressed when gzip is requested',
      },
    ],
  ),
  done(
    'L20',
    4,
    "`maxAge: '1y', immutable: true` for the hashed SPA chunks (index.html stays uncached).",
    'server/fastify/__tests__/static.test.ts',
    'L20: immutable-caches SPA assets under /assets',
    [
      {
        testPath: 'server/fastify/__tests__/static.test.ts',
        testName: 'L20: keeps GET / outside immutable chunk caching',
      },
      {
        testPath: 'server/fastify/__tests__/static.test.ts',
        testName: 'L20: keeps SPA fallback outside immutable chunk caching',
      },
      {
        testPath: 'server/fastify/__tests__/static.test.ts',
        testName: 'L20: preserves API 404 outside SPA fallback',
      },
      {
        testPath: 'server/fastify/__tests__/static.test.ts',
        testName: 'L20: preserves non-GET SPA fallback rejection',
      },
    ],
  ),
  done(
    'L21',
    5,
    'Add a rollback parameter to `runPresetCommand`; snapshot `botPresets`/`botPresetsId` + the `setPreset` scalar settings.',
    'src/ts/storage/database.svelte.test.ts',
    'L21: failed select restores setPreset scalars without overwriting unrelated fields',
    [
      {
        testPath: 'src/ts/storage/database.svelte.test.ts',
        testName: 'L21: failed save restores the saved preset collection and selected index',
      },
      {
        testPath: 'src/ts/storage/database.svelte.test.ts',
        testName:
          'L21: failed copy restores the original collection after save-current and generated copy id',
      },
      {
        testPath: 'src/ts/storage/database.svelte.test.ts',
        testName: 'L21: failed create removes the optimistic preset and generated id',
      },
      {
        testPath: 'src/ts/storage/database.svelte.test.ts',
        testName: 'L21: failed update restores the patched preset row',
      },
      {
        testPath: 'src/ts/storage/database.svelte.test.ts',
        testName: 'L21: failed delete restores collection, selection, and setPreset scalars',
      },
      {
        testPath: 'src/ts/storage/database.svelte.test.ts',
        testName: 'L21: failed reorder restores collection order and selected index',
      },
      {
        testPath: 'src/ts/storage/database.importPreset.test.ts',
        testName: 'L21: a failed preset import rolls back the optimistic imported row',
      },
    ],
  ),
  done(
    'L22',
    6,
    'Gate the character-draft mirror recomputation (character switch / apply epoch); split the read/seed effect.',
    'src/ts/server/characterBridge.svelte.test.ts',
    'L22: editing nested draft fields does not rerun the server seed path',
    [
      {
        testPath: 'src/ts/server/characterBridge.svelte.test.ts',
        testName: 'L22: character switch reseeds the draft',
      },
      {
        testPath: 'src/ts/server/characterBridge.svelte.test.ts',
        testName: 'L22: server projection apply with changed fields reseeds the draft',
      },
      {
        testPath: 'src/ts/server/characterBridge.svelte.test.ts',
        testName: 'L22: local edits update projection and dispatch sanitized character patches',
      },
    ],
  ),
  done(
    'L23',
    5,
    '`suppressRollbackDispatch` around both the optimistic write and the rollback in `applyServerBackedSettingsPatch`.',
    'src/ts/server/settingsBridge.svelte.test.ts',
    'L23: direct settings patches suppress watcher echoes for optimistic writes and rollback writes',
    [
      {
        testPath: 'src/ts/server/settingsBridge.svelte.test.ts',
        testName: 'L23: queued settings rollback suppresses watcher echoes for debounced writes',
      },
    ],
  ),
  done(
    'L24',
    5,
    "Suppress the global-lorebook direct dispatchers' rollbacks (route through `rollbackLorebookReplacement`).",
    'src/ts/server/lorebookBridge.svelte.test.ts',
    'L24: global lorebook direct rollback parity routes every dispatcher through suppressed helpers',
    [
      {
        testPath: 'src/ts/server/lorebookBridge.svelte.test.ts',
        testName:
          'L24: global lorebook rename rollback suppresses watcher echo and keeps later edits live',
      },
      {
        testPath: 'src/ts/server/lorebookBridge.svelte.test.ts',
        testName:
          'L24: global lorebook direct rollback closures restore under an active watcher without echoes',
      },
    ],
  ),
  done(
    'L25',
    5,
    'Keep the FIRST baseline across coalesced same-item prompt-template edits.',
    'src/ts/server/promptTemplateBridge.svelte.test.ts',
    'L25: coalesced prompt item rollback restores the first pre-edit item',
  ),
  done(
    'L26',
    5,
    'Route the chat-row metadata rollback through the suppressing wrapper.',
    'src/ts/server/chatBridge.svelte.test.ts',
    'L26: chat row rollback suppresses watcher echo and resets the restored baseline',
  ),
  done(
    'L27',
    5,
    'Promote the pending entry snapshot to a collection snapshot when a second entry edit lands in the same debounce window.',
    'src/ts/server/lorebookBridge.svelte.test.ts',
    'L27: coalesced entry-draft rollback restores the first pre-edit collection',
    [
      {
        testPath: 'src/ts/server/lorebookBridge.svelte.test.ts',
        testName: 'K4: a single typing draft clones only the edited entry before debounce settle',
      },
    ],
  ),
  done(
    'L28',
    6,
    'Reference-keyed lazy `localLore` snapshots in the character-scope watcher (keep full rollback coverage).',
    'src/ts/server/lorebookBridge.svelte.test.ts',
    'L28: unchanged selected-character chat localLore references reuse cached snapshots',
    [
      {
        testPath: 'src/ts/server/lorebookBridge.svelte.test.ts',
        testName: 'L28: replacing one localLore array stringifies only that chat',
      },
      {
        testPath: 'src/ts/server/lorebookBridge.svelte.test.ts',
        testName: 'L28: character-scoped watcher dispatches a non-open chat localLore replacement',
      },
    ],
  ),
  done(
    'L29',
    6,
    "Cheap short-circuit before the chat-metadata watcher's per-chat scalar Map rebuild.",
    'src/ts/server/chatBridge.svelte.test.ts',
    'L29: message-only guarded writes reuse scalar maps and queue no patches',
    [
      {
        testPath: 'src/ts/server/chatBridge.svelte.test.ts',
        testName: 'L29: real chat and folder scalar edits still dispatch after a no-change fire',
      },
    ],
  ),
  done(
    'L30',
    6,
    'Cache the corpus-derived parse-memo key signature by its cheap invalidation tokens; build the detection key once per message.',
    'src/lib/ChatScreens/ChatBody.parseMemo.test.ts',
    'L30: repeated parse-key builds reuse corpus signatures until invalidators change',
    [
      {
        testPath: 'src/lib/ChatScreens/ChatBody.parseMemo.test.ts',
        testName:
          'L30: cached-only LLM detection reuses a prebuilt parse key without rebuilding it',
      },
    ],
  ),
  done(
    'L31',
    6,
    'Memoize the parsed customHTML GUI template per template version, shared across messages.',
    'src/lib/ChatScreens/Chat.customHtml.test.ts',
    'L31: repeated customHTML rows share one parsed template per template version',
    [
      {
        testPath: 'src/lib/ChatScreens/Chat.customHtml.test.ts',
        testName:
          'L31: guiHTML changes and cbs-condition changes invalidate the customHTML template memo',
      },
    ],
  ),
  done(
    'L32',
    6,
    'Cap `bestMatchCache` and reset it in `resetScriptCache()`.',
    'src/ts/process/scripts.regexCache.test.ts',
    'L32: bestMatchCache is capped and evicts the least recently used match',
    [
      {
        testPath: 'src/ts/process/scripts.regexCache.test.ts',
        testName: 'L32: resetScriptCache clears bestMatchCache with the script caches',
      },
    ],
  ),
  done(
    'L33',
    6,
    'Stop/null `bgmElement` on chat/character switch; clear stale observed bgm nodes.',
    'src/ts/observer.svelte.test.ts',
    'L33: chat switch cleanup pauses current BGM and lets the next control attach',
  ),
  done(
    'L34',
    5,
    'Wrap the IGP append in the trusted write + persist via a scoped chat command (fix the I11 `[object Object]` coercion in the same change).',
    'src/ts/process/__tests__/igp.test.ts',
    'L34: appends and persists under the enabled projection guard',
    [
      {
        testPath: 'src/ts/process/__tests__/igp.test.ts',
        testName: 'L34: appends the explicit response result instead of raw object coercion',
      },
      {
        testPath: 'src/ts/process/__tests__/igp.test.ts',
        testName: 'L34/I11: stringifies non-string IGP result payloads without [object Object]',
      },
      {
        testPath: 'src/ts/translator/translator.cache.test.ts',
        testName:
          'v4-L30: current translator preset sync reads from a snapshot without mutating live legacy fields',
      },
      {
        testPath: 'src/ts/translator/translator.cache.test.ts',
        testName:
          'v4-L30: current translator preset normalization reads from a snapshot without writing preset defaults to live DB',
      },
    ],
  ),
  done(
    'L35',
    5,
    'Wrap + dispatch a scoped command for the inlay error bubble; add a guard-enabled test.',
    'src/ts/process/__tests__/sendChatErrors.test.ts',
    'L35: writes and persists the inlay bubble under the enabled projection guard',
    [
      {
        testPath: 'src/ts/process/__tests__/sendChatErrors.test.ts',
        testName: 'L35: keeps modal fallback for invalid targets while the guard is enabled',
      },
      {
        testPath: 'src/ts/process/scripts.editdisplay.test.ts',
        testName:
          'I20: @@inject display action runs under the projection guard without durable persistence',
      },
    ],
  ),
  done(
    'L36',
    5,
    'Route `sendPofile` transcript mutations through the trusted write + scoped messages command; absorb picker cancel/error and `.po` processing failures at the `postChatFile` boundary.',
    'src/ts/process/files/multisend.test.ts',
    'L36: .po transcript writes persist through scoped commands under the guard',
    [
      {
        testPath: 'src/ts/process/files/multisend.test.ts',
        testName: 'L36: picker cancellation and picker errors resolve without uncaught rejection',
      },
      {
        testPath: 'src/ts/process/files/multisend.test.ts',
        testName: 'L36: .po processing errors resolve without uncaught rejection',
      },
      {
        testPath: 'src/ts/process/mcp/mcp.test.ts',
        testName:
          'v4-L33: isolates a failing internal handshake while keeping other MCP tools usable',
      },
      {
        testPath: 'src/ts/__tests__/fixCompletenessGateV3.test.ts',
        testName: 'records Phase 5 guard-repair bounded inventory dispositions',
      },
    ],
  ),
  done(
    'L37',
    5,
    'Null-safe global error handler: check `event.target` (not `event.error.target`), skip alerting when no usable error exists.',
    'src/ts/bootstrap.test.ts',
    'L37/I21: global handlers ignore null error events and undefined rejections without useless alerts',
    [
      {
        testPath: 'src/ts/bootstrap.test.ts',
        testName: 'L37: resource-target global errors skip generic application alerts',
      },
      {
        testPath: 'src/ts/bootstrap.test.ts',
        testName: 'L37: useful global Error objects and message strings still alert',
      },
      {
        testPath: 'src/ts/alert.test.ts',
        testName: 'L37/I21: accepts non-string payloads with String coercion after Error handling',
      },
    ],
  ),
  done(
    'L38',
    8,
    'Port the server `TriggerExecutionBudget` caps + abort to the client `runTrigger` (manual entrypoints).',
    'src/ts/process/triggers.clientBudget.test.ts',
    'L38: manual v2Loop stops at the shared client trigger budget',
    [
      {
        testPath: 'src/ts/process/triggers.clientBudget.test.ts',
        testName: 'L38: manual trigger abort signal interrupts v2Wait before later effects',
      },
      {
        testPath: 'src/ts/process/triggers.clientBudget.test.ts',
        testName: 'L38: manual v2Wait wakes at the wall-clock budget without an abort signal',
      },
    ],
  ),
  done(
    'L39',
    8,
    'Install the instruction-count hook + wall-clock deadline on client Lua engines (server `luaRuntime` shape).',
    'src/ts/process/scriptings.test.ts',
    'L39: client Lua while true loads through the timeout-bound thread',
  ),
  done(
    'L40',
    8,
    'Key the client Lua engine cache on `(mode, codeHash)` (or a small per-mode LRU).',
    'src/ts/process/scriptings.test.ts',
    'L40: same-mode Lua code hash cache reuses alternating bodies and evicts by LRU',
  ),
  done(
    'L41',
    8,
    'Delete the editDisplay access key in the cleanup tail (run cleanup in a `finally`).',
    'src/ts/process/scriptings.test.ts',
    'L41: editDisplay access key is removed after Lua success and rejection',
    [
      {
        testPath: 'src/ts/process/scriptings.test.ts',
        testName: 'L41: Python editDisplay rejection cleans up access key',
      },
    ],
  ),
  done(
    'L42',
    8,
    'LRU-bound `googleCloudTokenizedCache` (or fold into `encodeCache`).',
    'src/ts/tokenizer.test.ts',
    'L42: GoogleCloud token cache evicts oldest entries and refills with the same count',
    [
      {
        testPath: 'src/ts/tokenizer.test.ts',
        testName: 'L42: GoogleCloud token counts hit the bounded cache for repeated text',
      },
      {
        testPath: 'src/ts/tokenizer.test.ts',
        testName: 'L42: GoogleCloud cache keys keep model and text boundaries collision-safe',
      },
    ],
  ),
  done(
    'L43',
    8,
    'Reset/dedupe the custom-provider stores on plugin reload (mirror the existing reset block; or unload-callback removal).',
    'src/ts/plugins/apiV3/v3.svelte.test.ts',
    'L43: custom provider stores dedupe by provider name and unload by plugin ownership',
    [
      {
        testPath: 'src/ts/plugins/apiV3/v3.svelte.test.ts',
        testName: 'L43: unloading a V3 provider does not remove a same-name provider reloaded by V2',
      },
    ],
  ),
  done(
    'L44',
    8,
    'Gate or remove the SandboxHost RPC console logs (never log transferables).',
    'src/ts/plugins/apiV3/factory.test.ts',
    'L44: guest RPC calls do not log request response payloads or transferables by default',
  ),
  done(
    'L45',
    8,
    'Compute MCP tools lazily, only in the browser-local adapters that consume them.',
    'src/ts/process/mcp/mcp.test.ts',
    'L45: skips MCP tool discovery for Fastify server completions that discard tools',
  ),
  done(
    'L46',
    8,
    'In-flight construction promise per MCP key (the `mcpToolClientIndexBuild` dedup shape).',
    'src/ts/process/mcp/mcp.test.ts',
    'L46: shares concurrent first construction for one remote MCP key',
    [
      {
        testPath: 'src/ts/process/mcp/mcp.test.ts',
        testName: 'L46: clears a failed in-flight remote construction so a later call can retry',
      },
    ],
  ),
  done(
    'L47',
    8,
    'Size-cap the persistent `connectSSE` buffer (abort + destroy past a few MB without a delimiter).',
    'src/ts/process/mcp/mcplib.test.ts',
    'L47: aborts and errors when an SSE response buffer exceeds the delimiter cap',
  ),
  done(
    'L48',
    8,
    'Page/byte caps + AbortSignal + honor the `limit` argument in the MCP PDF read.',
    'src/ts/process/mcp/filesystemclient.test.ts',
    'L48: passes PDF page/output caps and honors the requested limit',
    [
      {
        testPath: 'src/ts/process/mcp/filesystemclient.test.ts',
        testName: 'L48: rejects PDFs above the input byte cap before reading bytes',
      },
      {
        testPath: 'src/ts/process/mcp/filesystemclient.test.ts',
        testName: 'L48: honors AbortSignal before starting PDF byte reads',
      },
      {
        testPath: 'src/ts/process/mcp/filesystemclient.test.ts',
        testName:
          'v4-L35: encodes capped base64 reads in chunks instead of spreading the whole file',
      },
      {
        testPath: 'src/ts/process/mcp/filesystemclient.test.ts',
        testName: 'v4-L35: skips oversized files before content-search text reads',
      },
    ],
  ),
  done(
    'L49',
    8,
    '`await hypa.addText(...)` at the three file-attach builders.',
    'src/ts/process/files/multisend.test.ts',
    'L49: awaits async text ingestion so .txt content reaches the File block',
  ),
  done(
    'L50',
    8,
    'Remove the image-generation payload logs (incl. the comfy poll-loop log).',
    'src/ts/process/stableDiff.test.ts',
    'L50: image generation providers do not console-log payloads or poll bodies',
    [
      {
        testPath: 'src/ts/process/tts.test.ts',
        testName:
          'L50/I16: GPT-SoVITS and FishSpeech do not console-log request or response bodies',
      },
    ],
  ),
  done(
    'L51',
    8,
    'Revoke object URLs in `finally` at the image-processing sites (incl. the `scriptings.ts` siblings).',
    'src/ts/process/files/tests/inlays.test.ts',
    'L51: revokes the temporary image object URL after upload',
    [
      {
        testPath: 'src/ts/process/files/tests/inlays.test.ts',
        testName: 'L51/v4-L36: revokes the object URL when decode fails',
      },
      {
        testPath: 'src/ts/process/processzip.test.ts',
        testName: 'L51: writeJpeg revokes the temporary object URL after decode and append',
      },
      {
        testPath: 'src/ts/process/scriptings.test.ts',
        testName: 'L51: getPersonaImageMain revokes its object URL when inlay writing fails',
      },
    ],
  ),
  done(
    'L52',
    8,
    'Shared/closed AudioContext for `runVITS` (mirror `getNetworkAudioContext`); add the missing decode error callback.',
    'src/ts/process/transformers.test.ts',
    'L52: repeated VITS calls reuse one AudioContext and release ended sources',
    [
      {
        testPath: 'src/ts/process/transformers.test.ts',
        testName: 'L52: decodeAudioData errors reject through the callback path',
      },
    ],
  ),
  done(
    'L53',
    8,
    'Dispose the old VITS synthesizer before replacing (mirror the extractor).',
    'src/ts/process/transformers.test.ts',
    'L53: switching VITS models disposes the old synthesizer before replacing it',
  ),
  done(
    'L54',
    8,
    '`await pdf.destroy()` in a `finally` after PDF conversion.',
    'src/ts/process/dynamicutils/pdf.test.ts',
    'L54: awaits pdf.destroy() in finally after conversion',
  ),
  done(
    'L55',
    8,
    'Close the whisper-mode AudioContexts and revoke the probe-video URL.',
    'src/lib/Playground/PlaygroundSubtitle.test.ts',
    'L55: probeVideoDuration revokes the probe object URL after metadata probing',
    [
      {
        testPath: 'src/lib/Playground/PlaygroundSubtitle.test.ts',
        testName: 'L55: temporary whisper AudioContexts close after decode success and failure',
      },
    ],
  ),
  done(
    'L56',
    4,
    'Keep the proxy-stream abort listener attached for the whole stream; issue the job DELETE from `closeAndEnd` when no terminal frame arrived.',
    'src/ts/globalApi.proxy.test.ts',
    'DELETEs the proxy stream job once when aborted after headers but before a terminal frame',
    [
      {
        testPath: 'src/ts/globalApi.proxy.test.ts',
        testName: 'returns the existing 499 response shape when aborted before headers',
      },
      {
        testPath: 'src/ts/globalApi.proxy.test.ts',
        testName: 'closes normally on terminal done without DELETEing the finished job',
      },
      {
        testPath: 'src/ts/globalApi.proxy.test.ts',
        testName: 'closes on terminal server error without DELETEing the finished job',
      },
      {
        testPath: 'src/ts/globalApi.proxy.test.ts',
        testName:
          'does not DELETE on WebSocket close before terminal when the request was not locally aborted',
      },
    ],
  ),
  done(
    'K1',
    3,
    'Skip/lazy the embedding `vector_blob` decode when no valid query vectors exist (v2-R5 re-open: the dismissal covered the math, not the decode).',
    'server/fastify/__tests__/memorySelectionService.test.ts',
    'K1: empty-query selection keeps embedding diagnostics without reading malformed vectors',
    [
      {
        testPath: 'server/fastify/__tests__/memoryRepository.test.ts',
        testName: 'K1: lazily validates embedding vector blobs only when vector is read',
      },
      {
        testPath: 'server/fastify/__tests__/memorySelectionService.test.ts',
        testName: 'K1: valid-query selection still fails when a malformed vector must be decoded',
      },
      {
        testPath: 'server/fastify/__tests__/memorySimilarityRanking.test.ts',
        testName: 'K1: skips embedding vector reads when query vectors are empty or invalid',
      },
      {
        testPath: 'server/fastify/__tests__/memorySimilarityRanking.test.ts',
        testName:
          'K1: reads embedding vectors and preserves ranking diagnostics for valid query vectors',
      },
    ],
  ),
  done(
    'K2',
    2,
    'Drop the redundant in-handler auth verify on the proxy/hub routes (v2-L16 propagation).',
    'server/fastify/__tests__/auth.test.ts',
    'K2: proxy and hub route auth verifies exactly once when protected',
    [
      {
        testPath: 'server/fastify/__tests__/auth.test.ts',
        testName:
          'K2: unauthenticated proxy and hub requests stop before body parsing or forwarding',
      },
    ],
  ),
  done(
    'K3',
    7,
    'Return the provably-immutable `initialMessages` restoration payload by reference (v2-M1 ring).',
    'server/fastify/__tests__/assemble.test.ts',
    'K3: returns immutable initial restoration messages by reference and clones scriptstate',
    [
      {
        testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
        testName:
          'Phase 7 L3/K3: default chat dispatch performs zero prompt and restoration clones',
      },
    ],
  ),
  done(
    'K4',
    8,
    '`onerror` + timeout for the stableDiff reference-image load (v2-L49 propagation).',
    'src/ts/process/stableDiff.test.ts',
    'K4: reference image loading rejects onerror and timeout instead of hanging',
  ),
]

const NO_ACTION: RegistryReason[] = [
  noAction(
    'I1',
    'Active-writer guard manifest scan per request (method-prefiltered, cached regexes).',
  ),
  noAction(
    'I2',
    'Bulk projection unbounded (deduped) ids + O(N·M) apply loop (export readers only).',
  ),
  noAction('I3', 'Proxy copies the request body before forwarding (bounded by bodyLimit).'),
  noAction('I4', 'Finalization retry lacks attempt cap/backoff (realistic errors self-heal).'),
  noAction(
    'I5',
    'JS trigger budget recreated per phase; may ride Phase 7 (shared per-send budget) if free.',
  ),
  noAction(
    'I6',
    'Summarize handler O(total chats) existence scan; may ride Phase 3 (hoist per batch / indexed probe) if free.',
  ),
  noAction(
    'I7',
    'Server prompt-assembly classifier runs twice per send; may ride Phase 1 if free.',
  ),
  noAction(
    'I8',
    '`assetByteReadCounts` diagnostics Map populated with metrics off (no live consumer).',
  ),
  noAction('I9', '`addFetchLog` (streaming) never trims while the JSON path caps at 20.'),
  noAction('I10', '`addFetchLog` positional index-0 aliasing corrupts the debug fetch view.'),
  noAction(
    'I11',
    "`evaluateIgp` appends `'[object Object]'` — fixed as part of L34, not separately.",
  ),
  noAction('I12', 'ModuleChatMenu per-keystroke sort (v2-L43 sibling); may ride Phase 6 if free.'),
  noAction('I13', 'Code-block download object URL never revoked.'),
  noAction('I14', 'BotSettings preset-icon object URL never revoked.'),
  noAction(
    'I15',
    '`hypaVector` IndexedDB embedding cache grows without eviction (intentional disk cache).',
  ),
  noAction(
    'I16',
    "GPT-SoVITS/FishSpeech TTS log full bodies; may ride Phase 8's L50 log sweep if free.",
  ),
  noAction(
    'I17',
    "LLM translator logs `translatorNote` per cache-missed call; may ride Phase 8's L50 sweep if free.",
  ),
  noAction(
    'I18',
    '`templateCheck` re-scans per guarded write while Prompt Settings is open (v2-M13 deferred); may ride Phase 6 if free.',
  ),
  noAction(
    'I19',
    '`DBState.db` proxy re-mint per guarded write is the deliberate design; fix consumers (Phase 6), not the guard.',
  ),
  noAction(
    'I20',
    "`@@inject` display action silent no-op under the guard; rides Phase 5's guard-repair batch (same wrap pattern as L34-L36).",
  ),
  noAction(
    'I21',
    "`alertError` throws on undefined rejection reasons; rides L37's handler hardening.",
  ),
  noAction('I22', 'Production image ships 74 MB of sourcemaps (build hygiene; optional).'),
  noAction(
    'I23',
    'No `manualChunks`; ~3.5 MB eager app graph incl. all-locale lang chunk (optional split).',
  ),
  noAction(
    'R1',
    '`similaritySearchVectorWithScore` comparator concern is empirically byte-identical on V8/Node 24 and highest-impact consumers sort correctly.',
  ),
  noAction(
    'R2',
    '`pyworker` listener/promise leak is a dead arm because no live caller creates a Python context on this runtime.',
  ),
  noAction(
    'R3',
    'ChatBody parse memo staleness claim is invalid because resolved getvar output rides the memo key through data.',
  ),
  noAction(
    'R4',
    'Buffered standalone completion abort path is unreachable from the live SPA server-intent completion client.',
  ),
  noAction(
    'R5',
    'Chat-FOLDER-row rollback path has no live entry point; the live chat-row sibling is scheduled as L26.',
  ),
]

const GATED_CONTEXT_REASONS: GateContextReason[] = [
  {
    reason:
      '`v2-L12` stays as archived owner-decision context for wasmoon boot serialization, not a v3 scheduled ID.',
  },
  {
    reason:
      'v1 carry-overs v1-L4, v1-L7, v1-L26, and v1-U2 remain archived gates unless new evidence or owner approval re-opens them.',
  },
  {
    reason:
      '../leftover.md evidence gates stay explanatory only: prompt assembly loads, bootstrap load, byte fanout, memory-worker blocking, and token re-accumulation are not v3 IDs.',
  },
  {
    reason:
      'v4-L30 and v4-L33 are Phase 5 guard-repair proof riders only: translator preset read-path cloning and partial MCP handshake isolation are covered without adding v3 active-risk rows.',
  },
]

const REQUIRED_GUARD_REPAIR_INVENTORY_SURFACES = [
  'DBState.db',
  'getDatabase()',
  'translator preset getters',
  'IGP/inlay/file transcript mutation',
  'display/script injection',
  'MCP bootstrap/handshake',
]

const GUARD_REPAIR_INVENTORY_PROOF: GuardRepairInventoryProof[] = [
  {
    surface: 'DBState.db',
    disposition: 'fixed',
    proof:
      'Guard-breaking DBState.db mutations in IGP, inlay bubbles, .po transcript writes, and @@inject display writes now enter trusted projection writes or scoped chat commands; ordinary projection reads and server apply/rollback writes remain no-action by design.',
  },
  {
    surface: 'getDatabase()',
    disposition: 'fixed',
    proof:
      'The translator read path that previously normalized through getDatabase() now reads from getDatabase({ snapshot: true }); other getDatabase() reads in the bounded inventory are no-action reads.',
  },
  {
    surface: 'translator preset getters',
    disposition: 'fixed',
    proof:
      'getCurrentTranslatorPreset() passes a snapshot into the mutating preset normalizer, while getCurrentTranslatorPresetFromState keeps its trusted mutable-state contract for callers that already own mutable state.',
  },
  {
    surface: 'IGP/inlay/file transcript mutation',
    disposition: 'fixed',
    proof:
      'IGP append, send-error inlay bubble, and sendPofile transcript turns are guard-enabled and persist through scoped current-chat message commands instead of raw durable projection writes.',
  },
  {
    surface: 'display/script injection',
    disposition: 'fixed',
    proof:
      '@@inject uses a trusted transient projection write and intentionally does not dispatch a durable command, preserving display-only semantics while avoiding the guard throw.',
  },
  {
    surface: 'MCP bootstrap/handshake',
    disposition: 'fixed',
    proof:
      'initializeMCPs isolates internal checkHandshake failures per client/tool set so a failing internal client is unavailable to diagnostics without rejecting every client-side LLM tool initialization.',
  },
]

const REQUIRED_MEDIA_CLEANUP_INVENTORY_SURFACES = [
  'image-generation logs and poll timers',
  'TTS and translator riding logs',
  'image-processing object URLs',
  'VITS audio context and synthesizer',
  'PDF document lifecycle',
  'subtitle whisper media resources',
  'inlay decode caps',
]

const MEDIA_CLEANUP_INVENTORY_PROOF: GuardRepairInventoryProof[] = [
  {
    surface: 'image-generation logs and poll timers',
    disposition: 'fixed',
    proof:
      'stableDiff image-generation paths no longer console-log provider payloads or comfy poll-loop bodies; stage-4 imggen passes the live AbortSignal and comfy/wavespeed poll sleeps clear on abort, recording v4-L31 as a Phase 8 rider only.',
  },
  {
    surface: 'TTS and translator riding logs',
    disposition: 'fixed',
    proof:
      'GPT-SoVITS, FishSpeech, and ElevenLabs voice-list body logs are removed for I16; the LLM translatorNote log was already removed in the Phase 8 translator hygiene slice, so I17 remains an informational rider with no scheduled status row.',
  },
  {
    surface: 'image-processing object URLs',
    disposition: 'fixed',
    proof:
      'postInlayAsset, reencodeImage, CharXWriter.writeJpeg, and scripting persona/character image helpers now revoke temporary object URLs in finally blocks on both success and failure.',
  },
  {
    surface: 'VITS audio context and synthesizer',
    disposition: 'fixed',
    proof:
      'runVITS reuses a shared AudioContext, rejects decodeAudioData failures through the error callback, releases ended sources, and disposes the old synthesizer before loading a replacement model.',
  },
  {
    surface: 'PDF document lifecycle',
    disposition: 'fixed',
    proof:
      'convertPdfToImages awaits pdf.destroy() in finally after successful conversion, errors, and abort-triggered cleanup, while the earlier L48 PDF input/page/output caps remain intact.',
  },
  {
    surface: 'subtitle whisper media resources',
    disposition: 'fixed',
    proof:
      'Playground subtitle video probing revokes the probe URL and removes the element; whisper-local audio decode uses temporary AudioContexts that close after decode success or failure.',
  },
  {
    surface: 'inlay decode caps',
    disposition: 'fixed',
    proof:
      'writeInlayImage and reencodeImage reject oversized source images before canvas work, recording v4-L36 model/proxy image decode caps as a Phase 8 rider only.',
  },
]

function readDoc(file: string): string {
  return readFileSync(file, 'utf8')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The slice of `text` under a markdown heading up to the next same-or-higher heading. */
function sectionOf(text: string, heading: string): string {
  const match = new RegExp(`^(#{1,6})\\s+${escapeRegExp(heading)}\\s*$`, 'm').exec(text)
  if (!match) throw new Error(`section "${heading}" not found`)

  const level = match[1].length
  const rest = text.slice(match.index + match[0].length)
  const nextHeading = new RegExp(`\\n#{1,${level}}\\s`).exec(rest)
  return nextHeading ? rest.slice(0, nextHeading.index) : rest
}

function kindOrder(kind: string): number {
  return ['H', 'M', 'L', 'I', 'K', 'R'].indexOf(kind)
}

function numericIdSort(a: string, b: string): number {
  const kindCompare = kindOrder(a[0]) - kindOrder(b[0])
  if (kindCompare !== 0) return kindCompare
  return Number(a.slice(1)) - Number(b.slice(1))
}

function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort(numericIdSort)
}

function rangeIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `${prefix}${index + 1}`)
}

function blankAuditUniverse(): Record<AuditKind, Set<string>> {
  return {
    H: new Set<string>(),
    M: new Set<string>(),
    L: new Set<string>(),
    I: new Set<string>(),
  }
}

function blankActiveRiskUniverse(): Record<ActiveRiskKind, Set<string>> {
  return {
    H: new Set<string>(),
    M: new Set<string>(),
    L: new Set<string>(),
    I: new Set<string>(),
    K: new Set<string>(),
  }
}

function markdownTableCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null

  const cells: string[] = []
  let cell = ''
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const char = trimmed[index]
    if (char === '|' && trimmed[index - 1] !== '\\') {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += char
  }
  cells.push(cell.trim())

  if (!cells[0] || /^-+$/.test(cells[0])) return null
  return cells
}

/**
 * H/M/L/I ids are v3-scoped only when they appear as explicit finding headings
 * or as the first cell of a machine-readable audit table row.
 */
function auditFindingIdsByKind(text = readDoc(AUDIT_DOC)): Record<AuditKind, string[]> {
  const ids = blankAuditUniverse()

  for (const match of text.matchAll(/^###\s+([HMLI]\d+)\s+(?:-{1,2}|\u2014)\s+/gm)) {
    const id = match[1]
    ids[id[0] as AuditKind].add(id)
  }

  for (const line of text.split('\n')) {
    const cells = markdownTableCells(line)
    const match = cells?.[0].match(/^([HMLI]\d+)$/)
    if (!match) continue

    const id = match[1]
    ids[id[0] as AuditKind].add(id)
  }

  return {
    H: sortedIds(ids.H),
    M: sortedIds(ids.M),
    L: sortedIds(ids.L),
    I: sortedIds(ids.I),
  }
}

function allAuditIds(universe: Record<AuditKind, string[]>): string[] {
  return sortedIds(Object.values(universe).flat())
}

function activeRiskStatus(value: string): ActiveRiskStatus | null {
  if (value === 'PENDING' || value === 'DONE') return value
  return null
}

function activeRiskRoutingRows(text = readDoc(RISK_DOC)): ActiveRiskRoutingRow[] {
  const rows: ActiveRiskRoutingRow[] = []

  for (const line of text.split('\n')) {
    const cells = markdownTableCells(line)
    const id = cells?.[0]?.match(/^([HMLIK]\d+)$/)?.[1]
    if (!id) continue

    const routingCell = cells[1] ?? ''
    if (routingCell === 'no action') {
      rows.push({
        id,
        routing: 'no-action',
        phase: null,
        targetFix: cells[2] ?? '',
        status: null,
        rawRouting: routingCell,
        rawStatus: cells[3] ?? '',
      })
      continue
    }

    const rawStatus = cells[3] ?? ''
    const phaseMatch = /\[(\d+)\]\(/.exec(routingCell)
    rows.push({
      id,
      routing: 'scheduled',
      phase: phaseMatch ? Number(phaseMatch[1]) : null,
      targetFix: cells[2] ?? '',
      status: activeRiskStatus(rawStatus),
      rawRouting: routingCell,
      rawStatus,
    })
  }

  return rows
}

function activeRiskIdsByKind(rows = activeRiskRoutingRows()): Record<ActiveRiskKind, string[]> {
  const ids = blankActiveRiskUniverse()

  for (const row of rows) {
    ids[row.id[0] as ActiveRiskKind].add(row.id)
  }

  return {
    H: sortedIds(ids.H),
    M: sortedIds(ids.M),
    L: sortedIds(ids.L),
    I: sortedIds(ids.I),
    K: sortedIds(ids.K),
  }
}

function knownOverlapResidualRows(text = readDoc(RISK_DOC)): KnownOverlapResidual[] {
  return activeRiskRoutingRows(text)
    .filter((row) => row.id.startsWith('K') && row.routing === 'scheduled')
    .map((row) => ({
      id: row.id,
      phase: row.rawRouting,
      targetFix: row.targetFix,
      status: row.rawStatus,
    }))
}

function dismissedCandidateIds(text = readDoc(AUDIT_DOC)): string[] {
  const section = sectionOf(text, 'Investigated And Dismissed')
  const numbers = [...section.matchAll(/^(\d+)\.\s+\*\*/gm)].map((match) => Number(match[1]))
  numbers.sort((a, b) => a - b)
  return numbers.map((number) => `R${number}`)
}

function activeRiskDismissedCandidateIds(text = readDoc(RISK_DOC)): string[] {
  const section = sectionOf(text, 'Dismissed Candidates')
  return sortedIds([...section.matchAll(/^- (R\d+) - /gm)].map((match) => match[1]))
}

function v3DocUniverse(
  auditText = readDoc(AUDIT_DOC),
  riskText = readDoc(RISK_DOC),
): Record<V3DocKind, string[]> {
  const auditUniverse = auditFindingIdsByKind(auditText)
  return {
    ...auditUniverse,
    K: knownOverlapResidualRows(riskText).map((row) => row.id),
    R: dismissedCandidateIds(auditText),
  }
}

const EXPECTED_DOC_RANGES: Record<V3DocKind, string[]> = {
  H: rangeIds('H', 1),
  M: rangeIds('M', 9),
  L: rangeIds('L', 56),
  I: rangeIds('I', 23),
  K: rangeIds('K', 4),
  R: rangeIds('R', 5),
}

const EXPECTED_ACTIVE_RISK_RANGES: Record<ActiveRiskKind, string[]> = {
  H: EXPECTED_DOC_RANGES.H,
  M: EXPECTED_DOC_RANGES.M,
  L: EXPECTED_DOC_RANGES.L,
  I: EXPECTED_DOC_RANGES.I,
  K: EXPECTED_DOC_RANGES.K,
}

function collectIdRangeDriftProblems<K extends string>(
  universe: Record<K, string[]>,
  expected: Record<K, string[]>,
  label = 'ids',
): string[] {
  const problems: string[] = []

  for (const kind of Object.keys(expected) as K[]) {
    const actualIds = new Set(universe[kind])
    const expectedIds = new Set(expected[kind])
    const missing = expected[kind].filter((id) => !actualIds.has(id))
    const extra = universe[kind].filter((id) => !expectedIds.has(id))

    if (missing.length > 0) problems.push(`${kind}: missing ${label} ${missing.join(', ')}`)
    if (extra.length > 0) problems.push(`${kind}: unexpected ${label} ${extra.join(', ')}`)
  }

  return problems
}

function collectDocUniverseDriftProblems(
  universe: Record<V3DocKind, string[]> = v3DocUniverse(),
): string[] {
  return collectIdRangeDriftProblems(universe, EXPECTED_DOC_RANGES)
}

function collectActiveRiskUniverseDriftProblems(
  rows: ActiveRiskRoutingRow[] = activeRiskRoutingRows(),
): string[] {
  return collectIdRangeDriftProblems(
    activeRiskIdsByKind(rows),
    EXPECTED_ACTIVE_RISK_RANGES,
    'active-risk ids',
  )
}

function isValidPhase(value: number | null): value is Phase {
  return Number.isInteger(value) && value >= 1 && value <= 8
}

function expectedRegistryStatus(docStatus: ActiveRiskStatus): GateStatus {
  return docStatus === 'PENDING' ? 'PLANNED' : 'DONE'
}

function bucketMap(
  scheduled: readonly ScheduledFix[],
  noActionEntries: readonly RegistryReason[],
): Map<string, RegistryBucket[]> {
  const buckets = new Map<string, RegistryBucket[]>()
  const add = (id: string, bucket: RegistryBucket) => {
    buckets.set(id, [...(buckets.get(id) ?? []), bucket])
  }

  for (const entry of scheduled) add(entry.id, 'scheduled')
  for (const entry of noActionEntries) add(entry.id, 'no-action')

  return buckets
}

function registeredBucketName(id: string, buckets: Map<string, RegistryBucket[]>): string | null {
  const idBuckets = buckets.get(id)
  if (!idBuckets || idBuckets.length === 0) return null
  return [...new Set(idBuckets)].join(', ')
}

function reasonIsSubstantive(reason: string): boolean {
  return reason.trim().length >= 40
}

function hasProofFields(entry: ScheduledFix): boolean {
  return 'testPath' in entry || 'testName' in entry || 'extraTests' in entry
}

function repoRootRelativePath(testPath: string): string | null {
  if (path.isAbsolute(testPath)) return null

  const fullPath = path.resolve(ROOT, testPath)
  const relative = path.relative(ROOT, fullPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null

  return fullPath
}

function collectTestProofProblems(id: string, proof: TestProof): string[] {
  const problems: string[] = []
  if (!proof.testPath) {
    problems.push(`${id}: DONE without a registered testPath`)
  }
  if (!proof.testName) {
    problems.push(`${id}: DONE without a registered testName`)
  }
  if (!proof.testPath || !proof.testName) return problems

  const fullPath = repoRootRelativePath(proof.testPath)
  if (!fullPath) {
    problems.push(`${id}: registered test "${proof.testPath}" must be repo-root-relative`)
    return problems
  }
  if (!existsSync(fullPath)) {
    problems.push(`${id}: registered test "${proof.testPath}" is missing`)
    return problems
  }
  if (!readFileSync(fullPath, 'utf8').includes(proof.testName)) {
    problems.push(`${id}: test "${proof.testPath}" does not contain "${proof.testName}"`)
  }

  return problems
}

function replaceRiskRow(text: string, id: string, replacement: string): string {
  let replaced = false
  const result = text
    .split('\n')
    .map((line) => {
      const cells = markdownTableCells(line)
      if (cells?.[0] !== id) return line

      replaced = true
      return replacement
    })
    .join('\n')

  if (!replaced) throw new Error(`risk row ${id} not found`)
  return result
}

/** Problems that make the v3 routing registry fail. */
export function collectGateProblems(input: GateProblemInput = {}): string[] {
  const scheduled = input.scheduled ?? SCHEDULED_FIXES
  const noActionEntries = input.noAction ?? NO_ACTION
  const auditText = input.auditText ?? readDoc(AUDIT_DOC)
  const riskText = input.riskText ?? readDoc(RISK_DOC)

  const problems: string[] = []
  const auditUniverse = auditFindingIdsByKind(auditText)
  const auditIds = allAuditIds(auditUniverse)
  const dismissedIds = dismissedCandidateIds(auditText)
  const riskDismissedIds = activeRiskDismissedCandidateIds(riskText)
  const routingRows = activeRiskRoutingRows(riskText)
  const riskRowsById = new Map(routingRows.map((row) => [row.id, row]))
  const scheduledRows = routingRows.filter((row) => row.routing === 'scheduled')
  const scheduledRowsById = new Map(scheduledRows.map((row) => [row.id, row]))
  const knownOverlapIds = scheduledRows.filter((row) => row.id.startsWith('K')).map((row) => row.id)
  const classifiedBuckets = bucketMap(scheduled, noActionEntries)
  const scheduledById = new Map(scheduled.map((entry) => [entry.id, entry]))
  const noActionById = new Map(noActionEntries.map((entry) => [entry.id, entry]))

  for (const entry of scheduled) {
    if (!/^[HMLK]\d+$/.test(entry.id)) {
      problems.push(`${entry.id}: scheduled registry id is not a v3 scheduled id`)
    }
    if (!isValidPhase(entry.phase)) {
      problems.push(`${entry.id}: registry phase ${entry.phase} is outside phase 1-8`)
    }
    if (entry.status === 'PLANNED' && hasProofFields(entry)) {
      problems.push(`${entry.id}: PLANNED entries must not claim proof fields`)
    } else if (entry.status === 'DONE') {
      problems.push(...collectTestProofProblems(entry.id, entry))
      for (const proof of entry.extraTests ?? []) {
        problems.push(...collectTestProofProblems(entry.id, proof))
      }
    }
  }

  for (const entry of noActionEntries) {
    if (!/^[IR]\d+$/.test(entry.id)) {
      problems.push(`${entry.id}: registry reason id is not a v3 no-action id`)
    }
    if (!reasonIsSubstantive(entry.reason)) {
      problems.push(`${entry.id}: registry reason is not substantive`)
    }
  }

  for (const [id, buckets] of classifiedBuckets) {
    if (buckets.length > 1) {
      problems.push(`${id}: classified ${buckets.length} times (${buckets.join(', ')})`)
    }
  }

  const classificationUniverse = sortedIds([...auditIds, ...knownOverlapIds, ...dismissedIds])
  for (const id of classificationUniverse) {
    if (!classifiedBuckets.has(id)) {
      problems.push(`${id}: missing classification bucket`)
    }
  }

  for (const id of classifiedBuckets.keys()) {
    const isKnownAuditId = auditIds.includes(id)
    const isKnownKId = knownOverlapIds.includes(id)
    const isDismissedId = dismissedIds.includes(id) || riskDismissedIds.includes(id)
    if (!isKnownAuditId && !isKnownKId && !isDismissedId) {
      problems.push(`${id}: registry id is missing from the v3 docs universe`)
    }
  }

  for (const row of scheduledRows) {
    const entry = scheduledById.get(row.id)
    if (!entry) {
      const bucket = registeredBucketName(row.id, classifiedBuckets)
      if (bucket) {
        problems.push(`${row.id}: doc schedules id but registry classifies it as ${bucket}`)
      } else {
        problems.push(`${row.id}: scheduled in docs but missing from SCHEDULED_FIXES`)
      }
      continue
    }

    if (!isValidPhase(row.phase)) {
      problems.push(`${row.id}: doc phase ${row.phase ?? row.rawRouting} is outside phase 1-8`)
    } else if (entry.phase !== row.phase) {
      problems.push(`${row.id}: phase mismatch (registry ${entry.phase}, docs ${row.phase})`)
    }
    if (entry.fix !== row.targetFix) {
      problems.push(`${row.id}: fix label mismatch vs active-risk-analysis.md`)
    }
    if (!row.status) {
      problems.push(`${row.id}: doc status "${row.rawStatus}" is not PENDING/DONE`)
    } else if (entry.status !== expectedRegistryStatus(row.status)) {
      problems.push(`${row.id}: status mismatch (registry ${entry.status}, docs ${row.status})`)
    }
  }

  for (const entry of scheduled) {
    const row = riskRowsById.get(entry.id)
    if (!row) {
      problems.push(`${entry.id}: SCHEDULED_FIXES entry missing from active-risk docs`)
    } else if (row.routing !== 'scheduled') {
      problems.push(`${entry.id}: registry schedules id but docs route it as ${row.routing}`)
    } else if (!scheduledRowsById.has(entry.id)) {
      problems.push(`${entry.id}: SCHEDULED_FIXES entry missing from scheduled docs`)
    }
  }

  for (const row of routingRows.filter((route) => route.routing === 'no-action')) {
    if (!noActionById.has(row.id)) {
      const bucket = registeredBucketName(row.id, classifiedBuckets)
      if (bucket) {
        problems.push(`${row.id}: doc routes no-action but registry classifies it as ${bucket}`)
      } else {
        problems.push(`${row.id}: no-action in docs but missing from NO_ACTION`)
      }
    }
  }

  for (const id of riskDismissedIds) {
    if (!noActionById.has(id)) {
      const bucket = registeredBucketName(id, classifiedBuckets)
      if (bucket) {
        problems.push(`${id}: dismissed candidate but registry classifies it as ${bucket}`)
      } else {
        problems.push(`${id}: dismissed candidate missing from NO_ACTION`)
      }
    }
  }

  for (const entry of noActionEntries) {
    if (entry.id.startsWith('I')) {
      const row = riskRowsById.get(entry.id)
      if (!row) {
        problems.push(`${entry.id}: NO_ACTION informational entry missing from active-risk docs`)
      } else if (row.routing !== 'no-action') {
        problems.push(`${entry.id}: registry no-action id but docs route it as ${row.routing}`)
      }
    } else if (entry.id.startsWith('R')) {
      if (!dismissedIds.includes(entry.id)) {
        problems.push(`${entry.id}: NO_ACTION dismissed entry missing from audit dismissed list`)
      }
      if (!riskDismissedIds.includes(entry.id)) {
        problems.push(`${entry.id}: NO_ACTION dismissed entry missing from active-risk docs`)
      }
    }
  }

  return problems
}

describe('v3 fix-completeness gate doc universe', () => {
  it('points at the archived v3 closeout sources', () => {
    expect(AUDIT_DOC).toContain(
      path.join(
        '.archived-docs',
        'audit-stability-and-performance-v3',
        'audit-stability-and-performance-v3.md',
      ),
    )
    expect(RISK_DOC).toContain(
      path.join('.archived-docs', 'audit-stability-and-performance-v3', 'active-risk-analysis.md'),
    )
    expect(AUDIT_DOC).not.toContain(path.join('docs', 'plan'))
    expect(RISK_DOC).not.toContain(path.join('docs', 'plan'))
    expect(existsSync(AUDIT_DOC)).toBe(true)
    expect(existsSync(RISK_DOC)).toBe(true)
  })

  it('parses the exact H/M/L/I/K/R counts and sorted ranges', () => {
    const universe = v3DocUniverse()

    expect(universe.H).toHaveLength(1)
    expect(universe.H).toEqual(rangeIds('H', 1))

    expect(universe.M).toHaveLength(9)
    expect(universe.M).toEqual(rangeIds('M', 9))

    expect(universe.L).toHaveLength(56)
    expect(universe.L).toEqual(rangeIds('L', 56))

    expect(universe.I).toHaveLength(23)
    expect(universe.I).toEqual(rangeIds('I', 23))

    expect(universe.K).toHaveLength(4)
    expect(universe.K).toEqual(rangeIds('K', 4))

    expect(universe.R).toHaveLength(5)
    expect(universe.R).toEqual(rangeIds('R', 5))

    expect(collectDocUniverseDriftProblems(universe)).toEqual([])
  })

  it('parses active-risk routing rows for H/M/L/I/K and scheduled status markers', () => {
    const rows = activeRiskRoutingRows()
    const scheduledRows = rows.filter((row) => row.routing === 'scheduled')
    const noActionRows = rows.filter((row) => row.routing === 'no-action')

    expect(activeRiskIdsByKind(rows)).toEqual(EXPECTED_ACTIVE_RISK_RANGES)
    expect(scheduledRows.map((row) => row.id)).toEqual([
      ...rangeIds('H', 1),
      ...rangeIds('M', 9),
      ...rangeIds('L', 56),
      ...rangeIds('K', 4),
    ])
    expect(scheduledRows.map((row) => row.status)).toEqual(
      SCHEDULED_FIXES.map((entry) => (entry.status === 'DONE' ? 'DONE' : 'PENDING')),
    )
    expect(noActionRows.map((row) => row.id)).toEqual(rangeIds('I', 23))
    expect(collectActiveRiskUniverseDriftProblems(rows)).toEqual([])
  })

  it('recognizes a fake new scheduled active-risk id as doc drift', () => {
    const riskText = `${readDoc(RISK_DOC)}
| M10 | [2](phases/phase-2-command-surface-scoping.md) | fake drift | PENDING |
`
    const rows = activeRiskRoutingRows(riskText)

    expect(rows.find((row) => row.id === 'M10')?.status).toBe('PENDING')
    expect(collectActiveRiskUniverseDriftProblems(rows)).toEqual([
      'M: unexpected active-risk ids M10',
    ])
  })

  it('accepts heading separators and table rows without mining prior-audit prose', () => {
    const auditText = `
### H1 - high separator
Mentions v2-L12 and v1-L4 in prose only.
### M1 -- double hyphen separator
| L1 | Low | perf | server | table row |
### I1 \u2014 em dash separator
| Known item | v2-L16 | Low | overlap evidence |
`
    const universe = auditFindingIdsByKind(auditText)

    expect(universe).toEqual({
      H: ['H1'],
      M: ['M1'],
      L: ['L1'],
      I: ['I1'],
    })
    expect(allAuditIds(universe)).not.toContain('L12')
    expect(allAuditIds(universe)).not.toContain('L4')
    expect(allAuditIds(universe)).not.toContain('L16')
  })

  it('collects K residuals from active-risk and treats audit overlaps as evidence', () => {
    const rows = knownOverlapResidualRows()
    const overlapEvidenceUniverse = auditFindingIdsByKind(
      sectionOf(readDoc(AUDIT_DOC), 'Known-Item Overlaps'),
    )

    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.id)).toEqual(rangeIds('K', 4))
    expect(rows.map((row) => row.status)).toEqual(['DONE', 'DONE', 'DONE', 'DONE'])
    expect(rows[0].targetFix).toContain('v2-R5 re-open')
    expect(allAuditIds(overlapEvidenceUniverse)).toEqual([])
  })

  it('parses dismissed candidates from both current v3 doc sources', () => {
    expect(dismissedCandidateIds()).toEqual(rangeIds('R', 5))
    expect(activeRiskDismissedCandidateIds()).toEqual(rangeIds('R', 5))
  })
})

describe('v3 fix-completeness gate routing registry', () => {
  it('parses active-risk routing and status rows for H/M/L/I/K', () => {
    const rows = activeRiskRoutingRows()
    const scheduledRows = rows.filter((row) => row.routing === 'scheduled')
    const noActionRows = rows.filter((row) => row.routing === 'no-action')

    expect(scheduledRows.map((row) => row.id)).toEqual(SCHEDULED_FIXES.map((entry) => entry.id))
    expect(scheduledRows.map((row) => row.status)).toEqual(
      SCHEDULED_FIXES.map((entry) => (entry.status === 'DONE' ? 'DONE' : 'PENDING')),
    )
    expect(noActionRows.map((row) => row.id)).toEqual(rangeIds('I', 23))
  })

  it('classifies every v3 audit, K residual, and dismissed id exactly once', () => {
    expect(collectGateProblems()).toEqual([])
  })

  it('keeps the registry buckets on the Phase 0 target sets', () => {
    const scheduledIds = SCHEDULED_FIXES.map((entry) => entry.id)
    const noActionIds = NO_ACTION.map((entry) => entry.id)

    expect(scheduledIds).toEqual([
      ...rangeIds('H', 1),
      ...rangeIds('M', 9),
      ...rangeIds('L', 56),
      ...rangeIds('K', 4),
    ])
    expect(noActionIds.filter((id) => id.startsWith('I'))).toEqual(rangeIds('I', 23))
    expect(noActionIds.filter((id) => id.startsWith('R'))).toEqual(rangeIds('R', 5))
  })

  it('keeps PLANNED entries proof-free and DONE entries registered', () => {
    const plannedEntryKeys = ['fix', 'id', 'phase', 'status']
    const plannedEntries = SCHEDULED_FIXES.filter((entry) => entry.status === 'PLANNED')
    const doneEntries = SCHEDULED_FIXES.filter((entry) => entry.status === 'DONE')

    expect(doneEntries.map((entry) => entry.id)).toEqual([
      'H1',
      'M1',
      'M2',
      'M3',
      'M4',
      'M5',
      'M6',
      'M7',
      'M8',
      'M9',
      'L1',
      'L2',
      'L3',
      'L4',
      'L5',
      'L6',
      'L7',
      'L8',
      'L9',
      'L10',
      'L11',
      'L12',
      'L13',
      'L14',
      'L15',
      'L16',
      'L17',
      'L18',
      'L19',
      'L20',
      'L21',
      'L22',
      'L23',
      'L24',
      'L25',
      'L26',
      'L27',
      'L28',
      'L29',
      'L30',
      'L31',
      'L32',
      'L33',
      'L34',
      'L35',
      'L36',
      'L37',
      'L38',
      'L39',
      'L40',
      'L41',
      'L42',
      'L43',
      'L44',
      'L45',
      'L46',
      'L47',
      'L48',
      'L49',
      'L50',
      'L51',
      'L52',
      'L53',
      'L54',
      'L55',
      'L56',
      'K1',
      'K2',
      'K3',
      'K4',
    ])
    expect(plannedEntries).toEqual([])
    expect(plannedEntries.filter(hasProofFields)).toEqual([])
    expect(doneEntries.every(hasProofFields)).toBe(true)
    for (const entry of plannedEntries) {
      expect(Object.keys(entry).sort()).toEqual(plannedEntryKeys)
    }
  })

  it('keeps the live registry green with every scheduled v3 id marked DONE', () => {
    expect(SCHEDULED_FIXES).toHaveLength(70)
    expect(
      SCHEDULED_FIXES.filter((entry) => entry.status === 'DONE').map((entry) => entry.id),
    ).toEqual([
      'H1',
      'M1',
      'M2',
      'M3',
      'M4',
      'M5',
      'M6',
      'M7',
      'M8',
      'M9',
      'L1',
      'L2',
      'L3',
      'L4',
      'L5',
      'L6',
      'L7',
      'L8',
      'L9',
      'L10',
      'L11',
      'L12',
      'L13',
      'L14',
      'L15',
      'L16',
      'L17',
      'L18',
      'L19',
      'L20',
      'L21',
      'L22',
      'L23',
      'L24',
      'L25',
      'L26',
      'L27',
      'L28',
      'L29',
      'L30',
      'L31',
      'L32',
      'L33',
      'L34',
      'L35',
      'L36',
      'L37',
      'L38',
      'L39',
      'L40',
      'L41',
      'L42',
      'L43',
      'L44',
      'L45',
      'L46',
      'L47',
      'L48',
      'L49',
      'L50',
      'L51',
      'L52',
      'L53',
      'L54',
      'L55',
      'L56',
      'K1',
      'K2',
      'K3',
      'K4',
    ])
    expect(collectGateProblems()).toEqual([])
  })

  it('records Phase 5 guard-repair bounded inventory dispositions', () => {
    expect(GUARD_REPAIR_INVENTORY_PROOF.map((entry) => entry.surface)).toEqual(
      REQUIRED_GUARD_REPAIR_INVENTORY_SURFACES,
    )
    expect(new Set(GUARD_REPAIR_INVENTORY_PROOF.map((entry) => entry.surface)).size).toBe(
      REQUIRED_GUARD_REPAIR_INVENTORY_SURFACES.length,
    )
    for (const entry of GUARD_REPAIR_INVENTORY_PROOF) {
      expect(['fixed', 'no-action', 'deferred']).toContain(entry.disposition)
      expect(reasonIsSubstantive(entry.proof)).toBe(true)
    }

    const proofText = GUARD_REPAIR_INVENTORY_PROOF.map((entry) => entry.proof).join('\n')
    expect(proofText).toContain('trusted projection writes')
    expect(proofText).toContain('getDatabase({ snapshot: true })')
    expect(proofText).toContain('scoped current-chat message commands')
    expect(proofText).toContain('display-only semantics')
    expect(proofText).toContain('checkHandshake failures per client/tool set')
  })

  it('records Phase 8 media cleanup inventory and rider dispositions', () => {
    expect(MEDIA_CLEANUP_INVENTORY_PROOF.map((entry) => entry.surface)).toEqual(
      REQUIRED_MEDIA_CLEANUP_INVENTORY_SURFACES,
    )
    expect(new Set(MEDIA_CLEANUP_INVENTORY_PROOF.map((entry) => entry.surface)).size).toBe(
      REQUIRED_MEDIA_CLEANUP_INVENTORY_SURFACES.length,
    )
    for (const entry of MEDIA_CLEANUP_INVENTORY_PROOF) {
      expect(['fixed', 'no-action', 'deferred']).toContain(entry.disposition)
      expect(reasonIsSubstantive(entry.proof)).toBe(true)
    }

    const proofText = MEDIA_CLEANUP_INVENTORY_PROOF.map((entry) => entry.proof).join('\n')
    expect(proofText).toContain('I16')
    expect(proofText).toContain('I17')
    expect(proofText).toContain('v4-L31')
    expect(proofText).toContain('v4-L36')
    expect(proofText).toContain('finally')
  })

  it('records legacy gated and owner-decision context only as explanatory context', () => {
    const registeredIds = [
      ...SCHEDULED_FIXES.map((entry) => entry.id),
      ...NO_ACTION.map((entry) => entry.id),
    ]
    const contextText = GATED_CONTEXT_REASONS.map((entry) => entry.reason).join('\n')

    expect(registeredIds).not.toContain('v2-L12')
    expect(registeredIds).not.toContain('v1-L4')
    expect(registeredIds).not.toContain('../leftover.md')
    expect(contextText).toContain('v2-L12')
    expect(contextText).toContain('v1-L4')
    expect(contextText).toContain('../leftover.md')
  })

  it('rejects PLANNED registry entries that claim proof fields', () => {
    const l50 = SCHEDULED_FIXES.find((entry) => entry.id === 'L50')
    if (!l50) throw new Error('L50 registry entry not found')
    const pendingRiskText = replaceRiskRow(
      readDoc(RISK_DOC),
      'L50',
      `| L50 | [8](phases/phase-8-client-interpreters-plugins-media.md) | ${l50.fix} | PENDING |`,
    )
    const withPrematureProof = SCHEDULED_FIXES.map((entry) =>
      entry.id === 'L50'
        ? {
            ...entry,
            status: 'PLANNED' as const,
            testPath: 'src/ts/__tests__/fixCompletenessGateV3.test.ts',
            testName: 'premature v3 proof',
          }
        : entry,
    )

    expect(collectGateProblems({ scheduled: withPrematureProof, riskText: pendingRiskText })).toContain(
      'L50: PLANNED entries must not claim proof fields',
    )
  })

  it('rejects doc DONE rows that do not have matching registry proof', () => {
    const l50 = SCHEDULED_FIXES.find((entry) => entry.id === 'L50')
    if (!l50) throw new Error('L50 registry entry not found')

    const withPlannedRegistry = SCHEDULED_FIXES.map((entry) =>
      entry.id === 'L50'
        ? {
            id: entry.id,
            phase: entry.phase,
            fix: entry.fix,
            status: 'PLANNED' as const,
          }
        : entry,
    )

    expect(collectGateProblems({ scheduled: withPlannedRegistry })).toContain(
      'L50: status mismatch (registry PLANNED, docs DONE)',
    )
  })

  it('rejects DONE registry entries without a registered test path and test name', () => {
    const l50 = SCHEDULED_FIXES.find((entry) => entry.id === 'L50')
    if (!l50) throw new Error('L50 registry entry not found')
    const syntheticDone = SCHEDULED_FIXES.map((entry) =>
      entry.id === 'L50'
        ? {
            id: entry.id,
            phase: entry.phase,
            fix: entry.fix,
            status: 'DONE' as const,
          }
        : entry,
    )

    expect(collectGateProblems({ scheduled: syntheticDone })).toEqual(
      expect.arrayContaining([
        'L50: DONE without a registered testPath',
        'L50: DONE without a registered testName',
      ]),
    )
  })

  it('validates primary and extra DONE test proofs against existing repo files', () => {
    const m1 = SCHEDULED_FIXES.find((entry) => entry.id === 'M1')
    if (!m1) throw new Error('M1 registry entry not found')
    const riskText = replaceRiskRow(
      readDoc(RISK_DOC),
      'M1',
      `| M1 | [2](phases/phase-2-command-surface-scoping.md) | ${m1.fix} | DONE |`,
    )
    const missingPrimaryTestPath = 'src/ts/__tests__/__missing_v3_done_proof__.test.ts'
    const missingPrimaryPathRegistry = SCHEDULED_FIXES.map((entry) =>
      entry.id === 'M1'
        ? {
            ...entry,
            status: 'DONE' as const,
            testPath: missingPrimaryTestPath,
            testName: 'synthetic v3 proof',
          }
        : entry,
    )
    const missingExtraTestName = ['missing v3 extra proof title', 'assembled at runtime'].join(' ')
    const missingExtraNameRegistry = SCHEDULED_FIXES.map((entry) =>
      entry.id === 'M1'
        ? {
            ...entry,
            status: 'DONE' as const,
            testPath: 'src/ts/__tests__/fixCompletenessGateV3.test.ts',
            testName: 'validates primary and extra DONE test proofs against existing repo files',
            extraTests: [
              {
                testPath: 'src/ts/__tests__/fixCompletenessGateV3.test.ts',
                testName: missingExtraTestName,
              },
            ],
          }
        : entry,
    )

    expect(collectGateProblems({ scheduled: missingPrimaryPathRegistry, riskText })).toEqual(
      expect.arrayContaining([`M1: registered test "${missingPrimaryTestPath}" is missing`]),
    )
    expect(collectGateProblems({ scheduled: missingExtraNameRegistry, riskText })).toEqual(
      expect.arrayContaining([
        `M1: test "src/ts/__tests__/fixCompletenessGateV3.test.ts" does not contain "${missingExtraTestName}"`,
      ]),
    )
  })

  it('rejects DONE registry entries when the primary test name is absent', () => {
    const m1 = SCHEDULED_FIXES.find((entry) => entry.id === 'M1')
    if (!m1) throw new Error('M1 registry entry not found')
    const riskText = replaceRiskRow(
      readDoc(RISK_DOC),
      'M1',
      `| M1 | [2](phases/phase-2-command-surface-scoping.md) | ${m1.fix} | DONE |`,
    )
    const missingTestName = ['missing v3 primary proof title', 'assembled at runtime'].join(' ')
    const syntheticDone = SCHEDULED_FIXES.map((entry) =>
      entry.id === 'M1'
        ? {
            ...entry,
            status: 'DONE' as const,
            testPath: 'src/ts/__tests__/fixCompletenessGateV3.test.ts',
            testName: missingTestName,
          }
        : entry,
    )

    expect(collectGateProblems({ scheduled: syntheticDone, riskText })).toContain(
      `M1: test "src/ts/__tests__/fixCompletenessGateV3.test.ts" does not contain "${missingTestName}"`,
    )
  })

  it('self-proves fake audit and routing row detection through doc overrides', () => {
    const auditText = `${readDoc(AUDIT_DOC)}\n| M10 | Med | perf | server | fake drift |\n`
    const riskText = `${readDoc(RISK_DOC)}\n| M10 | [2](phases/phase-2-command-surface-scoping.md) | Synthetic drift row. | PENDING |\n`

    expect(collectGateProblems({ auditText, riskText })).toEqual(
      expect.arrayContaining([
        'M10: scheduled in docs but missing from SCHEDULED_FIXES',
        'M10: missing classification bucket',
      ]),
    )
  })

  it('self-proves removed scheduled row detection against an in-memory active-risk doc', () => {
    const riskText = readDoc(RISK_DOC)
      .split('\n')
      .filter((line) => markdownTableCells(line)?.[0] !== 'H1')
      .join('\n')

    expect(collectGateProblems({ riskText })).toContain(
      'H1: SCHEDULED_FIXES entry missing from active-risk docs',
    )
  })

  it('self-proves phase mismatch detection against an in-memory active-risk doc', () => {
    const h1 = SCHEDULED_FIXES.find((entry) => entry.id === 'H1')
    if (!h1) throw new Error('H1 registry entry not found')

    const withWrongPhase = replaceRiskRow(
      readDoc(RISK_DOC),
      'H1',
      `| H1 | [2](phases/phase-2-command-surface-scoping.md) | ${h1.fix} | PENDING |`,
    )

    expect(collectGateProblems({ riskText: withWrongPhase })).toContain(
      'H1: phase mismatch (registry 1, docs 2)',
    )
  })

  it('self-proves informational scheduled-conflict detection', () => {
    const withScheduledInformational = replaceRiskRow(
      readDoc(RISK_DOC),
      'I1',
      '| I1 | [1](phases/phase-1-high-and-send-path.md) | Synthetic scheduled informational conflict. | PENDING |',
    )

    expect(collectGateProblems({ riskText: withScheduledInformational })).toContain(
      'I1: doc schedules id but registry classifies it as no-action',
    )
  })

  it('self-proves duplicate and missing classification detection', () => {
    const duplicateH1 = [
      ...NO_ACTION,
      noAction('H1', 'Duplicate self-proof classification reason for scheduled H1.'),
    ]
    const missingM1 = SCHEDULED_FIXES.filter((entry) => entry.id !== 'M1')

    expect(collectGateProblems({ noAction: duplicateH1 })).toContain(
      'H1: classified 2 times (scheduled, no-action)',
    )
    expect(collectGateProblems({ scheduled: missingM1 })).toEqual(
      expect.arrayContaining([
        'M1: missing classification bucket',
        'M1: scheduled in docs but missing from SCHEDULED_FIXES',
      ]),
    )
  })

  it('self-proves unregistered registry id detection', () => {
    const withUnregisteredId = [
      ...SCHEDULED_FIXES,
      planned('M10', 2, 'Synthetic unregistered registry drift.'),
    ]

    expect(collectGateProblems({ scheduled: withUnregisteredId })).toEqual(
      expect.arrayContaining([
        'M10: registry id is missing from the v3 docs universe',
        'M10: SCHEDULED_FIXES entry missing from active-risk docs',
      ]),
    )
  })
})
