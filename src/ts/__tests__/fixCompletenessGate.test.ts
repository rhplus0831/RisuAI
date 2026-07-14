import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Static gate that keeps registered audit fixes paired with regression proofs.
 *
 * `SCHEDULED_FIXES` registers each finding id and its expected proof files.
 * `INTENTIONALLY_GATED` and `NO_ACTION` record explicitly excluded ids. The
 * self-checks fail when a finding is missing, double-classified, or points at a
 * missing or renamed test.
 */

// `vitest run` executes from the repo root (the package.json directory), so
// docs and both test trees hang off `process.cwd()`. (import.meta.url is not a
// file: URL under the client vite test transform, so it cannot anchor reads.)
const ROOT = process.cwd()
const ARCHIVED_PLAN = '.archived-docs/audit-stability-and-performance'
const AUDIT_DOC = path.join(ROOT, ARCHIVED_PLAN, 'audit-stability-and-performance.md')
const RISK_DOC = path.join(ROOT, ARCHIVED_PLAN, 'active-risk-analysis.md')

type GateStatus = 'PLANNED' | 'DONE'

interface ScheduledFix {
  /** Audit finding id (`H*`, `M*`, `L*`, `U*`). */
  id: string
  /** Routing bucket for this finding. */
  phase: 1 | 2 | 3 | 4 | 5 | 6 | 7
  /** Short target-fix label (mirrors active-risk-analysis.md). */
  fix: string
  status: GateStatus
  /** Repo-root-relative regression test path for completed fixes. */
  testPath?: string
  /** A string the registered test must contain (helper or test title). */
  testName?: string
  /** Additional regression proofs for fixes whose coverage spans more than one
   *  test (for example deadline + body-cap halves). Validated like the primary. */
  extraTests?: Array<{ testPath: string; testName: string }>
}

const SCHEDULED_FIXES: ScheduledFix[] = [
  // High-priority findings
  {
    id: 'H1',
    phase: 1,
    fix: 'loadChatHydration guard on message.length > 0',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
    testName: 'H1 guard: hydration of a chat WITHOUT a chat_hypa_v3 row stays scoped',
  },
  {
    id: 'H2',
    phase: 1,
    fix: 'Scalar ChatSelectionSnapshot for changeChatTo',
    status: 'DONE',
    testPath: 'src/ts/globalApi.changeChatTo.test.ts',
    testName: 'switches chatPage by index without cloning the characters array',
  },
  {
    id: 'H3',
    phase: 1,
    fix: 'Coalesce token-driven renders; final flush on done',
    status: 'DONE',
    testPath: 'src/ts/process/__tests__/streamResponse.test.ts',
    testName: 'bounds parse work for an N-token stream: applies are O(flushes), not O(N)',
  },
  // Medium
  {
    id: 'M1',
    phase: 2,
    fix: 'Scoped target-chat message/hypa load',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
    testName: 'M1: prompt assembly performs zero whole-corpus message/hypa payload reads',
  },
  {
    id: 'M2',
    phase: 7,
    fix: 'Hoist module/script/RegExp work once per assembly',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/scripts.test.ts',
    testName: 'M2: a simulated history window compiles each script regex once, not once per message',
    extraTests: [
      {
        testPath: 'server/fastify/__tests__/scripts.test.ts',
        testName: 'M2: cbs-action scripts still compile per message',
      },
    ],
  },
  {
    id: 'M3',
    phase: 2,
    fix: 'Field-scoped command reads or per-request load memo',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/commandMutationReadNarrowing.test.ts',
    testName: 'M3/L5/L6: a scriptstate PATCH performs zero whole-corpus payload reads',
  },
  {
    id: 'M4',
    phase: 2,
    fix: 'Single-row loadSingleCharacterRow; in-place mask where owned',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
    testName: 'M4: the targeted character read performs zero whole-corpus payload reads',
  },
  {
    id: 'M5',
    phase: 2,
    fix: 'Defer jsonPayloadBytes until metrics are enabled',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
    testName: 'M5: resource and bootstrap responses add metric serialization only when enabled',
  },
  {
    id: 'M6',
    phase: 4,
    fix: 'Abort proxy /fetch upstream on close; timeout backstop',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/proxy.test.ts',
    testName: 'M6: a client disconnect mid-fetch aborts the upstream request',
  },
  {
    id: 'M7',
    phase: 6,
    fix: 'Cap embed batches; split contextual requests by token size',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/memoryEmbedJobHandler.test.ts',
    testName: 'M7: slices a contextual batch into token-aware sub-batches with per-sub-batch group ids',
    extraTests: [
      {
        testPath: 'server/fastify/__tests__/memoryEmbedJobHandler.test.ts',
        testName: 'M7: a failing contextual sub-batch is committed independently and does not fail unrelated chunks',
      },
      {
        testPath: 'server/fastify/__tests__/memoryEmbedJobHandler.test.ts',
        testName: 'M7: caps the drained embed batch at MEMORY_JOB_BATCH_MAX_JOBS per tick',
      },
    ],
  },
  {
    id: 'M8',
    phase: 4,
    fix: 'Non-durable provider deadline and body cap',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/requestAbort.test.ts',
    testName: 'M8: the signal aborts once the deadline elapses, with no client disconnect',
    extraTests: [
      {
        testPath: 'server/fastify/__tests__/generationBodyCap.test.ts',
        testName: 'M8: a non-streaming adapter fails closed on an over-cap upstream body',
      },
    ],
  },
  {
    id: 'M9',
    phase: 5,
    fix: 'Streaming bounded inflate per envelope/block',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/risuSaveBoundedInflate.test.ts',
    testName: 'aborts an oversized inflate at the cap instead of materializing the payload',
    extraTests: [
      {
        testPath: 'server/fastify/__tests__/risuSaveBundleImportRoute.test.ts',
        testName: 'caps the expanded size of the embedded database.risu even when the bundle import is unlimited (M9)',
      },
    ],
  },
  {
    id: 'M10',
    phase: 5,
    fix: 'Token-only asset scan; defer import asset report',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/assetGc.test.ts',
    testName: 'never hydrates the message corpus during a sweep (M10)',
    extraTests: [
      {
        testPath: 'server/fastify/__tests__/assetGc.test.ts',
        testName: 'reports identical referenced/missing/orphaned sets to the hydrated walker (M10)',
      },
    ],
  },
  {
    id: 'M11',
    phase: 5,
    fix: 'Settle bundle-export drain wait on close/error',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/risuSaveBundleExportRoute.test.ts',
    testName: 'terminates the entry loop and destroys the in-flight asset read stream on premature close',
  },
  {
    id: 'M12',
    phase: 3,
    fix: 'Drop redundant setDatabase(db) in /setvar and /addvar',
    status: 'DONE',
    testPath: 'src/ts/process/__tests__/command.resourceGuard.test.ts',
    testName: 'M12: /setvar persists scriptstate without re-running the setDatabase normalizer',
  },
  {
    id: 'M13',
    phase: 3,
    fix: 'Clone only kept character fields',
    status: 'DONE',
    testPath: 'src/ts/characterCommands.test.ts',
    testName: 'M13: changedCharacterFields diffs without cloning the chats payload',
  },
  {
    id: 'M14',
    phase: 3,
    fix: 'Use currentCharacterRowSnapshot in send context',
    status: 'DONE',
    testPath: 'src/ts/process/__tests__/sendChatContext.test.ts',
    testName: 'M14: the send-context rollback captures one character row, never the whole corpus',
  },
  // Low-priority scheduled findings
  {
    id: 'L1',
    phase: 2,
    fix: 'Memoize getActiveModules per assembly',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/modulesMemo.test.ts',
    testName: 'returns the same resolved array for repeat calls with identical inputs',
  },
  {
    id: 'L2',
    phase: 2,
    fix: 'Hoist invariant run-var expansion',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/assemble.test.ts',
    testName: 'keeps marker-free rows byte-identical while marker rows still expand',
  },
  {
    id: 'L3',
    phase: 7,
    fix: 'Hoist/compile lorebook keyword regexes',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/lorebook.test.ts',
    testName: 'L3: compiles each regex key once across messages, recursive passes, and entries',
  },
  {
    id: 'L5',
    phase: 2,
    fix: 'Skip asset scan when mutation does not read assets',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/commandMutationReadNarrowing.test.ts',
    testName: 'the full message lifecycle stays scoped',
  },
  {
    id: 'L6',
    phase: 2,
    fix: 'Narrow message-only character/chat lookup',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/commandMutationReadNarrowing.test.ts',
    testName: 'returns identical rows to the broad loader for both chat-id and message-id targets',
  },
  {
    id: 'L8',
    phase: 7,
    fix: 'Replace OFFSET 999 prune walk with bounded delete',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/events.test.ts',
    testName: 'L8: prunes by revision keep-window with a bounded range delete, not an OFFSET walk',
  },
  {
    id: 'L9',
    phase: 7,
    fix: 'Drop redundant chats DELETE',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/repositoryWriterKit.test.ts',
    testName: 'L9: deleteCharacterRow alone cascades the chats rows via the FK',
  },
  {
    id: 'L10',
    phase: 2,
    fix: 'Load command-event history only when replay is requested',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
    testName: 'L10: a fresh (no-replay) SSE connect performs zero command-event history reads',
  },
  {
    id: 'L11',
    phase: 5,
    fix: 'cleanedUp guard before memoryEvents.subscribe',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/events.test.ts',
    testName: 'never arms the heartbeat or memory subscription after a mid-handler teardown (L11)',
  },
  {
    id: 'L12',
    phase: 5,
    fix: 'Close proxy WS viewer on already-done jobs',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/streamJobsRoutes.test.ts',
    testName: 'closes a viewer that attaches to an already-done job instead of pinning it (L12)',
  },
  {
    id: 'L13',
    phase: 5,
    fix: 'Guard detached runners and cancel-persist on close',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/durableGeneration.test.ts',
    testName: 'settles detached runners before closing the database on shutdown (L13)',
  },
  {
    id: 'L14',
    phase: 5,
    fix: 'Heartbeat durable SSE viewer during long assembly',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/durableGeneration.test.ts',
    testName: 'heartbeats the durable SSE viewer during silent windows (L14)',
  },
  {
    id: 'L15',
    phase: 5,
    fix: 'Bound no-viewer proxy-job replay/buffer',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/streamJobs.test.ts',
    testName: 'stops consuming the upstream once the no-viewer buffer overflows (L15)',
  },
  {
    id: 'L16',
    phase: 6,
    fix: 'Skip empty orphan-cleanup write txn',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/memoryRepository.test.ts',
    testName: 'opens no write transaction when summaries exist but none are orphaned (L16)',
    extraTests: [
      {
        testPath: 'server/fastify/__tests__/memoryRepository.test.ts',
        testName: 'opens no write transaction when the chat has no summaries at all (L16)',
      },
    ],
  },
  {
    id: 'L17',
    phase: 6,
    fix: 'Bound per-chat memory batches for fairness',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/memoryWorker.test.ts',
    testName: "L17: round-robins claims across chats so one chat's backlog cannot starve another",
    extraTests: [
      {
        testPath: 'server/fastify/__tests__/memoryWorker.test.ts',
        testName: "L17: one chat's batch is bounded to a single tick and the other chat is served next",
      },
    ],
  },
  {
    id: 'L18',
    phase: 6,
    fix: 'Reuse the Phase 2 scoped/memoized loader in memory batches',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/memoryEmbedJobHandler.test.ts',
    testName: 'L18: the default loader performs zero whole-corpus payload reads per batch',
    extraTests: [
      {
        testPath: 'server/fastify/__tests__/memorySummarizeJobHandler.test.ts',
        testName: 'L18: the default loader performs zero whole-corpus payload reads per batch',
      },
      {
        testPath: 'server/fastify/__tests__/memorySummarizeJobHandler.test.ts',
        testName: 'L18: an unknown chat fails with the same chat-not-found error through the scoped loader',
      },
    ],
  },
  {
    id: 'L19',
    phase: 6,
    fix: 'Aggregate Lua exec budget across hook phases',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/luaRuntime.test.ts',
    testName: 'L19: runaway hooks across a trigger loop are bounded by the aggregate budget, not per-run limits',
    extraTests: [
      {
        testPath: 'server/fastify/__tests__/luaRuntime.test.ts',
        testName: 'L19: an exhausted aggregate budget short-circuits before booting an engine',
      },
    ],
  },
  {
    id: 'L20',
    phase: 4,
    fix: 'Thread request AbortSignal into the Lua runtime',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/luaRuntime.test.ts',
    testName: 'L20: aborting mid-dispatch cancels in-flight hook work well before the exec limit',
    extraTests: [
      {
        testPath: 'server/fastify/__tests__/luaRuntime.test.ts',
        testName: 'L20: aborting while a Lua request() egress fetch is in flight cancels the run promptly',
      },
    ],
  },
  {
    id: 'L21',
    phase: 6,
    fix: 'Reuse engine safely or cache compiled prelude',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/luaRuntime.test.ts',
    testName: 'L21: a default-limit run serves from the warm pool without a hot-path boot, output identical',
    extraTests: [
      {
        testPath: 'server/fastify/__tests__/luaRuntime.test.ts',
        testName: 'L21: pooled engines never leak Lua globals between runs (per-call isolation preserved)',
      },
      {
        testPath: 'server/fastify/__tests__/luaRuntime.test.ts',
        testName: 'L21: a fresh boot never overlaps an active run with a pending Lua continuation',
      },
    ],
  },
  {
    id: 'L22',
    phase: 4,
    fix: 'Cap streaming-provider SSE accumulation buffer',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/openai.test.ts',
    testName: 'L22: bounds the accumulation buffer when upstream never sends an event delimiter',
    extraTests: [
      {
        testPath: 'server/fastify/__tests__/anthropic.test.ts',
        testName: 'L22: bounds the accumulation buffer when upstream never sends an event delimiter',
      },
      {
        testPath: 'server/fastify/__tests__/mistral.test.ts',
        testName: 'L22: bounds the accumulation buffer when upstream never sends an event delimiter',
      },
      {
        testPath: 'server/fastify/__tests__/gemini.test.ts',
        testName: 'L22: bounds the accumulation buffer when upstream never sends an event delimiter',
      },
      {
        testPath: 'server/fastify/__tests__/ollama.test.ts',
        testName: 'L22: bounds the line buffer when upstream never sends a newline',
      },
    ],
  },
  {
    id: 'L23',
    phase: 4,
    fix: 'Block embedded-private IPv6 forms',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/luaRuntime.test.ts',
    testName: 'L23: blocks embedded-private IPv6 transition forms (mapped-hex / compatible / 6to4 / NAT64)',
  },
  {
    id: 'L24',
    phase: 4,
    fix: 'Reject prototype keys in setObjectValue',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/additionalParams.test.ts',
    testName: 'L24: setObjectValue cannot pollute Object.prototype via dotted prototype keys',
  },
  {
    id: 'L25',
    phase: 4,
    fix: 'Count Lua egress only after URL validation',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/luaRuntime.test.ts',
    testName: 'L25: a blocked URL does not consume the egress budget',
  },
  {
    id: 'L27',
    phase: 5,
    fix: 'Guard backup manifest JSON.parse',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/backups.test.ts',
    testName: 'skips a corrupt manifest instead of failing the whole backups list (L27)',
  },
  {
    id: 'L28',
    phase: 5,
    fix: 'Make legacy restore re-import transactional',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/backups.test.ts',
    testName: 'rolls a failed legacy db.json re-import back atomically, with no restore event (L28)',
  },
  {
    id: 'L29',
    phase: 5,
    fix: 'Persist writer-session origin on command events',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/events.test.ts',
    testName: 'replays the writer-session origin so reconnect keeps own-echo suppression (L29)',
  },
  {
    id: 'L30',
    phase: 5,
    fix: 'Re-arm reattach after completion',
    status: 'DONE',
    testPath: 'src/ts/process/__tests__/reattach.test.ts',
    testName: 're-arms and reattaches a second live-job chat after the first completes (L30)',
  },
  {
    id: 'L31',
    phase: 3,
    fix: 'Scope/throttle script-definition watcher scans',
    status: 'DONE',
    testPath: 'src/ts/server/scriptDefinitionBridge.svelte.test.ts',
    testName: 'L31: a character-scoped fire never stringifies the sibling scripts (clone cost stays scoped)',
  },
  {
    id: 'L32',
    phase: 3,
    fix: 'Scope lorebook-editor clone/id-assign',
    status: 'DONE',
    testPath: 'src/ts/server/lorebookBridge.svelte.test.ts',
    testName: 'L32: a character-scoped watcher first-run id ensure touches only the selected character collections',
  },
  {
    id: 'L33',
    phase: 3,
    fix: 'Avoid modules-array deep clone in $effect',
    status: 'DONE',
    testPath: 'src/ts/stores.modulesEffect.svelte.test.ts',
    testName: 'L33: the effect re-runs on consumed fields but NOT on unrelated deep edits',
  },
  {
    id: 'L34',
    phase: 3,
    fix: 'Chat-scoped snapshot in toggleSelectedChatModule',
    status: 'DONE',
    testPath: 'src/ts/moduleCommands.test.ts',
    testName: 'L34: a failed toggle restores only the active chat row, preserving sibling edits',
  },
  {
    id: 'L35',
    phase: 3,
    fix: 'Single-row snapshot in MCP setCharacterInfo',
    status: 'DONE',
    testPath: 'src/ts/process/mcp/risuaccess/tests/characters.setCharacterInfo.test.ts',
    testName: 'L35: a failed patch rolls back only the target row, preserving sibling edits',
  },
  {
    id: 'L36',
    phase: 3,
    fix: 'Surface runner rejections and roll back',
    status: 'DONE',
    testPath: 'src/ts/server/commands.test.ts',
    testName: 'L36: a rejected command factory rolls back once and resolves to an error result',
  },
  {
    id: 'L37',
    phase: 7,
    fix: 'Remove logs of full command/preset objects',
    status: 'DONE',
    testPath: 'src/ts/process/__tests__/command.resourceGuard.test.ts',
    testName: 'L37: command processing logs nothing to console.log on the warm path',
    extraTests: [
      {
        testPath: 'src/ts/storage/database.importPreset.test.ts',
        testName: 'L37: a .risupreset binary import logs nothing to console.log',
      },
      {
        testPath: 'src/ts/storage/database.importPreset.test.ts',
        testName: 'L37: an ST/json preset import logs nothing to console.log, unknown and missing prompts included',
      },
    ],
  },
  {
    id: 'L38',
    phase: 7,
    fix: 'Remove per-render Trigger time log',
    status: 'DONE',
    testPath: 'src/ts/process/scripts.editdisplay.test.ts',
    testName: 'L38: a display-trigger render pass writes nothing to console.log',
  },
  {
    id: 'L39',
    phase: 7,
    fix: 'Scan transcript in place',
    status: 'DONE',
    testPath: 'src/ts/process/serverBackedSendChat.findMessage.test.ts',
    testName: 'L39: falls back to the newest generationInfo match, scanning in place',
  },
  {
    id: 'L40',
    phase: 7,
    fix: 'Memoize trigger-effect regex sites',
    status: 'DONE',
    testPath: 'src/ts/process/triggers.regexMemo.test.ts',
    testName: 'H3/L40: v2RegexTest memo survives variable-only trigger refreshes, output unchanged',
    extraTests: [
      {
        testPath: 'src/ts/process/triggers.regexMemo.test.ts',
        testName: 'L40: low-level extractRegex compiles once per pass and extracts identically',
      },
    ],
  },
  // Context-dependent but scheduled
  {
    id: 'U1',
    phase: 2,
    fix: 'Bulk hydration known-id check (fold into Phase 2 if cheap)',
    status: 'DONE',
    testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
    testName: 'U1: bulk chat hydration performs zero whole-corpus payload reads, missing ids included',
  },
  {
    id: 'U4',
    phase: 3,
    fix: 'setCurrentChat scoped snapshot cleanup',
    status: 'DONE',
    testPath: 'src/ts/chatCommands.test.ts',
    testName: 'U4: a failed update rolls back only the active chat row, preserving sibling edits',
  },
]

// Ids deliberately NOT scheduled: they stay on the RISU_PROTOCOL_METRICS
// evidence path or an owner decision (active-risk-analysis.md "Gated").
const INTENTIONALLY_GATED: { id: string; reason: string }[] = [
  {
    id: 'L4',
    reason:
      'targeted-assembly scriptstate persist breadth is gated with the other Tier-5 write breadth (metrics evidence required).',
  },
  {
    id: 'L7',
    reason:
      'four create/delete routes at the Tier-5 floor were maintainer-deferred after a frequency x cost review; DELETE modules/:id also carries the removeModuleReferences cross-table blocker.',
  },
  {
    id: 'L26',
    reason:
      'the streaming .risu export writer is gated on large real-export evidence; only the clone+normalize sub-win may ride Phase 5 if it proves free.',
  },
  {
    id: 'U2',
    reason:
      'sprawling-resource full-bootstrap narrowing stays on the leftover.md evidence gate; the remaining broad mappings are intentional reconnect recovery.',
  },
]

// Ids needing no fix at all, plus the investigated-and-dismissed candidates.
const NO_ACTION: { id: string; reason: string }[] = [
  {
    id: 'U3',
    reason:
      'session-bounded hydration/lorebook id Sets: bounded by corpus size, cleared on resync; foot-gun, not a leak.',
  },
  {
    id: 'R1',
    reason:
      'inline continue/regenerate partial-text loss is unreachable: the real client always sends durable:true for server-dispatched continue/regenerate.',
  },
  {
    id: 'R2',
    reason:
      'per-generation memory cosine-ranking is false on the live route: /generate/chat passes empty query vectors, so the ranking loop never runs.',
  },
  {
    id: 'R3',
    reason:
      'orphan-cleanup cross-model chunk deletion is impossible by invariant: shared chunk implies identical chatMemos, so summaries are orphaned-or-kept together.',
  },
  {
    id: 'R4',
    reason:
      'buildMemoryWindow whole-characters clone is a dead local-assembler path, already downgraded to inventory-only by the frontend-performance workstream.',
  },
  {
    id: 'R5',
    reason:
      'addMetadataToElement per-render logs are dead code behind aiWatermarkingLawApplies() hardcoded to return false.',
  },
]

/** Problems that make the gate fail; extracted so the negative case can prove
 *  the self-check actually detects a missing/renamed registered test. */
export function collectGateProblems(entries: readonly ScheduledFix[]): string[] {
  const problems: string[] = []
  for (const entry of entries) {
    if (entry.status === 'PLANNED') {
      if (entry.testPath || entry.testName || entry.extraTests) {
        problems.push(`${entry.id}: PLANNED entries must not claim a test yet`)
      }
      continue
    }
    if (!entry.testPath) {
      problems.push(`${entry.id}: DONE without a registered testPath`)
      continue
    }
    const proofs = [{ testPath: entry.testPath, testName: entry.testName }, ...(entry.extraTests ?? [])]
    for (const proof of proofs) {
      const full = path.join(ROOT, proof.testPath)
      if (!existsSync(full)) {
        problems.push(`${entry.id}: registered test "${proof.testPath}" is missing`)
        continue
      }
      if (proof.testName && !readFileSync(full, 'utf8').includes(proof.testName)) {
        problems.push(`${entry.id}: test "${proof.testPath}" does not contain "${proof.testName}"`)
      }
    }
  }
  return problems
}

// --- Doc parsers (the docs are the source the registry must mirror) ---------

function readDoc(file: string): string {
  return readFileSync(file, 'utf8')
}

/** The slice of `text` under `## <heading>` up to the next `## `. */
function sectionOf(text: string, heading: string): string {
  const marker = `## ${heading}`
  const start = text.indexOf(marker)
  if (start === -1) throw new Error(`section "${heading}" not found`)
  const rest = text.slice(start + marker.length)
  const end = rest.indexOf('\n## ')
  return end === -1 ? rest : rest.slice(0, end)
}

/** Every finding id the audit document declares (H/M headings, L table rows,
 *  U bullets — the index table double-lists H/M; the Set dedupes). */
function auditFindingIds(): string[] {
  const text = readDoc(AUDIT_DOC)
  const ids = new Set<string>()
  for (const match of text.matchAll(/^### ([HM]\d+) /gm)) ids.add(match[1])
  for (const match of text.matchAll(/^\| ([HML]\d+)(?: \[KL\])? \|/gm)) ids.add(match[1])
  for (const match of text.matchAll(/^- (U\d+) /gm)) ids.add(match[1])
  return [...ids].sort()
}

/** Bullet count of the audit's Investigated And Dismissed section (the R-set). */
function auditDismissedCount(): number {
  return [...sectionOf(readDoc(AUDIT_DOC), 'Investigated And Dismissed').matchAll(/^- /gm)].length
}

interface RiskRow {
  id: string
  phase: number | null
  routing: 'scheduled' | 'done' | 'gated' | 'no-action'
}

/** Every `| <ID> | ... |` row of active-risk-analysis.md's routing tables. */
function riskMapRows(): RiskRow[] {
  const rows: RiskRow[] = []
  for (const line of readDoc(RISK_DOC).split('\n')) {
    const match = /^\|\s*([HMLU]\d+)\s*\|(.+)\|\s*$/.exec(line)
    if (!match) continue
    const id = match[1]
    const cells = match[2].split('|').map((cell) => cell.trim())
    const routingCell = cells[0] ?? ''
    const phaseMatch = /\[(\d+)\]\(/.exec(routingCell)
    if (phaseMatch) {
      rows.push({
        id,
        phase: Number(phaseMatch[1]),
        routing: line.includes('DONE') ? 'done' : 'scheduled',
      })
    } else if (routingCell === 'gated') {
      rows.push({ id, phase: null, routing: 'gated' })
    } else if (routingCell === 'no action') {
      rows.push({ id, phase: null, routing: 'no-action' })
    } else {
      // Unknown routing forms fail the mirror check below.
      rows.push({ id, phase: null, routing: 'scheduled' })
    }
  }
  return rows
}

/** The ids bulleted in active-risk-analysis.md's gated section. */
function riskGatedIds(): string[] {
  return [...sectionOf(readDoc(RISK_DOC), 'Gated / Owner-Decision').matchAll(/^- ([LU]\d+) /gm)].map(
    (match) => match[1],
  )
}

// --- The gate ---------------------------------------------------------------

const SCHEDULED_IDS = SCHEDULED_FIXES.map((entry) => entry.id)
const GATED_IDS = INTENTIONALLY_GATED.map((entry) => entry.id)
const NO_ACTION_IDS = NO_ACTION.map((entry) => entry.id)
const ALL_REGISTERED_IDS = [...SCHEDULED_IDS, ...GATED_IDS, ...NO_ACTION_IDS]

describe('fix-completeness gate (stability/performance plan)', () => {
  it('parses a non-vacuous finding universe from the audit', () => {
    const ids = auditFindingIds()
    expect(ids.length).toBeGreaterThanOrEqual(60)
    for (const probe of ['H1', 'H3', 'M1', 'M14', 'L1', 'L40', 'U1', 'U4']) {
      expect(ids, `audit universe should contain ${probe}`).toContain(probe)
    }
  })

  it('classifies every audit finding id exactly once (fails on a new id)', () => {
    const auditIds = auditFindingIds()
    const registeredAuditIds = ALL_REGISTERED_IDS.filter((id) => !id.startsWith('R')).sort()

    const duplicates = ALL_REGISTERED_IDS.filter((id, index) => ALL_REGISTERED_IDS.indexOf(id) !== index)
    expect(duplicates, 'ids classified in more than one list').toEqual([])

    const unregistered = auditIds.filter((id) => !registeredAuditIds.includes(id))
    expect(unregistered, 'audit ids missing a registry entry').toEqual([])

    const unknown = registeredAuditIds.filter((id) => !auditIds.includes(id))
    expect(unknown, 'registered ids that are not in the audit').toEqual([])
  })

  it('registers the dismissed R-set one-to-one with the audit', () => {
    const rIds = NO_ACTION_IDS.filter((id) => id.startsWith('R'))
    expect(rIds).toHaveLength(auditDismissedCount())
    expect(rIds).toEqual(rIds.map((_unused, index) => `R${index + 1}`))
  })

  it('mirrors the finding -> phase routing in active-risk-analysis.md', () => {
    const rows = riskMapRows()
    expect(rows.length).toBeGreaterThanOrEqual(58)

    const scheduledByid = new Map(SCHEDULED_FIXES.map((entry) => [entry.id, entry]))
    for (const row of rows) {
      if (row.routing === 'gated') {
        expect(GATED_IDS, `${row.id} routed "gated" in the doc`).toContain(row.id)
        continue
      }
      if (row.routing === 'no-action') {
        expect(NO_ACTION_IDS, `${row.id} routed "no action" in the doc`).toContain(row.id)
        continue
      }
      const entry = scheduledByid.get(row.id)
      expect(entry, `${row.id} is routed to a phase in the doc but not registered`).toBeDefined()
      expect(entry?.phase, `${row.id} phase mismatch vs the doc`).toBe(row.phase)
    }

    // Bidirectional: every scheduled registry id is routed in the doc…
    const docIds = new Set(rows.map((row) => row.id))
    const unrouted = SCHEDULED_IDS.filter((id) => !docIds.has(id))
    expect(unrouted, 'registered ids missing from the doc routing tables').toEqual([])
    // …and the gated bullet list matches the gated registry exactly.
    expect([...riskGatedIds()].sort()).toEqual([...GATED_IDS].sort())
  })

  it('keeps registry status in lockstep with the doc (DONE both places or neither)', () => {
    const rows = riskMapRows()
    const doneInDoc = rows
      .filter((row) => row.routing === 'done')
      .map((row) => row.id)
      .sort()
    const doneInRegistry = SCHEDULED_FIXES.filter((entry) => entry.status === 'DONE')
      .map((entry) => entry.id)
      .sort()
    expect(doneInRegistry).toEqual(doneInDoc)
  })

  it('every DONE entry resolves to an existing registered test', () => {
    expect(collectGateProblems(SCHEDULED_FIXES)).toEqual([])
  })

  it('fails when a DONE entry points at a missing test (negative self-proof)', () => {
    const missing: ScheduledFix = {
      id: 'H1',
      phase: 1,
      fix: 'negative case',
      status: 'DONE',
      testPath: 'server/fastify/__tests__/doesNotExist.test.ts',
    }
    expect(collectGateProblems([missing])).toEqual([
      'H1: registered test "server/fastify/__tests__/doesNotExist.test.ts" is missing',
    ])

    const pathless: ScheduledFix = { ...missing, testPath: undefined }
    expect(collectGateProblems([pathless])).toEqual(['H1: DONE without a registered testPath'])

    const renamed: ScheduledFix = {
      ...missing,
      testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
      testName: 'thisTestTitleDoesNotExist',
    }
    expect(collectGateProblems([renamed])).toEqual([
      'H1: test "server/fastify/__tests__/serverLoadCostHarness.test.ts" does not contain "thisTestTitleDoesNotExist"',
    ])

    const premature: ScheduledFix = {
      ...missing,
      status: 'PLANNED',
    }
    expect(collectGateProblems([premature])).toEqual(['H1: PLANNED entries must not claim a test yet'])

    // Positive control: a real cross-suite path + contained string passes —
    // the negative cases above fail for the right reason, not because the
    // checker rejects everything.
    const real: ScheduledFix = {
      ...missing,
      testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
      testName: 'assertScopedLoadOnHotPath',
    }
    expect(collectGateProblems([real])).toEqual([])
  })

  it('records a reason for every gated and no-action id', () => {
    for (const entry of [...INTENTIONALLY_GATED, ...NO_ACTION]) {
      expect(entry.reason.trim().length, `${entry.id} needs a substantive reason`).toBeGreaterThan(20)
    }
  })
})
