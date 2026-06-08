# Stability And Performance Audit V3

Date: 2026-06-06.

This is the third broad stability/performance audit of the Fastify-only RisuAI
codebase. It follows the v1 audit (2026-06-04) and the v2 audit (2026-06-05) —
both archived with their full remediation waves at
`docs/archive/audit-stability-and-performance/` and
`docs/archive/audit-stability-and-performance-v2/` — and the complete v2 fix
wave (phases 0-9, commits `653f8c57..ad07004ba`, all 102 v2 scheduled findings
`DONE`). The app still shows performance and stability issues in real use, so
this audit re-examines the post-v2 codebase: fresh gaps neither audit covered,
"ring 3" residuals where a landed fix pattern was applied asymmetrically,
regressions introduced by the v2 wave itself, and — with extra weight — costs
that fire on routine user actions.

The code is the source of truth. Every finding was located in current code at
commit `ad07004ba` and adversarially re-verified against it. Line numbers will
drift; symbol names are the durable anchors. IDs in this document (H/M/L/I)
are v3-scoped; prior-audit items are referenced as `v1-*` / `v2-*`.

## Scope And Context

- Deployment model: single-user self-host. Crashes, data loss/corruption,
  hangs (UI or server), and hot-path work that scales with corpus size are
  serious; multi-tenant-only concerns are not.
- Not released, no real users. DB migrations out of scope; normal-use data
  loss/corruption in scope.
- All v1 and v2 scheduled fixes were re-verified as present. v1/v2 gated items
  (`v2-L12`, `v1-L4`, `v1-L7`, `v1-L26`, `v1-U2`), the `leftover.md` evidence
  gates, the v2 no-action inventory (I1-I18), and the dismissed sets (v2
  R1-R13) were respected: candidates matching them were classified as
  known-item overlaps, not new findings (see
  [Known-Item Overlaps](#known-item-overlaps)).
- Tree health at audit time: clean tree at `ad07004ba`; both
  project-reference TypeScript checks pass (`tsc -p tsconfig.client-lib.json`;
  `tsc -p server/fastify/tsconfig.json --noEmit`).

## Method

Multi-agent audit, 206 agents across three orchestrated rounds:

- Round 1: 23 parallel finders — 19 subsystem finders (server: generation
  lifecycle, prompt assembly, lorebook/CBS, triggers/Lua, persistence core,
  command routes, projection/events/app, memory, import/export,
  providers/outbound; client: state/storage, bridges/bootstrap,
  send/streaming, render/parse, UI components, triggers/scripting,
  plugins/MCP, opt-in media/files, client memory/embeddings), 3 v2 fix-wave
  regression reviewers (phases 1-3, 4-6, 7-8), and 1 cross-cutting
  lifecycle/concurrency sweep. Every in-scope file read in full; every
  candidate traced to a live caller on the Fastify-only runtime. (The ten
  server finders' first run was lost to transient API errors and re-run
  identically as a second workflow.)
- Every unique candidate was adversarially verified: high/medium claims by
  three independent lenses (liveness/reachability,
  novelty-vs-existing-mitigation, severity calibration for single-user
  self-host), low/info claims by a lone skeptic instructed to refute.
  Majority verdicts; severity is the calibrated median, frequently lower than
  the finder's claim.
- Round 3: a completeness critic compared the realized coverage against the
  repo and proposed seven blind-spot sweeps that no per-file finder could
  have caught: unswept live server containers (`commands/mutations.ts`, the
  unnamed generation adapters, loadouts/personas/prompts validators), Svelte 5
  runes/reactivity misuse as a modality, the optimistic-write
  rollback/suppression state machine walked bridge-by-bridge across all six
  bridges, the live client dispatch seam, memory per-send cost, build and
  transport runtime cost, and hot-path error-path/throw UX. Their candidates
  went through the same dedup + verification.

Raw counts: 109 candidates (56 round 1 + 30 server re-run + 23 round 3) →
after cross-finder and cross-round dedup: 100 unique → **89 confirmed**
(1 high, 9 medium, 56 low, 23 informational), 6 classified as overlaps of
known v1/v2/leftover items (two with a re-open recommendation), 5 dismissed.
The dismissed and known-overlap candidates are recorded at the end so they are
not re-opened or re-reported as new.

## Cross-Cutting Themes

Most findings are instances of nine patterns. Fix the pattern when practical.

1. **The user-send path still pays O(transcript) and O(corpus) costs on both
   sides.** The hottest routine action — sending a message — deep-clones the
   active transcript three times on the UI thread and uploads the whole
   transcript instead of POSTing the one appended message (M4), deep-clones
   the entire character row (all hydrated chats) to be able to roll back one
   `lastInteraction` timestamp (M5), and, for trigger/editinput users, pays a
   whole-corpus `loadPersisted` inside the write transaction because
   `persistAssemblyMutations` never got the `chatScopedRead` its sibling
   `persistServerGenerationResult` received in v2-K1 (M1). Per-send
   server-side amplifiers: `runTrigger` re-clones the full transcript once per
   trigger phase (L8), `reformatMessages` deep-clones the assembled prompt
   (with inline base64 multimodals) even when no reformatting applies (L3),
   and in-context asset bytes are read with `fs.readFileSync` + sync base64 on
   the event loop (L1).

2. **The scoped-read / targeted-write pattern has a third ring on the command
   surface.** `applyTargetedCommandMutation` defaults to the broad
   `loadPersisted` whenever a route supplies no scoped read, and a whole
   family of routes never did: settings/prompt-settings PATCH (M3), every
   collection family (presets/personas/loadouts/plugins/global-lorebooks/
   translator-presets, L11), single-key plugin storage that never reads the
   database at all (`skipDatabaseLoad` exists and is unused, L13), the global
   lorebook and script/trigger routes additionally run full-corpus
   validate-only normalization that is discarded (L12), and the single-row
   `loadCharacterLorebookHydration` ignores the scoped `getCharacterRowsByIds`
   its bulk sibling uses (L14).

3. **Cancel/terminal-state correctness and deadline coverage.** The one high:
   when a streaming provider is aborted, every adapter silently `return`s, the
   transport's post-loop fallthrough emits a spurious success `done` and runs
   the full success post-generation pipeline (output triggers + scriptstate
   persistence) over the truncated text (H1). Around it: normal shutdown
   never runs the carefully-built `onClose` teardown because no signal handler
   exists (M9), a mid-stream cancel on the local-network proxy path never
   DELETEs the server job (L56), the standalone `/generate/completion`
   streaming path and the proxy stream jobs never received the v2-L1 sliding
   deadline (L2, L5), memory worker provider fetches thread an
   `AbortController` that no timer ever arms (L16), and Realm import egress
   has neither deadline nor client-disconnect abort (L17).

4. **The optimistic-write state machine is sound in some bridges and broken
   in their siblings.** No bridge flushes pending debounced writes on page
   unload — there is no `pagehide`/`beforeunload` handler or `keepalive`
   anywhere, so type-then-close loses the last edit burst (M8). The
   suppression/rollback invariants are asymmetric: the settings apply path
   double-dispatches every theme/color change and re-dispatches on conflict
   (L23), global-lorebook rename rollback is un-suppressed (L24),
   chat-metadata rollback re-dispatches (L26), prompt-template debounce
   captures an intermediate baseline (L25), the lorebook entry debounce reuses
   the first entry's snapshot for a second entry (L27), and preset commands
   have no rollback at all (L21).

5. **The read-only projection guard silently broke legacy direct-write
   features.** Any pre-guard code that writes `DBState.db` outside
   `withTrustedServerProjectionWrite` now throws at runtime. Live casualties:
   IGP appends throw on every send when configured (L34), the
   `inlayErrorResponse` accessibility feature always falls back to the modal
   it is meant to replace (L35), `.po` file attach throws (L36), and the
   `@@inject` display-script action is a silent no-op (I20). The global
   error/rejection handlers themselves throw on null/undefined payloads
   (L37, I21). These need both the guard wrap and a persistence command — and
   a sweep for remaining unguarded writes.

6. **Reactive amplification through the projection proxy re-mint.** Every
   guarded optimistic write reassigns `DBState.db` to a fresh proxy by design
   (I19), so every `$effect`/`$derived` that reads broad state re-runs per
   keystroke/write. Consumers that do collection-sized work per fire turn
   this into real cost: the character-scope lorebook watcher re-stringifies
   every chat's `localLore` per lorebook keystroke (L28), the chat-metadata
   watcher rebuilds a cloned per-chat scalar Map on every guarded write —
   including ~60×/sec during streaming render frames (L29), the
   character-editor draft re-clones and double-stringifies all ~46 picked
   fields per keystroke (L22), and the default character-catalog tab re-sorts
   the corpus from a template call the v2-L42 fix never reached (M6).

7. **The Hypa V3 memory budget is silently dead.** Server summaries (and
   legacy-imported ones) persist with `tokens: 0`, and the live selection call
   supplies no `getSummaryTokenCost`, so every per-category budget check
   compares against zero: all accumulated non-important summaries are
   injected into every memory-enabled prompt as non-removable rows,
   defeating `memoryTokensRatio` and crowding out the transcript — up to a
   hard `overflow` send abort (M2). Adjacent: the planner re-tokenizes the
   immutable summarized prefix every send (L15), and the selection path
   decodes every embedding blob per send only to discard the vectors (the
   re-opened R5 overlap; see Known-Item Overlaps).

8. **Hygiene ring 3 in the opt-in subsystems.** The v2 phase-7 patterns were
   applied to the surveyed sites only: console payload logs survive in
   image-gen (L50), the LLM translator (I17), GPT-SoVITS/FishSpeech TTS
   (I16), and the V3 plugin RPC host (L44); `AudioContext`s leak per call in
   the local-VITS path the M18 fix explicitly (and wrongly) excluded (L52)
   and in Playground subtitles (L55); object URLs go un-revoked at six+ sites
   (L51, I13, I14); unbounded module-level caches persist where siblings got
   LRU caps (L41, L42, L47, I8, I9, I15); and the client trigger/Lua
   interpreters never received the server's v2-H1 budget/abort caps
   (L38, L39).

9. **Transport and build defaults leave easy wins unclaimed.** No HTTP
   compression is registered, so the corpus-sized bootstrap JSON ships raw on
   every page load and reconnect resync (~3× gzip measured on the reference
   DB, L19); content-hashed SPA chunks are served `max-age=0` and revalidated
   per load instead of immutable-cached (L20); production images ship 74 MB
   of sourcemaps (I22).

## Findings Index

| ID | Sev | Cat | Area | Title |
| -- | --- | --- | ---- | ----- |
| H1 | High | both | server | Streaming-provider abort falls through to a spurious success `done` — a cancelled generation is persisted and post-processed as a normal completion |
| M1 | Med | perf | server | Send-persistence (`persistAssemblyMutations`) pays a whole-corpus `loadPersisted` for trigger/editinput sends — the v2-K1 `chatScopedRead` was not applied to this sibling |
| M2 | Med | both | server | Memory token budget is never enforced on real sends — summaries persist with `tokens: 0`, so every accumulated summary is injected into every memory-enabled prompt |
| M3 | Med | perf | server | Settings command routes parse the whole character corpus for a settings-only mutation (asymmetric with the landed v2-L3 settings-only loader) |
| M4 | Med | perf | cross | Sending a message clones the active transcript 3× and PUTs the whole chat instead of appending one message |
| M5 | Med | perf | client | Every send deep-clones the whole active character row (all hydrated chats) to roll back a `lastInteraction` timestamp |
| M6 | Med | perf | client | The default character-catalog tab re-sorts the full corpus from a template call — the v2-L42 fix never reached `MobileCharacters` |
| M7 | Med | stab | client | V3 plugin `SandboxHost` leaks a permanent window `message` listener on every plugin (re)load — `terminate()` cannot remove it |
| M8 | Med | stab | client | Debounced bridge writes and in-flight command fetches are silently dropped on page unload — no flush, no `keepalive`/`sendBeacon` |
| M9 | Med | stab | server | No SIGTERM/SIGINT handler: `app.close()`/`onClose` never runs on normal shutdown, so the runner-settle + `db.close` teardown is unreachable outside tests |

56 low-severity findings follow in [Low-Severity Findings](#low-severity-findings);
23 informational findings in [Informational Findings](#informational-findings).

---

## High-Severity Findings

### H1 — Streaming-provider abort falls through to a spurious success `done`

- Category: both · Area: server
- Location: `server/fastify/src/prompt/providerTransport.ts:120`
  (`emitProviderChunks`, post-loop fallthrough); adapters e.g.
  `generation/openai.ts:310/:314-318/:365`, `anthropic.ts:285/:289-293`;
  durable consumer `routes/generationChat.ts:1667-1733`.

What. `emitProviderChunks` returns `{status:'aborted'}` from only three
places: the pre-loop guard, an in-loop check that runs only when a frame is
pulled, and the catch block. Every streaming adapter (`runOpenAIStream`,
`runAnthropicStream`, `runGeminiStream`, `runMistralStream`, `runOllamaStream`,
`runEchoStream`) handles abort by **silently `return`ing** without yielding a
terminal frame — and the non-streaming `resultFrames` path
(`chatDispatch.ts:672`) does the same. A silent generator return ends the
transport's `for await` without executing the loop body and without throwing,
so control falls to `await emitSuccessDone()`: a `{type:'done', result, ...}`
frame is emitted AND `postGeneration(result)` runs over the partial
accumulated text, returning `{status:'done'}`. The durable route's own comment
(`generationChat.ts:1728-1730`: "`emitProviderChunks` emits nothing on
abort") documents the exact contract this violates.

Impact / trigger. On the live runtime the trigger is the durable path's
explicit cancel (`DELETE /api/v1/generate/chat/:id` →
`job.abortController.abort()`) or the sliding-deadline abort, in the common
case where the abort lands while the transport is suspended awaiting the next
token. Because `transportResult.status` is `done` rather than `aborted`, the
dedicated abort-recovery branch (`persistRawCancelledResult` + clean terminal
frame) is skipped; instead `buildDurablePostGeneration` runs the full SUCCESS
persistence pipeline — output triggers, scriptstate/chat-var mutation
persistence, server-owned message write — over the truncated turn, and the
client receives a success `done`. Verifier calibration: both paths persist the
same partial text, so the corruption is of *derived* state (output triggers /
scriptstate computed from a truncated turn, success-shaped terminal frame and
`generationInfo`), not loss of the partial text itself; the inline
`streamAssembly` arm is dead on the live runtime (the real client always sends
`durable: true`, gate item R1), and the in-loop abort check can still win a
narrow race when the abort lands exactly between two yielded frames — so it is
the common-case cancel outcome, not literally 100%.

Fix. Guard the post-loop fallthrough: before `emitSuccessDone()` add
`if (signal?.aborted) return { status: 'aborted', result }`, and re-check the
signal immediately before the in-loop terminal emit to close the race. This
restores the documented "emits nothing on abort" contract both routes depend
on. Add a durable-cancel test that asserts no success `done` and no output
trigger run on abort.

---

## Medium-Severity Findings

### Server — persistence / commands / memory

### M1 — `persistAssemblyMutations` pays a whole-corpus `loadPersisted` for trigger/editinput sends

- perf · server · `server/fastify/src/routes/generationChat.ts:556`
  (`persistAssemblyMutations` → `applyTargetedCommandMutation` with no
  `chatScopedRead`); loader fallthrough `commands/mutations.ts:187-193`;
  contrast `generationChat.ts:1234` (`persistServerGenerationResult`, the
  v2-K1 fix). Residual sibling of `v2-K1`.

`persistAssemblyMutations` calls `applyTargetedCommandMutation` without
`chatScopedRead`, so the loader falls through to the broad `loadPersisted`:
every character row + every (message-free) chat row JSON-parsed, all nine
collection tables, and the full asset-metadata table — inside the
`BEGIN IMMEDIATE` transaction holding the write lock — when the `mutate`
callback only needs `requireChatLocation` to find one chat's parent
`character.chaId` and then writes messages through targeted writers. The
directly comparable sibling `persistServerGenerationResult` sets
`chatScopedRead: hasScriptstateWrite ? undefined : { chatId }` (v2-K1).
Frequency calibration: plain trigger-less sends early-return at `:531` and pay
nothing; the broad load fires when `submitTranscriptChanged` is set
(`inputTriggerRewroteTranscript || editInputTransformed`) without a chat-var
write — per-send for input-trigger/editinput users, never for others. Fix.
Mirror K1: `chatScopedRead: hasVarWrite ? undefined : { chatId }`. One new
reliance: this path uses `parentId: character.chaId` (K1's sibling uses
`args.chatId`), so the fix's test should assert the `messages.replaced` event
parentId equals the character id through the scoped loader.

### M2 — Memory token budget is never enforced on real sends (`tokens: 0` summaries)

- both · server · `server/fastify/src/memorySummaryAdapter.ts:49`
  (`summarizeOnce` returns `tokens: 0`) → `memorySummarizeJobHandler.ts:233/:400`
  (persists it) and `memoryLegacyImport.ts:120` (legacy import also persists
  `tokens: 0`); allocator `memoryBudgetAllocator.ts:86/:332-334`
  (`defaultSummaryTokenCost = summary.tokens`); live call
  `prompt/assemble.ts:1322-1335` (`selectPromptMemory` with NO
  `getSummaryTokenCost`).

Every Hypa V3 summary row in the database carries `tokens = 0` (server
summarize and legacy import both persist it; nothing ever recomputes it), and
the live selection call supplies no `getSummaryTokenCost`, so the allocator's
per-category checks compare `0` against the budget and never break: the
`recent` category alone selects EVERY non-important summary (`similar` is
independently inert — the live wiring passes empty query vectors). The
`availableTokens` budget (`floor(maxContext × memoryTokensRatio)`) and the
recent/similar ratio settings are silently ineffective. Verifier
sharpening: the injected rows carry `memo: 'hypaMemory'` and are therefore NOT
`removable` in `finalizeRequestBudget` — over-injected memory displaces
removable history rows and, when those run out, forces a hard
`stopSending`/`abortReason='overflow'`; in the under-budget case all summaries
flow into the final prompt uncapped (prompt bloat + cost). Fires on every
memory-enabled send (`db.hypaV3 && char.supaMemory` + configured models).
Fix. Supply a `getSummaryTokenCost` in the `assemble.ts` `selectPromptMemory`
call that tiktoken-counts `summary.text` when `summary.tokens === 0` — the
plumbing (`PromptMemoryAdapterInput` → `MemorySelectionInput` → allocator)
already exists end-to-end, and this also repairs already-persisted rows
without a migration. Optionally also measure tokens at persist time.

### M3 — Settings command routes parse the whole character corpus for a settings-only mutation

- perf · server · `server/fastify/src/routes/commands.ts:1189`
  (`PATCH /commands/settings/:group`) and `:1602`
  (`PATCH /commands/prompt-settings`); loader `commands/mutations.ts:187-193`;
  contrast `routes/generation.ts:1257` (`loadServerIntentCompletionSettings`,
  the landed v2-L3 settings-only loader).

Both routes use `applyTargetedCommandMutation` with no scoped read, so each
settings flush runs the broad `loadPersisted` — every character and
(message-free) chat row parsed, all nine collection tables, asset metadata —
and then `extractSettings` discards all of it: only the settings row is
written. The settings bridge debounces at 250 ms but flushes routinely
(theme/slider/toggle edits, loadout loads, plugin/MCP settings writes), so
per-flush server CPU scales with corpus size for a scalar write. The exact
settings-only read already landed for the sibling server-intent path (v2-L3);
the command mutation path never got the equivalent. Verifier nuance: the
memory group's `hypaV3Presets` co-write reads the PATCHED value (written by
`applySettingsPatch` before the co-write), so a settings-only scoped read is
sufficient — pre-loading the collection table is optional belt-and-braces.
Fix. Add a settings-scoped read branch (or `applySettingsCommandMutation`)
that loads only `loadSettingsFromSqlite(db)` with the broad fallback on the
pre-extraction edge; reuse the `COLLECTION_TABLE_MAP` field-loader machinery
rather than building a new loader (it needs extending to carry assets for the
mutation contract).

### Client / cross — send path and render

### M4 — Sending a message clones the active transcript 3× and PUTs the whole chat

- perf · cross · `src/lib/ChatScreens/DefaultChatScreen.svelte:216-283`
  (send handler) → `src/ts/chatCommands.ts:143`
  (`currentChatScopedSnapshot` clone #1), `DefaultChatScreen.svelte:219`
  (clone #2),
  `:859-876`/`:982-984` (`dispatchReplaceMessagesWith` → per-row
  `toMessageSnapshot` clone #3) → `src/ts/server/commands.ts:2166`
  (`replaceMessagesCommand`, full-transcript PUT).

The live send handler, per send: (1) snapshots the whole active chat including
its full `message[]` for rollback, (2) clones the message array again to
append ONE user message, (3) dispatches `dispatchReplaceMessagesScoped`, which
clones every row a third time and PUTs the ENTIRE serialized transcript to
`/chats/:id/messages`. All three clones are `JSON.parse(JSON.stringify(...))`
on the UI thread, and the request body serializes the whole transcript — per
send, scaling with chat length. Verifier corrections: the server side is NOT a
full row replace — `applyChatMessageDiff` computes the common prefix and for a
plain append INSERTs exactly one row — but the server still re-reads and
JSON-parses all existing rows and parses/validates the full uploaded body per
send, so the O(transcript) cost is real on both halves with the client
dominating. The O(1) alternative already exists and is wired elsewhere:
`appendMessageCommand` (single-message POST), `dispatchAppendMessage`, and the
purpose-built `appendCurrentChatUserMessageForSend` (used by the DevTool
autopilot, not the live send). Fix. Route plain appends through the
single-message append fast-path with an id-keyed remove-on-failure rollback;
keep the replace path only for transcripts an input trigger actually rewrote.
This is the strongest single candidate for felt send latency growing with
chat length.

### M5 — Every send deep-clones the whole character row to roll back `lastInteraction`

- perf · client · `src/ts/process/sendChatContext.ts:97`
  (`setupSendChatContext`) → `src/ts/characterCommands.ts:126`
  (`currentCharacterRowSnapshot`) → `:52` (`cloneJsonValue`).

On every send, `setupSendChatContext` unconditionally captures
`currentCharacterRowSnapshot(selectedChar)` — a full
`JSON.parse(JSON.stringify())` of the entire character row, which includes the
active chat's fully hydrated `message[]` and any sibling chats hydrated via
the bulk endpoint. The snapshot exists to roll back an
`updateCharacterCommand({ patch: { lastInteraction } })` and, only on the
first send, a message-id backfill; after that the full-transcript clone is
paid purely to be able to undo a timestamp. The earlier clone-narrowing waves
narrowed this from the whole `characters` array to one row but never to field
level.
Verifier calibration: in steady state only the active chat is hydrated, the
clone is ms-scale for typical chats (one lens rated it low) — but it precedes
M4's three clones on the same action, and the costs compound. Fix. Capture a
field-scoped snapshot (`{ lastInteraction }` plus, on the backfill branch
only, the pre-mutation `message[]`), mirroring the existing
`CharacterSelectionSnapshot`/`restoreCharacterSelection` template in the same
file; adjust `restoreCharacterRow` accordingly.

### M6 — Default catalog tab re-sorts the full character corpus per render

- perf · client · `src/lib/Mobile/MobileCharacters.svelte:79`
  (`{#each sortChar(DBState.db.characters) ...}` template call, not
  `$derived`), `:53-75` (`sortChar`), `:24-51` (`makeAgoText`), `:80`
  (per-item `normalizeSearch`); delegated from
  `src/lib/Others/GridCatalog.svelte:260` with default tab `selected === 3`
  (`:78`); also the mobile home list (`MobileBody.svelte:65`). Residual of
  `v2-L42` (the fix memoized GridCatalog's own lists only).

`sortChar` runs `map → filter → map (Intl.RelativeTimeFormat.format per
interacted character) → sort` over the entire corpus as a plain template call,
so it re-runs on every reactive render of the screen — on open and on any
corpus field mutation (`lastInteraction`/`chats`/`name`/`image` changes, e.g.
after every send) while the catalog or mobile home list is mounted. Verifier
calibration: search keystrokes re-run only the cheap per-item
`normalizeSearch` test (the each-expression does not depend on the search
term), so the expensive re-sort is render/mutation-driven rather than
per-keystroke — one lens rated the net impact low, but the majority kept
medium because this is the DEFAULT catalog tab and the exact shape v2-L42 was
filed to remove. Fix. `$derived` the formatted+sorted list with a keyed each,
mirroring `formatGridCatalogCharacterLists`/`sortModuleSettingsRows` (and
their gate tests).

### Client — lifecycle / plugins

### M7 — V3 plugin `SandboxHost` leaks a permanent window `message` listener per (re)load

- stab · client · `src/ts/plugins/apiV3/factory.ts:586` (`run()` adds the
  listener; the returned cleanup closure is discarded at
  `v3.svelte.ts:1474`), `:627` (`terminate()` removes the iframe but cannot
  reach `messageHandler`).

`SandboxHost.run()` registers a window `message` listener and returns a
cleanup closure; `executePluginV3` discards it, and `terminate()` (the only
teardown) removes the iframe and clears the registries but never removes the
listener — `messageHandler` is a closure local to `run()`. Every plugin
enable/disable toggle, delete, import, update, and dev-mode hot-reload save
runs `loadPlugins()` → unload-all → re-execute, leaking one listener (which
retains the SandboxHost, apiFactory, and detached iframe graph) per V3 plugin
per cycle. Verifier calibration: stale handlers exit at the first
`event.source !== this.iframe.contentWindow` guard, so the per-message CPU is
a cheap comparison — the real harm is unbounded retained-memory growth per
plugin-management action (and per file save under hot-reload, which
early-returns on unchanged `lastModified`, not per 500 ms tick). Fix. Store
the cleanup closure on the instance (or make `messageHandler` an instance
field) and invoke it from `terminate()`.

### M8 — Debounced bridge writes are silently dropped on page unload

- stab · client · `src/ts/server/settingsBridge.svelte.ts:198`,
  `characterBridge.svelte.ts:188`, `chatBridge.svelte.ts:166`,
  `lorebookBridge.svelte.ts:957` (debounce timers); dispatch
  `src/ts/server/commands.ts:2252` (plain `fetch`, no `keepalive`).

Every server-backed edit bridge debounces its command dispatch behind a
250-300 ms timer holding the pending patch in module state. There is no
`beforeunload`/`pagehide`/`visibilitychange` handler anywhere in `src/`, no
`keepalive` fetch, and no `sendBeacon`; an in-flight POST is also aborted by
document discard. Closing/reloading the tab within the debounce window (or
during the POST) loses the last edit burst — and because there is no client
persistence (projection bootstraps from the server), the optimistic local
copy is gone too. Verifier calibration: previously-flushed edits are safe and
the lorebook editor flushes on blur/settle, so the loss is bounded to the
final 250-300 ms burst + RTT — normal-use data loss (in scope), narrow
window. Component unmount likewise drops pending timers. Fix. A
`flushAllPendingBridgePatches()` aggregator invoked from one
`pagehide`/`visibilitychange(hidden)` handler (and from watcher teardown),
dispatching through `fetch(..., { keepalive: true })`.

### M9 — No SIGTERM/SIGINT handler: the `onClose` teardown is unreachable on real shutdowns

- stab · server · `server/fastify/src/index.ts:3` (`main` registers no signal
  handlers) vs `app.ts:200-216` (the `onClose` hook: worker stop, timer
  clears, job aborts, `settleRunners()`, `db.close()`).

All teardown lives in the Fastify `onClose` hook, which only fires on
`app.close()` — and nothing ever calls it: `docker stop`, `docker compose
restart`, Ctrl-C, and the flag dev-runner's SIGTERM all kill the process
before any cleanup. The deliberately-built v2-L13 ordering ("settle runners
before closing the SQLite handle") is only ever exercised by tests. Verifier
calibration: WAL + `synchronous=NORMAL` makes an abrupt kill crash-safe for
committed data, and the un-stopped timers are moot on process death — the
genuine loss is the streamed-so-far partial of any durable generation in
flight at shutdown (`persistRawCancelledResult` never runs), recoverable by
regenerating; hence medium, not high. Fix. In `index.ts`, register
`process.once('SIGTERM'|'SIGINT')` handlers that `await app.close()` (with a
force-exit timeout backstop) and exit — making the existing, correct teardown
actually run on the path it was designed for.

---

## Low-Severity Findings

56 confirmed low-severity findings. Bounded, infrequent, or latent under
single-user self-host, but real and actionable. Grouped by area; the location
is the durable anchor. Titles incorporate verifier corrections.
[v2-*]/[v1-*] = residual adjacent to a landed prior fix.

### Server — generation / dispatch / providers

| ID | Title | Location |
| -- | ----- | -------- |
| L1 | Assembly-time asset reads use synchronous `fs.readFileSync` + sync base64 on the event loop, per distinct in-context image per send (the serving route streams; this hotter path blocks) | `routes/generationChat.ts:305-325` (`readStoredAsset`); consumers `prompt/assetLookup.ts:111-127`, `prompt/history.ts:241/:268` |
| L2 | Standalone `/generate/completion` streaming path keeps a fixed 600 s deadline — `pipeStream` never calls `refresh()`, unlike the /chat route's sliding deadline; live exposure is streaming Lua `LLM()` calls (translate/memory callers are buffered and unaffected) [v2-L1] | `routes/generation.ts:379-395` (`pipeStream`); `requestAbort.ts:29-58` |
| L3 | `reformatMessages` `structuredClone`s the entire assembled prompt (with inline base64 multimodals) on every send even when no reformat branch runs (the dominant OpenAI-flag path) — one extra full traversal on top of wire serialization | `prompt/chatDispatch.ts:358` |
| L4 | Horde cleanup DELETE (`fireDeleteJob`) has no abort signal or timeout — one socket held up to undici defaults per cancelled/timed-out Horde job | `generation/horde.ts:173` |
| L5 | Proxy stream-jobs never got the v2-L1 sliding deadline: an actively-streaming browser-local model via the proxy job is hard-killed at the fixed default 600 s (`slidingDeadline`/`refreshDeadline` exist and are unused here) [v2-L1] | `routes/streamJobs.ts:164` (`registry.create`); `streamJobs.ts:295/:415` |

### Server — prompt assembly / lorebook / triggers

| ID | Title | Location |
| -- | ----- | -------- |
| L6 | `processAssetPrompts` rebuilds the invariant char+module asset table once per history message (shallow concat; the same table is also built independently in `assetLookup.ts:108` — compute once per assembly) | `prompt/history.ts:264`; loop `:524-540` |
| L7 | `searchMatch` allocates a fresh combined depth-slice+recursive array per query inside the O(passes × entries × queries) activation loop (the v2-L5 hoist cached the slices but left this per-call concat) [v2-L5] | `prompt/lorebook.ts:387-389` |
| L8 | `runTrigger` `structuredClone`s the full working chat (whole transcript) per phase — input, start, and output each re-clone per triggered send; narrowing must be per-phase (phases legitimately see different transcripts), e.g. skip the clone for trigger sets with no message-mutating effect kinds [v2-L7] | `prompt/triggers.ts:601-607` |
| L9 | Trigger interpreter runs user-supplied RegExp synchronously with no per-effect bound — the wall-clock budget is checked only BETWEEN effects, so one catastrophic-backtracking pattern (in `v2RegexTest`/`v2ExtractRegex`, both in the display/request safeSubset, no `lowLevelAccess` gate) hangs the event loop; pattern, not transcript size, is the dominant factor [v2-H1] | `prompt/triggerDataEffects.ts:532/:214-218/:577-588`; `triggers.ts:548-559` |
| L10 | v2-M4 history-callback memo can serve a stale parse after a same-assembly chat-var write: `historyGeneration` bumps only on transcript mutations, and THREE chat-var-write sites never bump it (sticky-lorebook `writeChatVar`, the run-var `chatVarDirty` branch, the renderAndBudget Lua var fold) — `{{getvar}}` inside history then renders the pre-write value on the second reference [v2-M4 fix-introduced] | `src/ts/cbs.ts:226/:195`; `prompt/assemble.ts:963-966/:1081/:1580-1583` |

### Server — commands / persistence

| ID | Title | Location |
| -- | ----- | -------- |
| L11 | Collection command routes (presets, personas, loadouts, plugins, global lorebooks, translator presets) take the broad `loadPersisted` (full character+chat parse + all collections + asset metadata) to mutate one collection table — no collection-scoped read exists in the mutation pipeline; reuse the projection-side `COLLECTION_TABLE_MAP` loaders | `routes/commands.ts` collection routes (e.g. `:1232+`, `:1832+`, `:2330+`, `:4277+`); `commands/mutations.ts:187-193` |
| L12 | Global-lorebook and script/trigger-definition routes additionally run full-corpus validate-only normalization (`ensureAllChildLorebooks` / `ensureAllScriptDefinitionCollections`: per-entry `JSON.stringify` across every character/chat/module) whose result is discarded — even `POST /lorebooks/:id/select` (a settings-scalar write) re-validates the whole library | `routes/commands.ts:3701-3947/:4653-4776`; `commands/lorebooks.ts:78-102`; `commands/scriptDefinitions.ts:37-79` |
| L13 | Single-key plugin-storage PUT/DELETE pay the full-corpus `loadPersisted` although the mutate callbacks never read the database — `skipDatabaseLoad` exists for exactly this case (proven live at `realmImport.ts:624`) and is simply not set | `routes/commands.ts:4503/:4536` |
| L14 | `loadCharacterLorebookHydration` (single) does a whole-corpus `loadPersisted` + linear find while its bulk sibling uses the scoped `getCharacterRowsByIds` (`WHERE id IN`); live only behind the experimental `enableLorebookStubs` flag | `repository.ts:1580`; caller `routes/projection.ts:304` |

### Server — memory

| ID | Title | Location |
| -- | ----- | -------- |
| L15 | Hypa V3 planner re-runs full tiktoken BPE over the immutable already-summarized prefix on every memory-enabled send (`sumChatTokens(chats.slice(0, startIndex))`, unconditional when summaries exist; the per-window encode fires only in summarization mode); no per-row token memo exists anywhere | `memoryPlanner.ts:235`; driver `prompt/assemble.ts:1383` |
| L16 | Memory embed/summarize provider calls create an `AbortController` that no timer ever arms — a connected-but-silent endpoint parks the single-flight memory worker ~300 s (undici default) per attempt, re-stalling on each backoff retry; summarize's actual unbounded fetch site is `runOpenAI` | `memoryEmbedJobHandler.ts:247/:488`; `memorySummarizeJobHandler.ts:214` → `generation/openai.ts:165-185` |

### Server — import / transport

| ID | Title | Location |
| -- | ----- | -------- |
| L17 | Realm import upstream fetches have no wall-clock deadline or client-disconnect abort (both SSE and buffered branches): K serial per-asset hub fetches × up-to-300 s undici backstop each, and closing the client never cancels the work — `attachAbort`/`createHubAbort` model the fix | `routes/realmImport.ts:413-449/:1018-1024/:366-407/:167` |
| L18 | Realm JSON-card import buffers every fetched `kind:'resource'` asset in memory with no per-asset or cumulative cap (plus an unbounded `res.json()` body) — the charx branch got disk staging + the 50 MB per-asset cap (v2-L29); the JSON branch got none [v2-L29] | `routes/realmImport.ts:280-331/:935-952/:1023/:444` |
| L19 | No HTTP response compression registered (`@fastify/compress` is not a dependency; no `onSend` gzip): the corpus-sized bootstrap JSON (full card text for every character) and the static bundle ship raw on every page load and reconnect resync — ~3.1× gzip measured on the 10 MB reference DB; matters on non-loopback links | `app.ts:86-121`; `routes/bootstrap.ts:31-55` |
| L20 | SPA content-hashed JS/CSS chunks are served `Cache-Control: public, max-age=0` (fastifyStatic registered without `maxAge`/`immutable`), forcing a conditional revalidation per chunk per load; `index.html` stays correctly uncached via its separate handlers | `app.ts:312-317`; contrast `routes/assets.ts:22` (`IMMUTABLE_CACHE`) |

### Client — state / bridges / reactivity

| ID | Title | Location |
| -- | ----- | -------- |
| L21 | Preset optimistic writes have no rollback at all — `runPresetCommand`'s signature lacks the `rollback` parameter its chat/character/module siblings require; a failed preset command leaves `botPresets` AND the `setPreset` scalar settings (apiType, prompts, temperature, …) silently diverged | `src/ts/storage/database.svelte.ts:99-104` |
| L22 | Character-editor draft mirror `$effect` re-clones all ~46 picked fields and double-`JSON.stringify`s the whole draft on every content keystroke (the stringify deep-subscribes to every nested leaf, so nested edits re-fire it too) | `src/ts/server/characterBridge.svelte.ts:50-76` |
| L23 | `applyServerBackedSettingsPatch` is not suppressed from the settings watcher: every theme/color/custom-background change on the Display Settings page dispatches a redundant duplicate command, and a conflict rollback re-dispatches spuriously (the draft path has `suppressDraftDispatch`; the direct path has no equivalent) | `src/ts/server/settingsBridge.svelte.ts:99-125` vs `:144-172` |
| L24 | Global-lorebook rename rollback is un-suppressed: a conflicted rename emits an extra command that typically pushes the BASELINE name with a fresh revision — silently reverting the user's rename (the entry path's `rollbackServerBackedLorebooks` sets the suppression flag; `restoreLorebookState` does not) | `src/ts/server/lorebookBridge.svelte.ts:557/:570/:1075` |
| L25 | Prompt-template per-item debounce captures an INTERMEDIATE baseline (each keystroke overwrites `previousItem`), so a failed command rolls back to a mid-typing state — siblings keep the first baseline (`existing?.previous ?? previous`); realistic trigger is a transient command error, not a revision race | `src/lib/Setting/Pages/PromptSettings.svelte:207`; `src/lib/UI/PromptDataItem.svelte:49-64` |
| L26 | Chat-metadata rollback does not suppress its own re-dispatch (the suppressing helper exists but is wired only in tests; the live rollback is `restoreChatRowMetadata`) — a conflict re-sends the baseline and can oscillate under sustained conflict | `src/ts/server/chatBridge.svelte.ts:64/:246`; `src/ts/chatCommands.ts:238/:399` |
| L27 | Lorebook entry draft edits are keyed by collection scope, not entry: a second entry edited within the 250 ms window reuses the FIRST entry's rollback snapshot, so a failed coalesced replace reverts only one entry; reachable via focus-free toggles (per-entry `alwaysActive` on collapsed rows) which bypass the blur flush | `src/ts/server/lorebookBridge.svelte.ts:377/:924/:1023` |
| L28 | Character-scope lorebook watcher re-`JSON.stringify`s EVERY chat's `localLore` (resident, never stubbed) on every guarded projection write — i.e. per content keystroke while the lorebook panel is open; the fix must keep full-coverage (reference-keyed lazy snapshots), not drop non-open chats | `src/ts/server/lorebookBridge.svelte.ts:903/:913-915`; re-mint driver `projectionWriteGuard.svelte.ts:43` |
| L29 | Chat-metadata watcher rebuilds a full per-chat scalar Map (12 cloned keys per chat) on every guarded projection write app-wide — including per streaming render frame (~60×/sec) while a sidebar chat list is mounted; mounts share one ref-counted effect, so the fix is a cheap short-circuit, not de-duping mounts | `src/ts/server/chatBridge.svelte.ts:64-128`; hot driver `streamResponse.ts:114` |

### Client — render / parse

| ID | Title | Location |
| -- | ----- | -------- |
| L30 | ChatBody parse-memo key construction serializes the whole script/module/regex corpus per message — at least twice per render (detection key nests the parse key) — and on every reload-epoch bump it re-runs for every loaded message; on epoch bumps the parse itself re-runs too (key includes the epoch), so the pure-overhead case is epoch-unchanged re-renders; cache the corpus-derived signature by its cheap invalidation tokens [v2-L40/M17 fix-introduced] | `src/lib/ChatScreens/ChatBodyParseMemo.ts:181/:209`; `ChatBody.svelte:394` |
| L31 | customHTML theme re-parses the entire `guiHTML` template (`risuChatParser` + `DOMParser`) once per rendered message per render cycle — inline in the render expression, outside the parse memo; memoize per template version (its real invalidators are the `db.guiHTML`/cbs-condition reads, not `ReloadGUIPointer`) | `src/lib/ChatScreens/Chat.svelte:1624-1625/:378-384` |
| L32 | `bestMatchCache` is unbounded AND missing from `resetScriptCache()` — stale fuzzy asset matches survive definition changes while the sibling script/regex caches are capped at 1000 and reset; double-opt-in path (`dynamicAssets` + `dynamicAssetsEditDisplay`) | `src/ts/process/scripts.ts:85/:433-440` vs `:108-143` |
| L33 | Module-level `bgmElement` is never stopped on chat/character switch: old BGM keeps playing and — because the node stays in `observedControlNodes` while the create is guarded by `!bgmElement` — the NEW chat's BGM is suppressed for the session | `src/ts/observer.svelte.ts:84-92` |

### Client — read-only projection-guard breakage (error paths)

| ID | Title | Location |
| -- | ----- | -------- |
| L34 | `evaluateIgp` writes the live read-only projection directly: every send throws a `TypeError` modal when `igpPrompt` is set — reachable only via imported legacy DBs (no UI sets it), but then it breaks every send; the fix must wrap AND route through a chat command (and fix the I11 `[object Object]` coercion in the same change) | `src/ts/process/postGeneration/igp.ts:22-26`; caller `orchestrateResponse.ts:197` (outside the server-owned gate) |
| L35 | `inlayErrorResponse` (embed send errors into the chat instead of a modal) is a silent no-op: both mutations throw under the guard, are swallowed by the local try/catch, and always fall back to the modal; the existing test runs with the guard disabled, masking it | `src/ts/process/sendChatErrors.ts:44/:59` |
| L36 | `sendPofile` mutates the live projection directly (push + row assignments), so `.po` file attach throws; reachable via the Post File picker, whose async onclick is also un-try/caught | `src/ts/process/files/multisend.ts:43-48`; `DefaultChatScreen.svelte:1163` |
| L37 | Global window `error` handler dereferences `event.error.target`: throws on null `error` (cross-origin/CSP/resource events) discarding the original error, and the Worker-suppression guard tests the wrong object (`event.error.target` instead of `event.target`) so it never matches | `src/ts/bootstrap.ts:448-453` |

### Client — triggers / scripting / tokenizer

| ID | Title | Location |
| -- | ----- | -------- |
| L38 | Client trigger interpreter has no wall-clock/step/loop-back budget and no abort signal — the server port got all four in v2-H1; live exposure is `manual` mode only (`/trigger` command, in-message trigger buttons): a never-breaking `v2Loop` spins forever at ~100% CPU with cancel unable to stop it [v2-H1] | `src/ts/process/triggers.ts:1963-1997`; contrast `server/fastify/src/prompt/triggers.ts:306-409` |
| L39 | Client Lua VM has no instruction-count hook or deadline (the server runtime installs `lua_sethook` + wall-clock) — `while true do end` in any client Lua mode (editDisplay render path included) hard-freezes the tab [v2-H1-class] | `src/ts/process/scriptings.ts:104/:1065`; contrast `server/fastify/src/prompt/luaRuntime.ts` |
| L40 | Client Lua engine cache is keyed by mode only: 2+ distinct `triggerlua` bodies sharing a mode (char + module) thrash a full engine teardown/rebuild (~40 host-fn re-declares + doString) per parse-memo miss on the live editDisplay render path (editOutput is server-owned) | `src/ts/process/scriptings.ts:97-104/:1228-1257/:1445-1456` |
| L41 | `ScriptingEditDisplayIds` leaks one UUID per editDisplay Lua run — the cleanup tail deletes only the Safe/LowLevel sets; fires per distinct parse-memo key for Lua-trigger characters (streaming creates many); add the missing delete in a `finally` (the Python branch can skip cleanup entirely on rejection) | `src/ts/process/scriptings.ts:1073-1074` vs `:1176-1177` |
| L42 | `googleCloudTokenizedCache` is an unbounded Map keyed by full text (populated unconditionally, duplicating the LRU-capped `encodeCache` which only fills when `useTokenizerCaching` is on); opt-in path (`googleClaudeTokenizing` + GoogleCloud tokenizer) | `src/ts/tokenizer.ts:274/:281-312` vs `:19-21` |

### Client — plugins / MCP

| ID | Title | Location |
| -- | ----- | -------- |
| L43 | `customProviderStore` / `customV3ProviderMetaStore` accumulate duplicate provider entries on every plugin reload cycle (the `loadV2Plugin` reset block clears the Maps but omits these two arrays) — the model dropdown shows N copies after N toggles/imports/saves | `src/ts/plugins/apiV3/v3.svelte.ts:597/:720-766`; `plugins.svelte.ts:1211-1224` |
| L44 | SandboxHost RPC handler unconditionally `console.log`s full request + response (+ transferables) for every guest→host API call (CALL_ROOT/CALL_INSTANCE only — host→guest callbacks do not log); pre-existing dev residue, ungated [v2-L57-class] | `src/ts/plugins/apiV3/factory.ts:568-569` |
| L45 | `getTools()`/`initializeMCPs()` run on every `requestChatData` but the computed tool list is discarded on the always-server completion route — pure waste scaling with configured MCP modules; compute lazily in the browser-local adapters that consume it | `src/ts/process/request/request.ts:238`; `serverCompletion.ts:22-33/:145-154` |
| L46 | `initializeMCPs` check-then-await-then-assign double-constructs and leaks a remote MCP client (SSE stream + handshake) under concurrent `requestChatData`; store an in-flight construction promise per key (the `mcpToolClientIndexBuild` pattern) | `src/ts/process/mcp/mcp.ts:82-172` |
| L47 | `MCPClient.connectSSE` accumulates its buffer with no size cap on the persistent post-handshake connection (the v2-M20 timeout bounds only the initial response wait); the server-side reader got an 8 MB cap (v2-I7), the client got none | `src/ts/process/mcp/mcplib.ts:394-499` |
| L48 | MCP filesystem PDF read renders EVERY page to a full-resolution canvas with no page/byte cap, no abort, and an ignored `limit` argument — a large PDF hangs the tab in one burst; live via the Playground MCP tool surface | `src/ts/process/dynamicutils/pdf.ts:24`; `mcp/filesystemclient.ts:425` |

### Client — media / files / ML

| ID | Title | Location |
| -- | ----- | -------- |
| L49 | File-attach context builders never await `hypa.addText()` before `similaritySearch` — the query embed reliably wins the race against the un-awaited document batch, so the `<File>` block is built from an empty result: silent loss of attached-file context (live for `.txt`; `.pdf`/`.xml` need `allowAllExtentionFiles`); the sibling `emotionFallbackEmbedding`/`addinfo` builders await correctly | `src/ts/process/files/multisend.ts:127/:144/:165`; `memory/hypamemory.ts:177` |
| L50 | Image-generation paths log full payloads per send for imggen-mode characters: the multi-MB base64 result, the full DALL-E response, NAI request bodies (incl. base64 reference images), and a 1 s comfy poll-loop log — the v2-L52 console sweep never reached `stableDiff.ts` [v2-L52] | `src/ts/process/stableDiff.ts:105/:70/:377/:382/:426/:573` |
| L51 | Object URLs are never revoked at the image-processing sites: `postInlayAsset` (per chat image attach), `reencodeImage` (per non-PNG import), `CharXWriter.writeJpeg` (per charxJpeg export) — plus the same pattern at `scriptings.ts:402/:435`; each pins its Blob for the page lifetime | `src/ts/process/files/inlays.ts:173/:459`; `processzip.ts:89` |
| L52 | `runVITS` creates a fresh `AudioContext` per local-TTS playback and never closes it — after a handful of plays the browser cap is exhausted and TTS silently stops; the v2-M18 slice explicitly (and incorrectly) asserted VITS constructs no AudioContext; `decodeAudioData` also swallows decode errors (no error callback) [v2-M18] | `src/ts/process/transformers.ts:159`; contrast `tts.ts:27-36` (`getNetworkAudioContext`) |
| L53 | VITS synthesizer pipeline is not disposed on model switch (the sibling embedding extractor disposes before replacing) — one leaked ONNX session per model change | `src/ts/process/transformers.ts:139-153` vs `:84-86` |
| L54 | PDF documents are never destroyed after image conversion (`pdf.destroy()` missing) — each import pins the parsed document + font data in the pdf.js worker for the session (`extractPdfText` has the same shape but is currently dead) | `src/ts/process/dynamicutils/pdf.ts:21` |
| L55 | PlaygroundSubtitle whisper mode leaks an `AudioContext` per conversion (two sites) plus an unrevoked probe-video object URL — a few conversions exhaust the context cap and `decodeAudioData` starts failing until reload | `src/lib/Playground/PlaygroundSubtitle.svelte:184/:259/:169` |

### Cross — lifecycle

| ID | Title | Location |
| -- | ----- | -------- |
| L56 | Local-network proxy stream cancel never reaches the server: the abort listener (the only path issuing the job DELETE) is removed once headers arrive, so a mid-stream cancel leaves the server job draining the upstream to completion (slot held against the 64-job cap) | `src/ts/globalApi.svelte.ts:1218/:1236-1240` |

---

## Informational Findings

Real, verified, and worth recording, but below the low bar after calibration
(bounded cost, narrow trigger, or design-note status).

| ID | Title | Location |
| -- | ----- | -------- |
| I1 | Active-writer guard preHandler runs the (41-entry, method-pre-filtered, cached-regex) manifest scan on every request including reads/static — early-return on non-mutating methods | `server/fastify/src/activeWriter.ts:21-63`; `routeManifest.ts:660-677` |
| I2 | Bulk projection hydration accepts an unbounded (deduped) ids array and applies responses with an O(N·M) `find` loop — export/cold-storage readers only | `routes/projection.ts:151-165/:482`; `src/ts/server/chatMessageHydration.svelte.ts:123-133/:265-273` |
| I3 | Proxy copies the entire request body into a fresh `Uint8Array` before forwarding (defensive detach; bounded by the 100 MB bodyLimit; two live callers incl. `streamJobs.ts:466`) | `server/fastify/src/proxy.ts:112` |
| I4 | Generation finalization retry has no max-attempt cap or backoff and never prunes stuck `pending` rows (realistic non-terminal errors self-heal — baseRevision re-reads per retry; v2-L2 covered terminal retention only) | `routes/generationChat.ts:1350-1423`; `generationFinalizationRetry.ts:140-191` |
| I5 | JS trigger budget is recreated per phase (input/start/output ⇒ up to ~3×3 s per send) instead of one shared per-send budget like `luaExecBudget` | `prompt/triggers.ts:593-594`; `assemble.ts:574` |
| I6 | Summarize batch handler scans every character's chat-id stubs per job execution to verify one chatId (shared across the batch — verify once per batch or use an indexed `SELECT 1`) | `memorySummarizeJobHandler.ts:362-374` |
| I7 | Server prompt-assembly classifier (transcript regex scan + single-model clone + module-trigger list) runs twice per send (`sendChat` and `resolveDurableGeneration` both call `resolveServerPromptAssembly`; no memo) | `src/ts/process/index.svelte.ts:234`; `request/durableGeneration.ts:68` |
| I8 | `assetByteReadCounts` diagnostics Map accumulates per distinct asset id for the session, populated unconditionally even with metrics off — its snapshot has no live consumer outside tests | `src/ts/server/protocolDiagnostics.ts:69/:141`; `assets.ts:126` |
| I9 | `fetchLog` streaming path (`addFetchLog`) never trims while the JSON path caps at 20 — unbounded only in exclusively-streaming sessions (any `globalFetch` call trims the shared array) | `src/ts/globalApi.svelte.ts:455` vs `:578-580` |
| I10 | `addFetchLog` returns literal index 0 while entries are unshifted — `pipeFetchLog` can write a streamed response onto the wrong (debug-view) entry | `src/ts/globalApi.svelte.ts:455/:477/:1053-1059` |
| I11 | Shared tokenizer singletons (`tikParser`/`tokenizersTokenizer`) can be swapped between the staleness check and the final `.encode` by a concurrent tokenization of a different model — wrong counts in the race window (client only) | `src/ts/tokenizer.ts:269-272/:327-348/:379-447` |
| I12 | ModuleChatMenu filters+sorts all modules inline per keystroke — the v2-L43 memoization reached ModuleSettings only; transient overlay, module counts small [v2-L43] | `src/lib/Setting/Pages/Module/ModuleChatMenu.svelte:61/:21-32` |
| I13 | Code-block download creates an object URL that is never revoked (one per click; existing helpers model the revoke-after-timeout pattern) | `src/ts/observer.svelte.ts:48-53` |
| I14 | BotSettings preset-icon upload leaks one object URL per upload (same unrevoked Image-decode pattern as `inlays.ts:173/:459`, `scriptings.ts:402/:435`) | `src/lib/Setting/Pages/BotSettings.svelte:1577` |
| I15 | `hypaVector` embedding cache (IndexedDB) grows monotonically — one entry per distinct embedded string, no eviction/TTL; disk-backed, intentional cache | `src/ts/process/memory/hypamemory.ts:57/:214`; `hypamemoryv2.ts:36` |
| I16 | GPT-SoVITS / FishSpeech TTS branches log full request bodies and raw responses (audio buffers) per playback; `getElevenTTSVoices` logs too | `src/ts/process/tts.ts:434-468/:519-530/:587` |
| I17 | LLM translator logs `translatorNote` on every cache-missed translation call — the v2-M16 log sweep covered the Google/deeplX branches only [v2-M16] | `src/ts/translator/translator.ts:638/:646` |
| I18 | `templateCheck` re-scans the whole prompt template on every guarded projection write while Prompt Settings is mounted (reads broad `DBState.db`; v2-M13 explicitly deferred this) | `src/lib/Setting/Pages/PromptSettings.svelte:359`; `templates/templateCheck.ts:3` |
| I19 | Every guarded optimistic write re-mints the whole `DBState.db` proxy tree by design — the deliberate correctness mechanism that makes every broad-dependency `$effect`/`$derived` re-run per write; fix the per-consumer work (L22/L28/L29/I18), not the guard | `src/ts/server/projectionWriteGuard.svelte.ts:34-44/:86-97` |
| I20 | Display-script `@@inject` writes the guarded projection during render — the throw is swallowed by the per-script try/catch, so the directive is a silent no-op (marker not even stripped); server assembly port is unaffected | `src/ts/process/scripts.ts:267/:394-398` |
| I21 | `alertError` throws on `undefined` (and symbol) rejection reasons inside the global unhandledrejection handler — the alert is suppressed (console.error still fires) | `src/ts/alert.ts:50-69`; `bootstrap.ts:454-456` |
| I22 | Production builds ship full sourcemaps into the runtime image (74 MB of `.map`, incl. a 17 MB `ts.worker.js.map`) — image-size/exposure hygiene; not fetched at runtime | `package.json:11/:20`; `Dockerfile:26/:36` |
| I23 | Heavy libraries are correctly dynamic-imported (monaco/tiktoken/three/pyodide/transformers/pdfjs all lazy — eager-bundle hypothesis refuted), but no `manualChunks` means a ~3.5 MB eager app graph (1.3 MB entry + 1.6 MB database.svelte + 648 KB all-locale lang) parsed every load; split the lang chunk per locale | `vite.config.ts:40-44`; `dist/index.html` modulepreloads |

---

## Known-Item Overlaps

These 6 candidates were independently rediscovered and verified against
current code, but they are the same issues already tracked as v1/v2 findings,
gated items, or dismissed candidates. Listed with their disposition — with two
priority exceptions flagged first.

| Candidate | Known item | Sev | Disposition |
| --------- | ---------- | --- | ----------- |
| **Memory selection decodes every embedding `vector_blob` on every memory-enabled send and discards the vectors** — `listMemoryEmbeddings` maps every row through `decodeEmbeddingVector` (two byte copies + Float32Array per row), but the only live wiring passes `loadPromptMemoryQueryVectors: () => []`, so `rankMemorySummariesBySimilarity` never reads them; only `chunkId` is consumed (`memorySelectionService.ts:65`; `memoryRepository.ts:394/:343`; `generationChat.ts:369`) | `v2-R5` | Low | **Recommend re-opening with corrected reasoning.** R5's dismissal ("the live caller wires empty query vectors") explains why the *similarity math* doesn't run — but that is exactly why the unconditional per-row decode is pure waste, linear in summarized chunks per send. Skip the decode when no valid query vectors exist (or decode lazily). |
| **Proxy and hub routes verify the auth assertion twice per request** (onRequest hook + in-handler `requireAuth`, double ECDSA verify) — same bug class v2-L16 fixed on the bulk projection routes (`routes/proxy.ts:29-34`; `routes/hub.ts:197-203`) | `v2-L16` | Low | **Recommend propagating the L16 fix** to these sibling routes (drop the redundant in-handler verify). |
| `buildRestorationPayload` re-clones the provably-immutable `state.initialMessages` (full-transcript `structuredClone`) on every assembly, including the stopSending path (`prompt/assemble.ts:1009`) | `v2-M1` ring | Low | Same clone-narrowing class as the landed M1 dirty-flag work; safe to return the array by reference (set once in `beginAssembly`, never mutated). Fold into any future assembly-clone slice. |
| `stableDiff` NAI reference-image resize awaits `Image.onload` with no onerror/timeout — hard hang on a corrupt reference image (`process/stableDiff.ts:306`) | `v2-L49` | Low | The L49 fix was site-specific (`inlays.ts`); this is the un-swept sibling. Apply the same onerror+timeout guard (the codebase has both patterns). |
| `buildSearchableCorpus` eagerly computes both `wordData` and `compactData` per transcript message regardless of which match mode any entry uses (`prompt/lorebook.ts:251-259`) | `v2-L5` adjacent | Info | Once per assembly, one dead allocation per message; fold into any future lorebook touch. |
| Per-LLM-call `console.log('Trigger time', …)` on the `requestChatData` path (`request/request.ts:289`; adjacent `console.log(set)` at `:324`) | `v1-L38` closeout note | Info | Already documented as out-of-scope residue by the phase-7 completion audit; remove opportunistically. |

## Investigated And Dismissed

Verified not to be live issues by adversarial verification. Listed so they are
not re-opened without new evidence.

1. **`similaritySearchVectorWithScore` invalid sort comparator mis-orders
   results** — the comparator (`a>b ? -1 : 0`) violates the strict-weak-order
   contract on paper, but exhaustive empirical verification on V8/Node 24
   (hundreds of thousands of trials: all permutations ≤8, adversarial
   orderings, forced TimSort merges) produced byte-identical output to the
   correct comparator in every case, and the highest-impact consumer re-sorts
   with a correct comparator anyway. At most an info-grade portability nit.
2. **`pyworker` leaks a listener + pending promise per host-call error** —
   dead arm: `PyodideContext` is only constructed for `type === 'py'`, and
   every live `runScripted` caller resolves to `'lua'`; no Python entry point
   exists on this runtime (same class as v2-R11/R13).
3. **ChatBody parse memo serves stale `{{getvar}}` output (claimed v2-L40/M17
   regression)** — the variable is resolved BEFORE the memo: `displaya()`
   re-runs in `$effect.pre` on scriptstate changes and the resolved value
   rides into the memo key via `data`, so var changes produce a new key. The
   pre-memo `$derived` never tracked post-await reads either (async deriveds
   track only synchronous reads), so the claimed regression mechanism does not
   exist; the status-panel surface (`BackgroundDom`) is keyed on
   `VariableReloadGUIPointer` and unaffected.
4. **Buffered standalone completion handlers send no HTTP response when
   deadline-aborted** — structurally true of the per-provider buffered
   handlers, but those branches are unreachable from the live SPA: the sole
   client of `/generate/completion` always sends the server-intent kind,
   which short-circuits to `handleServerIntentCompletion` (which always
   replies). Dead arms on this runtime.
5. **Chat-FOLDER-row rollback un-suppressed (sibling of L26)** — the
   folder-row dispatch machinery has no live entry point: every reactive
   folder-scalar write in the UI is gated behind `!canUseServerCommands()`
   (always false here); the live folder edits use the broad dispatcher. The
   chat-ROW case (L26) is live; the folder twin is not.

## Relationship To Prior Workstreams And Gated Items

- All v1 and v2 scheduled fixes were re-verified as present; none regressed
  outright. The three fix-wave regression reviewers confirmed the v2 wave's
  fixes against their target-fix rows; the one claimed high-severity
  regression (parse-memo staleness) was dismissed on mechanism (above). What
  the wave did leave: scope exclusions and asymmetric application — L5/L2
  (sliding deadline applied to durable generation only), L16 (deadline work of
  phases 4/8 never reached the memory worker's provider fetches), L52 (the
  M18 AudioContext fix explicitly asserted VITS constructs none — false),
  L10 (the M4 memo's generation counter misses chat-var writes), L30 (the
  L40/M17 memo's own key construction is the new cost), L7 (the L5 hoist left
  a per-call concat), I12/I17 ([L43]/[M16] applied to one of two siblings),
  and M6 (v2-L42 never reached the default catalog tab).
- Gated items stay gated and were respected: `v2-L12`, `v1-L4`, `v1-L7`,
  `v1-L26`, `v1-U2`, and the `leftover.md` evidence gates. M1 is explicitly
  NOT under the `v1-L4` gate (it is the missing K1 scoped READ on the
  no-var-write branch; the var-write WRITE breadth remains gated), and M3/L11
  are NOT under `v1-L7` (these are reads on routes outside the four-route
  Tier-5 floor).
- Two prior dispositions deserve revision on new evidence: `v2-R5` (the
  dismissal reasoning is correct but incomplete — see Known-Item Overlaps)
  and the v2-L16 class (fixed on bulk projection, still present on
  proxy/hub).
- The round-3 critic's structural lesson mirrors v1→v2: the per-file sweeps
  could not see cross-cutting modalities. This round's equivalents of "the
  CBS interpreter" were the optimistic-write/rollback state machine walked
  bridge-by-bridge, Svelte 5 reactivity amplification, and the
  projection-guard error-path class — they account for most of the new
  client findings.

## Suggested Remediation Order

1. **H1** — one guard before the transport's post-loop `emitSuccessDone()`
   (+ the in-loop race re-check); restores the documented abort contract for
   every provider. Add a durable-cancel regression test.
2. **M4 + M5** — the client send path: append fast-path
   (`appendCurrentChatUserMessageForSend` is already built) + field-scoped
   rollback snapshot. Removes four O(transcript) clones and the
   full-transcript upload from the hottest action.
3. **M1** — wire `chatScopedRead` into `persistAssemblyMutations` (mirror
   K1, one line + test). Pair with **M3/L13** (settings-scoped read +
   `skipDatabaseLoad: true`) and then L11/L12/L14 as one
   command-surface-scoping slice.
4. **M2** — supply the `getSummaryTokenCost` fallback in `selectPromptMemory`
   (fixes new AND existing rows); pair with L15 (prefix token memo), L16
   (arm the already-threaded AbortController), and the R5 re-open (skip the
   dead embedding decode) as one memory slice.
5. **M9** — SIGTERM/SIGINT → `app.close()` with a force-exit backstop; pair
   with the deadline/cancel cluster: L5 (one flag), L2 (thread `refresh`),
   L56 (keep the abort listener armed), L17/L18 (realm bounds), L4.
6. **M8 + the bridge state machine** — one invariant pass over all six
   bridges: pagehide flush + `keepalive` (M8), suppression guards
   (L23, L24, L26), first-baseline retention (L25), entry-snapshot promotion
   (L27), preset rollback (L21).
7. **Projection-guard feature repairs** — L34/L35/L36/I20 (wrap + persist via
   scoped commands), L37/I21 (handler hardening); then add a guard-enabled
   test or static sweep so no direct `DBState.db` write outside
   `withTrustedServerProjectionWrite` survives unnoticed.
8. **Reactive-amplification consumers** — L29 (short-circuit; it fires per
   streaming frame), L28 (reference-keyed lazy snapshots), L22 (gate the
   draft mirror), M6 + I12/I18 ($derived + keyed each), L30/L31 (signature
   caching).
9. **M7** + hygiene batches by area as touched: console logs
   (L44/L50/I16/I17), AudioContext/object URLs (L51-L55/I13/I14), unbounded
   caches (L32/L41/L42/L43/L47/I8/I9), MCP/PDF caps (L46/L48), L1
   (async asset reads), L3/L8 (clone narrowing).
10. **Transport quick wins** — L19 (`@fastify/compress` or an onSend gzip
    hook), L20 (`maxAge: '1y', immutable: true` for hashed chunks), I22/I23
    at leisure.

## How To Reproduce / Verify

- Server stage timings: `RISU_PROTOCOL_METRICS=1`; M1/M3 show up directly in
  command-mutation timing (compare a trigger-rewriting send and a settings
  flush against corpus size); H1 reproduces by cancelling any durable
  streaming generation and inspecting the terminal frame + persisted
  scriptstate.
- Offline corpus cost: `pnpm analyze:db <input>` for corpus-scale estimates
  (L19's ~3.1× gzip figure was measured against the 10 MB reference DB).
- Client send cost (M4/M5): performance-profile a send on a long chat and
  watch `cloneJsonValue`/`JSON.stringify` self-time; the three clone sites
  and the PUT body serialize are all on the same stack.
- Reactive amplification (L28/L29/I19): type in a lorebook entry with the
  panel open, or profile during streaming with a sidebar mounted, and watch
  the watcher effects re-fire per write.
- Memory budget (M2): on a memory-enabled chat with accumulated summaries,
  inspect the assembled prompt — every summary row appears regardless of
  `memoryTokensRatio`; `SELECT tokens FROM memory summaries` rows are all 0.
- Type/test gates after any fix: `pnpm test`, `pnpm api:test`,
  `pnpm client-thinning:audit`, and the two project-reference TypeScript
  checks (`tsc -p tsconfig.client-lib.json`;
  `tsc -p server/fastify/tsconfig.json --noEmit`).
