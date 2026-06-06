import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * V2 fix-completeness gate, Phase 0.
 *
 * Phase 0 seeds the document universe plus the routing registry. Later phases
 * flip scheduled entries from PLANNED to DONE and attach regression proof
 * fields; while entries are PLANNED, proof fields are forbidden so the gate
 * cannot imply coverage before a fix lands.
 */

// `vitest run` executes from the repo root. Under the client vite transform,
// import.meta.url is not a reliable filesystem anchor, so match the v1 gate.
const ROOT = process.cwd()
const PLAN_ROOT = 'docs/plan'
const AUDIT_DOC = path.join(ROOT, PLAN_ROOT, 'audit-stability-and-performance-v2.md')
const RISK_DOC = path.join(ROOT, PLAN_ROOT, 'active-risk-analysis.md')

type AuditKind = 'H' | 'M' | 'L' | 'I'
type GateStatus = 'PLANNED' | 'DONE'
type ActiveRiskStatus = 'PENDING' | 'DONE'
type RegistryBucket = 'scheduled' | 'gated' | 'no-action'
type Phase = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

interface ScheduledFix {
  /** V2 audit/risk finding id (`H*`, `M*`, `L*`, `K*`). */
  id: string
  /** Plan phase that owns the fix (1-8). */
  phase: Phase
  /** Short target-fix label (mirrors active-risk-analysis.md). */
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

interface ActiveRiskRoutingRow {
  id: string
  routing: RegistryBucket
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
  gated?: readonly RegistryReason[]
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
  extraTests: Array<{ testPath: string; testName: string }> = [],
): ScheduledFix {
  return {
    id,
    phase,
    fix,
    status: 'DONE',
    testPath,
    testName,
    ...(extraTests.length > 0 ? { extraTests } : {}),
  }
}

function noAction(id: string, reason: string): RegistryReason {
  return { id, reason }
}

const SCHEDULED_FIXES: ScheduledFix[] = [
  done(
    'H1',
    1,
    'Signal + wall-clock budget + iteration/recursion caps in `runTrigger`.',
    'server/fastify/__tests__/triggers.test.ts',
    'H1: stops a never-breaking v2Loop at the shared loop-back ceiling',
    [
      {
        testPath: 'server/fastify/__tests__/triggers.test.ts',
        testName: 'H1: stops a huge v2LoopNTimes at the shared loop-back ceiling',
      },
      {
        testPath: 'server/fastify/__tests__/triggers.test.ts',
        testName: 'H1: low-level self-recursive v2RunTrigger cannot bypass the hard depth cap',
      },
      {
        testPath: 'server/fastify/__tests__/triggers.test.ts',
        testName: 'H1: aborts a running trigger pass through AbortSignal',
      },
    ],
  ),
  done(
    'H2',
    1,
    'Chat-create via the targeted writer kit (fork-route shape).',
    'server/fastify/__tests__/commandMutationReadNarrowing.test.ts',
    'H2: chat-create performs zero whole-corpus message/hypa reads while writing only the new transcript',
    [
      {
        testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
        testName:
          'H2: chat-create performs zero hydrated message loads and no full-database clone-sized stringify',
      },
      {
        testPath: 'server/fastify/__tests__/commands.test.ts',
        testName: 'creates a chat at the head while select:false preserves the selected chat',
      },
      {
        testPath: 'server/fastify/__tests__/commands.test.ts',
        testName:
          'rejects command-created chat ids and message ids already used by another character',
      },
    ],
  ),
  done(
    'H3',
    1,
    'Decouple `ReloadGUIPointer` from whole-screen remount + cache wipe.',
    'src/ts/__tests__/renderCountBaseline.test.ts',
    'H3: var-only GUI refresh does not remount/reparse mounted chat messages or reset script caches',
    [
      {
        testPath: 'src/ts/__tests__/renderCostHarness.test.ts',
        testName:
          'drives a definition-level GUI reload that reparses mounted chat messages and resets caches',
      },
      {
        testPath: 'src/ts/process/triggers.regexMemo.test.ts',
        testName:
          'H3: v2UpdateGUI bumps only the variable-only GUI pointer and preserves script caches',
      },
      {
        testPath: 'src/ts/process/triggers.regexMemo.test.ts',
        testName:
          'H3/L40: v2RegexTest memo survives variable-only trigger refreshes, output unchanged',
      },
    ],
  ),
  done(
    'M1',
    3,
    'Dirty-flag `captureMessageReplacement`; compare before clone.',
    'server/fastify/__tests__/assemble.test.ts',
    'does not clone or stringify unchanged capture stages for a plain send',
    [
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName:
          'keeps run-var fixed-point rows out of message capture but captures a real rewrite once',
      },
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName:
          'captures input-trigger transcript rewrites once and keeps restoration at the original transcript',
      },
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName: 'captures editinput rewrites once after the appended user checkpoint',
      },
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName:
          'captures start-trigger chat edits once and preserves stop/error restoration baseline',
      },
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName:
          'captures regenerate truncation once and leaves the restoration transcript intact',
      },
      {
        testPath: 'server/fastify/__tests__/generation.chat.test.ts',
        testName:
          'leaves a plain send transcript to the browser (no route message write) (slice 3b-4)',
      },
    ],
  ),
  done(
    'M2',
    3,
    'Marker fixed-point guard in `formatHistoryMessage`.',
    'server/fastify/__tests__/assemble.test.ts',
    'skips expandVariables for marker-free history rows but expands markers and legacy tags',
  ),
  done(
    'M3',
    3,
    'Render stable template cards once; preflight tokenizes cached rows.',
    'server/fastify/__tests__/templates.test.ts',
    'renders stable template cards once across preflight and final render',
    [
      {
        testPath: 'server/fastify/__tests__/templates.test.ts',
        testName:
          'keeps live chat, postEverything, memory, and cache cards outside the stable-card cache',
      },
      {
        testPath: 'server/fastify/__tests__/templates.test.ts',
        testName: 'keeps prompt bytes identical with stable-card cache across template variants',
      },
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName: 'persists stable-card setvar once through assembly mutations',
      },
    ],
  ),
  done(
    'M4',
    3,
    'Memoize charhistory/userhistory/lorebook callbacks per assembly.',
    'server/fastify/__tests__/assemble.test.ts',
    'evaluates repeated charhistory, userhistory, and lorebook callbacks once per assembly signature',
    [
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName:
          'does not return stale history output after the assembly history generation changes',
      },
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName: 'does not return stale lorebook output after lore identities change',
      },
    ],
  ),
  done(
    'M5',
    2,
    'Single-row scoped read + repair for character/chat PATCH.',
    'server/fastify/__tests__/commandMutationReadNarrowing.test.ts',
    'M5: character PATCH repairs and writes the target row without whole-corpus reads',
    [
      {
        testPath: 'server/fastify/__tests__/commandMutationReadNarrowing.test.ts',
        testName:
          'M5: chat PATCH without modules uses chatScopedRead and preserves selected chat state',
      },
      {
        testPath: 'server/fastify/__tests__/commandMutationReadNarrowing.test.ts',
        testName: 'M5: chat PATCH takes the explicit broad fallback only for patch.modules',
      },
      {
        testPath: 'server/fastify/__tests__/commandSingleRowPaths.test.ts',
        testName: 'PATCH chats/:id with select:true co-writes the parent character row',
      },
    ],
  ),
  done(
    'M6',
    2,
    'Field-scoped projection loaders that skip the characters parse.',
    'server/fastify/__tests__/serverLoadCostHarness.test.ts',
    'M6: foreign field projections skip character and chat table payload reads',
    [
      {
        testPath: 'server/fastify/__tests__/projection.test.ts',
        testName: 'M6: foreign field projections are byte-identical to the broad composition',
      },
      {
        testPath: 'server/fastify/__tests__/projection.test.ts',
        testName: 'selects character fields with chat and lorebook stubs',
      },
    ],
  ),
  done(
    'M7',
    4,
    'Assign `replace_all` messages without `structuredClone`.',
    'src/ts/process/request/tests/serverMessagePatch.test.ts',
    'M7: replace_all applies a byte-identical transcript with zero structuredClone calls',
    [
      {
        testPath: 'src/ts/process/request/tests/serverMessagePatch.test.ts',
        testName:
          'preserves append single-message detach while normalizing an already-local user append',
      },
    ],
  ),
  done(
    'M8',
    4,
    '`getItem` reads one key, not a whole-DB snapshot.',
    'src/ts/plugins/plugins.test.ts',
    'M8: pluginStorage.getItem clones only the selected key without a whole-DB snapshot',
    [
      {
        testPath: 'src/ts/plugins/plugins.test.ts',
        testName: 'M8: pluginStorage.getItem preserves missing scalar and falsey results',
      },
      {
        testPath: 'src/ts/plugins/plugins.test.ts',
        testName: 'M8: pluginStorage.getItem detaches array values from live plugin storage',
      },
    ],
  ),
  done(
    'M9',
    4,
    'Allowed-keys diff for `changedChatMetadata` (v1-M13 shape).',
    'src/ts/chatCommands.test.ts',
    'M9: allowed metadata diffs match the previous clone-sanitize patch bytes',
    [
      {
        testPath: 'src/ts/chatCommands.test.ts',
        testName:
          'M9: message-only changes produce an empty patch without serializing message arrays',
      },
      {
        testPath: 'src/ts/chatCommands.test.ts',
        testName: 'M9: changed object metadata is detached from the current chat record',
      },
      {
        testPath: 'src/ts/chatCommands.test.ts',
        testName: 'restores only the one chat row, preserving message history and unrelated chats',
      },
    ],
  ),
  done(
    'M10',
    4,
    'Module-only / single-row module snapshots.',
    'src/ts/moduleCommands.test.ts',
    'M10: global module snapshots clone only modules and enabledModules',
    [
      {
        testPath: 'src/ts/moduleCommands.test.ts',
        testName:
          'M10: character-module snapshots clone and restore only the target modules field',
      },
      {
        testPath: 'src/ts/moduleCommands.test.ts',
        testName: 'M10: forced-failure global rollback preserves concurrent character edits',
      },
      {
        testPath: 'src/ts/moduleCommands.test.ts',
        testName:
          'M10: forced-failure character-module rollback preserves sibling and same-row edits',
      },
      {
        testPath: 'src/ts/moduleCommands.test.ts',
        testName: 'M10: character-module rollback uses stable ids across index shifts',
      },
    ],
  ),
  planned('M11', 6, 'Apply-epoch gate for the lorebook watcher (+ epoch-bumping apply).'),
  planned('M12', 6, 'Apply-epoch gate for the character-profile watcher.'),
  planned('M13', 5, 'Debounce + per-item memo for prompt-template tokenize.'),
  planned('M14', 6, 'Idempotent `nodeObserve` (or wire the dead MutationObserver).'),
  planned('M15', 7, 'Bounded Map (LRU) translate cache.'),
  planned('M16', 7, 'Remove html log; `DoingChat` gate for non-exp translators.'),
  planned('M17', 5, 'Module-level content-keyed translate-detection memo.'),
  planned('M18', 7, 'Reuse/close `AudioContext` per playback.'),
  planned('M19', 7, 'Reset bergamot chain on rejection; reinit on wasm error.'),
  planned('M20', 7, 'Bounded deadlines for MCP request/handshake/SSE waits.'),
  planned('M21', 7, 'Parenthesized guard + mid-stream byte cap in CharX import.'),
  planned('M22', 7, 'Remove the `.po` 100-line test cap.'),
  planned('L1', 8, 'Configurable/sliding durable deadline (pair with the non-durable twin).'),
  planned('L2', 8, 'Delete/TTL terminal finalization-retry rows.'),
  done(
    'L3',
    2,
    'Settings-only loader for server-intent completion.',
    'server/fastify/__tests__/generation.completion.test.ts',
    'server-intent completion preserves model-mode selection and provider payload options',
    [
      {
        testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
        testName: 'L3: server-intent completion performs zero loadPersisted-shaped corpus reads',
      },
      {
        testPath: 'server/fastify/__tests__/generation.completion.test.ts',
        testName: 'server-intent completion preserves staticModel and streaming response bytes',
      },
    ],
  ),
  done(
    'L4',
    3,
    'Persist lorebook sticky-activation chat-var writes.',
    'server/fastify/__tests__/generation.chat.test.ts',
    'persists lorebook @@keep_activate_after_match and uses it on the next send (L4)',
    [
      {
        testPath: 'server/fastify/__tests__/assemble.test.ts',
        testName:
          'persists @@dont_activate_after_match through assembly mutations and suppresses the next send',
      },
      {
        testPath: 'server/fastify/__tests__/generation.chat.test.ts',
        testName: 'keeps preview-mode lorebook sticky writes read-only (L4)',
      },
    ],
  ),
  done(
    'L5',
    3,
    'Hoist per-message normalization out of `searchMatch`.',
    'server/fastify/__tests__/lorebook.test.ts',
    'L5: normalizes base searchable messages once across recursive search passes',
  ),
  done(
    'L6',
    3,
    'Memoize trigger/effect regexes; hoist transcript joins.',
    'server/fastify/__tests__/triggers.test.ts',
    'L6: reuses transcript windows across exists conditions and quick-search effects',
    [
      {
        testPath: 'server/fastify/__tests__/triggers.test.ts',
        testName: 'L6: invalidates transcript cache after trigger message mutations',
      },
      {
        testPath: 'server/fastify/__tests__/triggers.test.ts',
        testName:
          'L6: reuses compiled regexes across trigger conditions and V2 effects',
      },
      {
        testPath: 'server/fastify/__tests__/triggers.test.ts',
        testName: 'L6: keeps malformed V2 regex fallback behavior with the cache enabled',
      },
    ],
  ),
  done(
    'L7',
    3,
    'Trigger-presence check before the `runTrigger` clones.',
    'server/fastify/__tests__/triggers.test.ts',
    'L7: no-trigger run returns null before structured cloning inputs',
  ),
  done(
    'L8',
    3,
    'Hoist `SEND_NAME_WRAPPER` expansion once per assembly.',
    'server/fastify/__tests__/assemble.test.ts',
    'expands SEND_NAME_WRAPPER once per history window and reuses it for rows',
  ),
  done(
    'L9',
    3,
    'Expand depth-prompt bodies once; preflight reuses.',
    'server/fastify/__tests__/assemble.test.ts',
    'expands depth-prompt bodies once for preflight and reuses them for final splice',
  ),
  done(
    'L10',
    3,
    'Cap `{{#each}}` expansion size.',
    'src/ts/parser/tests/cbs/eachReinjection.test.ts',
    'L10: throws parser budget error when #each element count exceeds cap',
    [
      {
        testPath: 'src/ts/parser/tests/cbs/eachReinjection.test.ts',
        testName: 'L10: throws parser budget error when #each expanded output exceeds cap',
      },
      {
        testPath: 'src/ts/parser/tests/cbs/eachReinjection.test.ts',
        testName: 'L10: keeps normal and nested #each output byte-identical below the cap',
      },
    ],
  ),
  done(
    'L11',
    3,
    'Cheap CBS tag-name normalization.',
    'src/ts/parser/tests/cbs/strings.test.ts',
    'L11: normalizes matcher aliases with case and separators while preserving args',
    [
      {
        testPath: 'src/ts/parser/tests/cbs/strings.test.ts',
        testName: 'L11: preserves raw matcher tag text passed to callbacks',
      },
    ],
  ),
  done(
    'L13',
    2,
    'Targeted writes for Realm character append.',
    'server/fastify/__tests__/serverLoadCostHarness.test.ts',
    'L13: Realm character append performs zero loadPersisted-shaped corpus reads',
    [
      {
        testPath: 'server/fastify/__tests__/realmImport.test.ts',
        testName:
          'rejects duplicate Realm character ids without bumping revision or emitting events',
      },
    ],
  ),
  done(
    'L14',
    2,
    'Delta-aware transcript persist diff.',
    'server/fastify/__tests__/messageStore.test.ts',
    'L14: append-only tail persistence writes byte-identical rows without prefix diff work',
    [
      {
        testPath: 'server/fastify/__tests__/messageStore.test.ts',
        testName: 'L14: edit and truncate replacements still exercise the generic diff path',
      },
      {
        testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
        testName: 'L14: append-only message diff cost stays constant with long prefixes',
      },
      {
        testPath: 'server/fastify/__tests__/generation.chat.test.ts',
        testName: 'runs a Lua input trigger that rewrites the transcript + persists it',
      },
    ],
  ),
  planned('L15', 8, '`PRAGMA synchronous = NORMAL`.'),
  done(
    'L16',
    2,
    'Single auth verification on the bulk routes.',
    'server/fastify/__tests__/auth.test.ts',
    'rejects unauthenticated requests and verifies authenticated requests exactly once',
  ),
  planned('L17', 8, 'Retention sweep for terminal memory jobs.'),
  planned('L18', 8, 'Fast-path reschedule after a productive worker tick.'),
  planned('L19', 8, 'Scope the fail-cascade to contextual groups.'),
  planned('L20', 8, 'Share one summaries fetch between cleanup and selection.'),
  planned('L21', 8, 'Per-chunk size ceiling before embed requests.'),
  planned('L22', 8, 'Size the contextual budget from provider limits; surface splits.'),
  planned('L23', 8, 'Batch JSON-card asset persists (charx shape).'),
  planned('L24', 8, 'Compensating asset cleanup when the append fails.'),
  planned('L25', 8, 'Open-or-skip assets at stream time (`missingFiles` degrade).'),
  planned('L26', 8, 'Temp-file + rename for legacy storage writes.'),
  planned('L27', 8, 'Abort/timeout (+ streaming) for hub forwards.'),
  planned('L28', 8, 'Drop the double clone in JSON import normalize.'),
  planned('L29', 8, 'Cap the charx download near the expanded limit.'),
  planned('L30', 8, 'In-flight promise dedupe for Vertex tokens.'),
  planned('L31', 8, 'Default proxy deadline when `risu-timeout-ms` is absent.'),
  done(
    'L32',
    4,
    'Drop `setDatabase` from `/send`-family + `mutateCurrentChatMessages`.',
    'src/ts/process/__tests__/command.projectionGuard.test.ts',
    'L32: /send appends a user message without setDatabase or whole-db clone churn',
    [
      {
        testPath: 'src/ts/process/__tests__/command.projectionGuard.test.ts',
        testName: 'L32: /sendas appends a character message without setDatabase',
      },
      {
        testPath: 'src/ts/process/__tests__/command.projectionGuard.test.ts',
        testName: 'L32: /comment appends the legacy comment block to the last message',
      },
      {
        testPath: 'src/ts/process/__tests__/command.projectionGuard.test.ts',
        testName: 'L32: /cut range keeps the legacy sliced transcript bytes',
      },
      {
        testPath: 'src/ts/process/__tests__/command.projectionGuard.test.ts',
        testName: 'L32: /cut index keeps the legacy spliced row bytes',
      },
      {
        testPath: 'src/ts/process/__tests__/command.projectionGuard.test.ts',
        testName: 'L32: /cut id removes the matching chatId without setDatabase',
      },
      {
        testPath: 'src/ts/process/__tests__/command.projectionGuard.test.ts',
        testName: 'L32: /del keeps the legacy last-N truncation without setDatabase',
      },
      {
        testPath: 'src/ts/process/__tests__/command.projectionGuard.test.ts',
        testName: 'L32: /multisend appends each segment in order and sends after each one',
      },
      {
        testPath: 'src/ts/process/__tests__/command.projectionGuard.test.ts',
        testName: 'L32: /multisend clear resets before each segment and still sends each segment',
      },
      {
        testPath: 'src/ts/process/__tests__/command.projectionGuard.test.ts',
        testName: 'L32: forced message-command failure restores only the active chat',
      },
    ],
  ),
  planned('L33', 4, 'Single-row snapshot for trash `removeChar`.'),
  planned('L34', 4, 'Minimal `supaMemory` patch on selection.'),
  planned('L35', 6, 'Carry `hypaV3Data` independently of message length.'),
  planned('L36', 6, 'Bound the prereroll maps; clear on chat switch.'),
  planned('L37', 4, 'Same-language early-return in `changeLanguage`.'),
  planned('L38', 5, 'Remove `{{#function}}`/`{{call::}}` logs.'),
  planned('L39', 5, '`includes()` fast path + indexOf scan in `parseThoughtsAndTools`.'),
  planned('L40', 5, 'Module-level content-keyed `ParseMarkdown` memo (with H3).'),
  planned('L41', 5, 'One shared partial-edit mousemove handler.'),
  planned('L42', 5, '`$derived` + keyed each for GridCatalog.'),
  planned('L43', 5, '`$derived` + keyed each for ModuleSettings.'),
  planned('L44', 5, 'Cheap signature compare for the sidebar list effect.'),
  planned('L45', 6, 'Capped exponential backoff + jitter for SSE reconnect.'),
  planned('L46', 6, 'Bound `sseIdDone` (windowed dedup).'),
  planned('L47', 6, 'Remove the `fetchNative` body log.'),
  planned('L48', 7, 'Translate once; cap HF TTS retries.'),
  planned('L49', 7, '`decode()`/`complete` guard + onerror for inlay images.'),
  planned('L50', 7, 'LRU + revoke for `blobUrlCache`.'),
  planned('L51', 7, 'Single-pass PNG import (or value-free count pass).'),
  planned('L52', 7, 'Remove the file-send logs.'),
  planned('L53', 7, 'Pass raw bytes to pdfjs.'),
  planned('L54', 7, 'Timeout + tracked listeners for MCP SSE waits.'),
  planned('L55', 7, 'Cache internal MCP tool lists; name->client index.'),
  planned('L56', 7, 'Persist the FS directory handle across recreate.'),
  planned('L57', 7, 'Wire the debug flag; gate MCP logs.'),
  planned('L58', 7, 'Epoch-guard `translateSuggest` writes.'),
  planned('L59', 7, 'Skip retrying translation network errors in `markParsing`.'),
  done(
    'K1',
    2,
    'Wire `chatScopedRead` into generation finalization persist (v1-L6 residual).',
    'server/fastify/__tests__/serverLoadCostHarness.test.ts',
    'K1: message-only generation finalization performs zero loadPersisted-shaped corpus reads',
    [
      {
        testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
        testName: 'K1: chat-variable generation finalization keeps the broad write path',
      },
      {
        testPath: 'server/fastify/__tests__/generation.chat.test.ts',
        testName:
          'K1: chat-variable generation finalization keeps broad writes and reports truthful metrics',
      },
    ],
  ),
  done(
    'K2',
    2,
    'Message-free/scoped load for the asset-GC sweep (v1-M10 residual).',
    'server/fastify/__tests__/assetGc.test.ts',
    'preserves references from settings, collection rows, character rows, chat rows, and messages',
    [
      {
        testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
        testName: 'K2: asset GC avoids loadPersisted-shaped corpus reads',
      },
    ],
  ),
  planned(
    'K3',
    7,
    'Check `blobUrlCache` before fetching asset bytes (ordering only; bulk-byte route stays gated).',
  ),
  planned(
    'K4',
    4,
    'Debounce/scope the lorebook editor per-keystroke collection clone (v1-L32 residual).',
  ),
]

const INTENTIONALLY_GATED: RegistryReason[] = [
  {
    id: 'L12',
    reason:
      'Lua pool/boot serialization is the documented wasmoon shared-wasm constraint; raising the engine pool target needs owner approval and protocol metrics evidence.',
  },
]

const GATED_CONTEXT_REASONS: GateContextReason[] = [
  {
    reason:
      'Archived v1 carry-overs v1-L4, v1-L7, v1-L26, and v1-U2 remain owned by the v1 risk analysis and are explanatory context only here.',
  },
  {
    reason:
      '`leftover.md` evidence gates remain parent evidence gates; v2 K rows only schedule the narrowed residual sub-wins.',
  },
]

const NO_ACTION: RegistryReason[] = [
  noAction(
    'I1',
    'Inventory only: done-in-grace reattach has single-viewer semantics and no Phase 0 fix is scheduled.',
  ),
  noAction(
    'I2',
    'Inventory only: edit-hook trigger-context rebuilds are not scheduled in the v2 remediation plan.',
  ),
  noAction(
    'I3',
    'Inventory only: the unused command-events created_at index is write amplification and may ride Phase 8 if free.',
  ),
  noAction(
    'I4',
    'Inventory only: command-event replay is a reconnect-path full-table map, not a scheduled hot-path fix.',
  ),
  noAction(
    'I5',
    'Inventory only: bounded inflate has roughly 2x within-cap peak memory, but the cap already bounds risk.',
  ),
  noAction(
    'I6',
    'Inventory only: Bedrock SigV4 hashes request bodies synchronously, but no v2 fix is scheduled.',
  ),
  noAction(
    'I7',
    'Inventory only: delimiter scanning is bounded by the 8 MB SSE cap, so this stays no-action.',
  ),
  noAction(
    'I8',
    'Inventory only: the Horde poll loop is fixed-interval on a route no bundled SPA path uses.',
  ),
  noAction(
    'I9',
    'Inventory only: Vertex token-exchange errors can echo upstream bodies in same-user self-host scenarios.',
  ),
  noAction(
    'I10',
    'Inventory only: inlay-marker transcript scans are linear server-send work and not scheduled.',
  ),
  noAction(
    'I11',
    "Inventory only: `evaluateIgp` preserves the original port's `[object Object]` append behavior.",
  ),
  noAction(
    'I12',
    'Inventory only: editdisplay-triggered additional-asset parsing is single-message scale with cached file resolution.',
  ),
  noAction(
    'I13',
    'Inventory only: RegexList unkeyed-each churn has no data-corruption finding to schedule.',
  ),
  noAction(
    'I14',
    'Inventory only: BookmarkList map rebuilds are modal-local and remain outside the scheduled plan.',
  ),
  noAction(
    'I15',
    'Inventory only: claudeObserver keeps a permanent timer but self-limits fetches after its one-shot run.',
  ),
  noAction(
    'I16',
    'Inventory only: the parser nesting-stack cap may ride Phase 3 if free, but no fix is required.',
  ),
  noAction(
    'I17',
    'Inventory only: voiceDetector would leak resources but is dead code and should be deleted or fixed before reuse.',
  ),
  noAction(
    'I18',
    'Inventory only: duplicate MCP tool names dispatch first-match, which is documented as no-action.',
  ),
  noAction(
    'R1',
    'Dismissed: durable submission-lock leak on attach throw has no synchronous throw site between register and trackRunner.',
  ),
  noAction(
    'R2',
    'Dismissed: promptScope is set, used, and cleared synchronously inside expandVariables, so no async race exists.',
  ),
  noAction(
    'R3',
    'Dismissed: LuaExecBudget usedMs accumulates only actual Lua runtime, not provider-call time.',
  ),
  noAction(
    'R4',
    'Dismissed: fresh-engine boot failure is caught because both assembly entry points wrap the path in try/catch.',
  ),
  noAction(
    'R5',
    'Dismissed: memory selection does not eagerly decode embeddings on the live route because query vectors are empty.',
  ),
  noAction(
    'R6',
    'Dismissed: embedding batch handlers dispatch exclusively through one worker and one shared limiter.',
  ),
  noAction(
    'R7',
    'Dismissed: oversized SSE complete events trip the 8 MB cap while the event is accumulating.',
  ),
  noAction(
    'R8',
    'Dismissed: SSE reader drain after non-abort cancel is unreachable in the live runtime.',
  ),
  noAction(
    'R9',
    'Dismissed: regex memo wipe as a standalone finding was folded into H3, and the bestMatchCache claim was wrong.',
  ),
  noAction(
    'R10',
    'Dismissed: memory-worker fairness now-skew is mechanically true but has no consequential unfairness.',
  ),
  noAction(
    'R11',
    'Dismissed: MCP customTransport leak is dead code because the transport is never assigned.',
  ),
  noAction(
    'R12',
    'Dismissed: PNG import uploads are chunked at 32 items or 32 MB, not sent as one giant JSON body.',
  ),
  noAction(
    'R13',
    'Dismissed: getInlayAsset re-fetch per assembly is in the dead local-assembly arm.',
  ),
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

function numericIdSort(a: string, b: string): number {
  const kindCompare = a[0].localeCompare(b[0])
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

function markdownTableCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null

  const cells = trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
  if (!cells[0] || /^-+$/.test(cells[0])) return null
  return cells
}

/**
 * H/M/L/I ids are v2-scoped only when they appear as explicit finding headings
 * or as the first cell of a machine-readable table row.
 */
function auditFindingIdsByKind(text = readDoc(AUDIT_DOC)): Record<AuditKind, string[]> {
  const ids = blankAuditUniverse()

  for (const match of text.matchAll(/^###\s+([HMLI]\d+)\b/gm)) {
    const id = match[1]
    ids[id[0] as AuditKind].add(id)
  }

  for (const line of text.split('\n')) {
    const cells = markdownTableCells(line)
    const match = cells?.[0].match(/^([HMLI]\d+)(?:\s+\[[^\]]+\])?$/)
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
    if (routingCell === 'gated') {
      rows.push({
        id,
        routing: 'gated',
        phase: null,
        targetFix: cells[2] ?? '',
        status: null,
        rawRouting: routingCell,
        rawStatus: cells[3] ?? '',
      })
      continue
    }
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

    const phaseMatch = /\[(\d+)\]\(/.exec(routingCell)
    const rawStatus = cells[3] ?? ''
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

const EXPECTED_AUDIT_RANGES: Record<AuditKind, string[]> = {
  H: rangeIds('H', 3),
  M: rangeIds('M', 22),
  L: rangeIds('L', 59),
  I: rangeIds('I', 18),
}

function collectAuditUniverseDriftProblems(
  universe: Record<AuditKind, string[]>,
  expected: Record<AuditKind, string[]> = EXPECTED_AUDIT_RANGES,
): string[] {
  const problems: string[] = []

  for (const kind of Object.keys(expected) as AuditKind[]) {
    const actualIds = new Set(universe[kind])
    const expectedIds = new Set(expected[kind])
    const missing = expected[kind].filter((id) => !actualIds.has(id))
    const extra = universe[kind].filter((id) => !expectedIds.has(id))

    if (missing.length > 0) problems.push(`${kind}: missing ids ${missing.join(', ')}`)
    if (extra.length > 0) problems.push(`${kind}: unexpected ids ${extra.join(', ')}`)
  }

  return problems
}

function isValidPhase(value: number | null): value is Phase {
  return Number.isInteger(value) && value >= 1 && value <= 8
}

function expectedRegistryStatus(docStatus: ActiveRiskStatus): GateStatus {
  return docStatus === 'PENDING' ? 'PLANNED' : 'DONE'
}

function allAuditIds(universe: Record<AuditKind, string[]>): string[] {
  return sortedIds([...universe.H, ...universe.M, ...universe.L, ...universe.I])
}

function bucketMap(
  scheduled: readonly ScheduledFix[],
  gated: readonly RegistryReason[],
  noActionEntries: readonly RegistryReason[],
): Map<string, RegistryBucket[]> {
  const buckets = new Map<string, RegistryBucket[]>()
  const add = (id: string, bucket: RegistryBucket) => {
    buckets.set(id, [...(buckets.get(id) ?? []), bucket])
  }

  for (const entry of scheduled) add(entry.id, 'scheduled')
  for (const entry of gated) add(entry.id, 'gated')
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

/** Problems that make the v2 routing registry fail. */
export function collectGateProblems(input: GateProblemInput = {}): string[] {
  const scheduled = input.scheduled ?? SCHEDULED_FIXES
  const gated = input.gated ?? INTENTIONALLY_GATED
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
  const classifiedBuckets = bucketMap(scheduled, gated, noActionEntries)
  const scheduledById = new Map(scheduled.map((entry) => [entry.id, entry]))
  const gatedById = new Map(gated.map((entry) => [entry.id, entry]))
  const noActionById = new Map(noActionEntries.map((entry) => [entry.id, entry]))

  for (const entry of scheduled) {
    if (!/^[HMLK]\d+$/.test(entry.id)) {
      problems.push(`${entry.id}: scheduled registry id is not a v2 scheduled id`)
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

  for (const entry of [...gated, ...noActionEntries]) {
    if (!/^[HMLIR]\d+$/.test(entry.id)) {
      problems.push(`${entry.id}: registry reason id is not a v2 audit or dismissed id`)
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
      problems.push(`${id}: registry id is missing from the v2 docs universe`)
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

  for (const row of routingRows.filter((route) => route.routing === 'gated')) {
    if (!gatedById.has(row.id)) {
      const bucket = registeredBucketName(row.id, classifiedBuckets)
      if (bucket) {
        problems.push(`${row.id}: doc gates id but registry classifies it as ${bucket}`)
      } else {
        problems.push(`${row.id}: gated in docs but missing from INTENTIONALLY_GATED`)
      }
    }
  }

  for (const entry of gated) {
    const row = riskRowsById.get(entry.id)
    if (!row) {
      problems.push(`${entry.id}: INTENTIONALLY_GATED entry missing from active-risk docs`)
    } else if (row.routing !== 'gated') {
      problems.push(`${entry.id}: registry gates id but docs route it as ${row.routing}`)
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

describe('v2 fix-completeness gate doc universe', () => {
  it('parses the exact audit H/M/L/I counts and sorted ranges', () => {
    const universe = auditFindingIdsByKind()

    expect(universe.H).toHaveLength(3)
    expect(universe.H).toEqual(rangeIds('H', 3))

    expect(universe.M).toHaveLength(22)
    expect(universe.M).toEqual(rangeIds('M', 22))

    expect(universe.L).toHaveLength(59)
    expect(universe.L).toEqual(rangeIds('L', 59))

    expect(universe.I).toHaveLength(18)
    expect(universe.I).toEqual(rangeIds('I', 18))
  })

  it('parses known-overlap residual K rows only from active-risk', () => {
    const rows = knownOverlapResidualRows()
    const ids = rows.map((row) => row.id)

    expect(rows).toHaveLength(4)
    expect(ids).toEqual(rangeIds('K', 4))
    expect(rows.map((row) => row.status)).toEqual(['DONE', 'DONE', 'PENDING', 'PENDING'])

    expect(rows[0].targetFix).toContain('v1-L6 residual')
    expect(rows[1].targetFix).toContain('v1-M10 residual')
    expect(rows[2].targetFix).toContain('bulk-byte route stays gated')
    expect(rows[3].targetFix).toContain('v1-L32 residual')

    expect(ids).not.toContain('L6')
    expect(ids).not.toContain('M10')
    expect(ids).not.toContain('L32')
  })

  it('parses dismissed candidates from the audit numbered list', () => {
    const ids = dismissedCandidateIds()

    expect(ids).toHaveLength(13)
    expect(ids).toEqual(rangeIds('R', 13))
  })

  it('has no drift against the current expected v2 audit universe', () => {
    expect(collectAuditUniverseDriftProblems(auditFindingIdsByKind())).toEqual([])
  })

  it('self-proves in-memory M23 doc drift detection for table rows and headings', () => {
    const auditText = readDoc(AUDIT_DOC)
    const withTableRow = `${auditText}\n| M23 | Med | perf | server | fake drift |\n`
    const withHeading = `${auditText}\n### M23 - fake drift\n`

    expect(auditFindingIdsByKind(withTableRow).M).toContain('M23')
    expect(collectAuditUniverseDriftProblems(auditFindingIdsByKind(withTableRow))).toEqual([
      'M: unexpected ids M23',
    ])

    expect(auditFindingIdsByKind(withHeading).M).toContain('M23')
    expect(collectAuditUniverseDriftProblems(auditFindingIdsByKind(withHeading))).toEqual([
      'M: unexpected ids M23',
    ])
  })
})

describe('v2 fix-completeness gate routing registry', () => {
  it('parses active-risk routing and status rows for H/M/L/I/K', () => {
    const rows = activeRiskRoutingRows()
    const scheduledRows = rows.filter((row) => row.routing === 'scheduled')
    const noActionRows = rows.filter((row) => row.routing === 'no-action')

    expect(scheduledRows.map((row) => row.id)).toEqual(SCHEDULED_FIXES.map((entry) => entry.id))
    expect(scheduledRows.map((row) => row.status)).toEqual(
      SCHEDULED_FIXES.map((entry) => (entry.status === 'DONE' ? 'DONE' : 'PENDING')),
    )
    expect(rows.find((row) => row.id === 'L12')?.routing).toBe('gated')
    expect(noActionRows.map((row) => row.id)).toEqual(rangeIds('I', 18))
  })

  it('classifies every v2 audit, K residual, and dismissed id exactly once', () => {
    expect(collectGateProblems()).toEqual([])
  })

  it('keeps the registry buckets on the Phase 0 target sets', () => {
    const scheduledIds = SCHEDULED_FIXES.map((entry) => entry.id)
    const gatedIds = INTENTIONALLY_GATED.map((entry) => entry.id)
    const noActionIds = NO_ACTION.map((entry) => entry.id)

    expect(scheduledIds).toEqual([
      ...rangeIds('H', 3),
      ...rangeIds('M', 22),
      ...rangeIds('L', 11),
      ...rangeIds('L', 59).slice(12),
      ...rangeIds('K', 4),
    ])
    expect(scheduledIds).not.toContain('L12')
    expect(gatedIds).toEqual(['L12'])
    expect(noActionIds.filter((id) => id.startsWith('I'))).toEqual(rangeIds('I', 18))
    expect(noActionIds.filter((id) => id.startsWith('R'))).toEqual(rangeIds('R', 13))
  })

  it('records v1 carry-overs and leftover gates only as explanatory context', () => {
    const registeredIds = [
      ...SCHEDULED_FIXES.map((entry) => entry.id),
      ...INTENTIONALLY_GATED.map((entry) => entry.id),
      ...NO_ACTION.map((entry) => entry.id),
    ]
    const contextText = GATED_CONTEXT_REASONS.map((entry) => entry.reason).join('\n')

    expect(registeredIds.filter((id) => id.startsWith('v1-'))).toEqual([])
    expect(registeredIds).not.toContain('leftover.md')
    expect(contextText).toContain('v1-L4')
    expect(contextText).toContain('leftover.md')
  })

  it('rejects PLANNED registry entries that claim proof fields', () => {
    const withPrematureProof = SCHEDULED_FIXES.map((entry) =>
      entry.id === 'M11'
        ? {
            ...entry,
            testPath: 'server/fastify/__tests__/serverLoadCostHarness.test.ts',
            testName: 'premature proof',
          }
        : entry,
    )

    expect(collectGateProblems({ scheduled: withPrematureProof })).toContain(
      'M11: PLANNED entries must not claim proof fields',
    )
  })

  it('keeps unfinished scheduled entries PLANNED without proof fields and DONE entries proven', () => {
    const plannedEntries = SCHEDULED_FIXES.filter((entry) => entry.status === 'PLANNED')
    expect(plannedEntries.every((entry) => entry.status === 'PLANNED')).toBe(true)
    expect(plannedEntries.filter(hasProofFields)).toEqual([])

    const doneEntries = SCHEDULED_FIXES.filter((entry) => entry.status === 'DONE')
    expect(doneEntries.map((entry) => entry.id)).toEqual([
      'H1',
      'H2',
      'H3',
      'M1',
      'M2',
      'M3',
      'M4',
      'M5',
      'M6',
      'M7',
      'M8',
      'M9',
      'M10',
      'L3',
      'L4',
      'L5',
      'L6',
      'L7',
      'L8',
      'L9',
      'L10',
      'L11',
      'L13',
      'L14',
      'L16',
      'L32',
      'K1',
      'K2',
    ])
    expect(doneEntries.every(hasProofFields)).toBe(true)
  })

  it('rejects DONE entries without a registered test path and test name', () => {
    const syntheticDone = SCHEDULED_FIXES.map((entry) =>
      entry.id === 'M11'
        ? {
            ...entry,
            status: 'DONE' as const,
          }
        : entry,
    )

    expect(collectGateProblems({ scheduled: syntheticDone })).toEqual(
      expect.arrayContaining([
        'M11: status mismatch (registry DONE, docs PENDING)',
        'M11: DONE without a registered testPath',
        'M11: DONE without a registered testName',
      ]),
    )
  })

  it('validates primary and extra DONE test proofs against existing test files', () => {
    const missingExtraTestName = ['missing extra proof title', 'assembled at runtime'].join(' ')
    const syntheticDone = SCHEDULED_FIXES.map((entry) =>
      entry.id === 'M11'
        ? {
            ...entry,
            status: 'DONE' as const,
            testPath: 'src/ts/__tests__/fixCompletenessGateV2.test.ts',
            testName: 'validates primary and extra DONE test proofs',
            extraTests: [
              {
                testPath: 'src/ts/__tests__/fixCompletenessGateV2.test.ts',
                testName: missingExtraTestName,
              },
            ],
          }
        : entry,
    )

    expect(collectGateProblems({ scheduled: syntheticDone })).toEqual(
      expect.arrayContaining([
        'M11: status mismatch (registry DONE, docs PENDING)',
        `M11: test "src/ts/__tests__/fixCompletenessGateV2.test.ts" does not contain "${missingExtraTestName}"`,
      ]),
    )
  })

  it('self-proves fake M23 audit and routing row detection through doc overrides', () => {
    const auditText = `${readDoc(AUDIT_DOC)}\n| M23 | Med | perf | server | fake drift |\n`
    const riskText = `${readDoc(RISK_DOC)}\n| M23 | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Synthetic drift row. | PENDING |\n`

    expect(collectGateProblems({ auditText, riskText })).toEqual(
      expect.arrayContaining([
        'M23: scheduled in docs but missing from SCHEDULED_FIXES',
        'M23: missing classification bucket',
      ]),
    )
  })

  it('self-proves phase mismatch detection against an in-memory active-risk doc', () => {
    const riskText = readDoc(RISK_DOC)
    const withWrongPhase = replaceRiskRow(
      riskText,
      'H1',
      '| H1 | [2](phases/phase-2-server-corpus-ring-2.md) | Signal + wall-clock budget + iteration/recursion caps in `runTrigger`. | PENDING |',
    )

    expect(collectGateProblems({ riskText: withWrongPhase })).toContain(
      'H1: phase mismatch (registry 1, docs 2)',
    )
  })

  it('self-proves doc DONE drift detection against an in-memory active-risk doc', () => {
    const riskText = readDoc(RISK_DOC)
    const withDoneDocRow = replaceRiskRow(
      riskText,
      'M11',
      '| M11 | [6](phases/phase-6-bridges-lifecycle-network.md) | Apply-epoch gate for the lorebook watcher (+ epoch-bumping apply). | DONE |',
    )

    expect(collectGateProblems({ riskText: withDoneDocRow })).toContain(
      'M11: status mismatch (registry PLANNED, docs DONE)',
    )
  })

  it('self-proves duplicate and missing classification detection', () => {
    const duplicateH1 = [
      ...NO_ACTION,
      noAction('H1', 'Duplicate self-proof classification reason for H1.'),
    ]
    const missingH2 = SCHEDULED_FIXES.filter((entry) => entry.id !== 'H2')

    expect(collectGateProblems({ noAction: duplicateH1 })).toContain(
      'H1: classified 2 times (scheduled, no-action)',
    )
    expect(collectGateProblems({ scheduled: missingH2 })).toContain(
      'H2: missing classification bucket',
    )
  })

  it('self-proves scheduled/gated conflict detection against an in-memory active-risk doc', () => {
    const riskText = readDoc(RISK_DOC)
    const withScheduledL12 = replaceRiskRow(
      riskText,
      'L12',
      '| L12 | [3](phases/phase-3-assembly-cbs-and-triggers.md) | Lua pool/boot serialization is the documented wasmoon constraint. | PENDING |',
    )

    expect(collectGateProblems({ riskText: withScheduledL12 })).toContain(
      'L12: doc schedules id but registry classifies it as gated',
    )
  })
})
