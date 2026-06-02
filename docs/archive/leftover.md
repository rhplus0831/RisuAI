# Leftover Items - Fastify workstreams

Last audited: 2026-06-02.

This is the live tracker for closeable work that remains after the archived
Fastify, client-thinning, durable-generation, lazy-projection, and
server/client protocol stability and performance workstreams.
Resolved history belongs in `git log` and `docs/archive/`; permanent no-port
constraints belong in `docs/structure/`.

Keep an item here only when a future agent can implement it, make an owner
decision, or explicitly retire it. Each item names the remaining gap, why it was
left open, and the evidence checked during the audit.

## Generation correctness and polish

### Inline generation persistence failure is still best-effort

- What remains: `buildPostGenerationFrame()` now persists raw provider text when
  post-generation derivation throws, but an inline `persistServerGenerationResult()`
  failure still returns no `done.postGeneration` frame and leaves the browser with
  its optimistic copy.
- Why open: the inline path has no hard-fail, projection-restore, or retry
  contract. Durable jobs have the separate
  `generation_finalization_retries` queue; inline sends do not.
- Evidence: `server/fastify/src/routes/generationChat.ts`
  (`resolvePostGenerationResult`, `buildPostGenerationFrame`);
  `server/fastify/src/generationFinalizationRetry.ts`.
- Trigger: a stricter inline failure contract is needed, or the maintainer decides
  best-effort inline persistence is final and this item can be retired.

### Output-trigger transcript surgery is projection-only

- What remains: server post-generation persists final assistant text and
  chat-scriptstate deltas, but `output` trigger message mutations such as
  impersonate/cutchat/modifychat are sent as `message_patch` for the browser
  projection rather than durably written as transcript edits.
- Why open: this preserves current projection behavior, but it is not a durable
  transcript surgery model.
- Evidence: `runServerPostGeneration()` captures `messageMutations` in
  `server/fastify/src/prompt/assemble.ts`; `persistServerGenerationResult()` only
  writes `chatVarMutations` plus the assistant row in
  `server/fastify/src/routes/generationChat.ts`; the browser applies the patch in
  `src/ts/process/request/serverMessagePatch.ts`.
- Trigger: output-trigger transcript edits need to survive reload/import without
  relying on the browser projection patch.

### Regenerate transcript trimming still depends on `Message.saying`

- What remains: `prepareRegenerateTranscript()` trims trailing assistant rows by
  comparing `Message.saying` and a quota. `docs/FASTIFY-REPORT.md` flags this as a
  low-severity server-only heuristic that can over- or under-trim when `saying` is
  absent.
- Why open: the target is already validated as the latest assistant message, so a
  simpler index-based pop should be enough, but it has not been changed.
- Evidence: `server/fastify/src/prompt/assemble.ts`
  (`prepareRegenerateTranscript`).
- Trigger: a regenerate cleanup pass, or any report of odd multi-tail regenerate
  behavior.

### Streaming cancel terminal frame does not reconcile to the persisted row

- What remains: a streaming cancel persists the accumulated text through
  `buildRawModeMessage()` (which trims and may target continue/regenerate rows),
  but the terminal `done` frame emitted to a reattached observer uses the raw
  accumulated result and omits the bumped revision.
- Why open: the canceller has already stopped reading, so only a separately
  reattached observer sees the mismatch; the next command refreshes through the
  normal revision reconciliation.
- Evidence: `persistRawCancelledResult()` and the abort branch in
  `server/fastify/src/routes/generationChat.ts`; low-severity note in
  `docs/FASTIFY-REPORT.md`.
- Trigger: make cancel observers reconcile immediately, or accept the extra refresh
  round-trip and retire this item.

### `outputTokens` can be a response budget instead of a measured count

- What remains: `coerceGenerationInfo()` backfills `generationInfo.outputTokens`
  from `info.responseBudget` when the done frame does not carry an output count.
- Why open: the value can overstate the displayed/persisted output token count; it
  does not change request behavior.
- Evidence: `src/ts/process/request/serverChat.ts` (`coerceGenerationInfo`);
  low-severity note in `docs/FASTIFY-REPORT.md`.
- Trigger: token-count metadata needs to be exact, or the UI/storage stops treating
  this field as a measured completion count.

## Durable generation

### In-flight generation jobs do not survive server restart

- What remains: `GenerationJobRegistry` and the underlying `JobRegistry` are
  process-memory state. Bootstrap exposes `activeGenerationJobs` only for jobs
  still present in that in-memory registry.
- What is already done: browser reload/reattach works while the server process
  stays alive, and failed durable finalization writes are now kept in the SQLite
  `generation_finalization_retries` table.
- Evidence: `server/fastify/src/generationJobs.ts`,
  `server/fastify/src/streamJobs.ts`, `server/fastify/src/routes/bootstrap.ts`,
  `server/fastify/src/generationFinalizationRetry.ts`.
- Trigger: Milestone 2 restart survival is needed. Use Hypa V3 memory jobs as the
  persistence/recovery precedent.

## Server Lua

### Hosted or multi-tenant Lua needs a stronger security model

- What remains: the server Lua VM is designed for single-user self-host. It has
  per-call engine isolation, execution limits, SSRF-guarded `request()`, pinned
  DNS, response caps, and a shared 30/min egress window, but it is not a hosted
  multi-tenant sandbox.
- Why open: hosted deployment would need an owner decision and additional controls
  such as an egress allow-list, per-tenant rate/isolation state, and possibly
  worker isolation.
- Evidence: `server/fastify/src/prompt/luaRuntime.ts`;
  `docs/archive/client-thinning/phases/slices/slice-3b-lua/README.md`.
- Trigger: deciding to ship a hosted or multi-tenant Fastify deployment.

### Several Lua host functions still return stubs

- What remains: server Lua host functions for `LLM()`/`axLLM()`/`simpleLLM()`,
  `similarity()`, `generateImage()`, image getters, persona description, and
  lorebook reads return explicit errors or empty values.
- Why open: these were deferred because the text-send server assembler did not need
  them, and each requires another server-side subsystem decision.
- Evidence: `server/fastify/src/prompt/luaRuntime.ts` (`declareHostFunctions`).
- Trigger: a real server-assembled character/module needs one of these host
  functions during prompt assembly.

### Interactive Lua detection is conservative

- What remains: the classifier scans `triggerlua` source for
  `alertInput|alertSelect|alertConfirm` and hard-fails server assembly before the
  runtime can prove whether the call path actually invokes a browser dialog. The
  runtime also sets `interactiveInvoked` when an interactive host function is
  called.
- Why open: the source scan is safe, but it can false-positive on unused/commented
  references or false-negative if a new interactive alias is introduced.
- Evidence: `src/ts/process/request/serverPromptAssembly.ts`
  (`INTERACTIVE_LUA_API_RE`); `server/fastify/src/prompt/luaRuntime.ts`
  (`interactiveInvoked`).
- Trigger: an observed false positive/negative, or a planned move to runtime-abort
  classification.

## Save/restore locally

### Device backup download is not end-to-end streamed to disk

- What remains: server bundle export streams asset entries, but the browser still
  consumes the response as a `Blob` and saves via an object URL. Very large
  downloads can still hit browser Blob/device-memory limits. The embedded
  `database.risu` bytes are also materialized before asset streaming starts.
- What is already done: device backup import streams uploads to a temp file and
  decodes in bounded batches; `RISU_API_IMPORT_MAX_BYTES` defaults to unlimited.
- Evidence: `server/fastify/src/routes/save.ts`,
  `server/fastify/src/risuSave/bundleExport.ts`,
  `src/ts/server/backups.ts`, `src/ts/storage/backup.ts`.
- Trigger: a user reports failed/oversized backup downloads, or the maintainer wants
  symmetric streamed save via the File System Access API (`showSaveFilePicker`) or a
  similar path.

## Protocol performance gates

### Prompt-construction runtime narrowing is evidence-gated

- What remains: server prompt assembly still loads a hydrated persisted database
  once per assembly. Opt-in metrics now split database load, scope resolution,
  submit transforms, static/plain slots, lorebook/preflight, history/bias, memory
  bridge, final render, and budget stages.
- Why open: focused fixtures did not justify a runtime narrowing by themselves; a
  future slice should name one dominant stage on representative lorebook-heavy,
  asset-heavy, memory-enabled, or real user corpora.
- Evidence: `server/fastify/src/routes/generationChat.ts`;
  `server/fastify/src/prompt/assemble.ts`;
  `docs/archive/server-client-protocol-stability-performance/active-risk-analysis.md`.
- Trigger: `RISU_PROTOCOL_METRICS=1` output shows one prompt-construction stage
  dominating a real workflow.

### Sprawling-resource full-bootstrap narrowing is evidence-gated

- What remains: `settings`, `state`, `pluginStorage`, and unknown targeted
  projection resources intentionally fall back to full bootstrap. Metrics now
  classify `projection_response` mode/fallback class, and the client attributes
  full-bootstrap fallbacks per resource.
- Why open: the full-mode response is tiny; the cost is the downstream bootstrap.
  A targeted field contract should only be added for a named resource family with
  measured frequency and cost.
- Evidence: `server/fastify/src/routes/projection.ts`; `src/ts/bootstrap.ts`;
  `src/ts/server/projectionResync.ts`;
  `docs/archive/server-client-protocol-stability-performance/active-risk-analysis.md`.
- Trigger: real-session diagnostics show frequent expensive full-bootstrap
  fallback for one resource family.

### Asset-byte fanout narrowing is evidence-gated

- What remains: asset byte reads remain one `GET /api/v1/assets/:id` per asset.
  The route emits an opt-in `asset_byte_read` metric, and the client aggregates
  request/unique/repeated-read counts.
- Why open: the route already uses immutable cache headers, so a bulk-byte route
  only pays off when real usage shows uncached repeated reads the browser cache
  does not absorb.
- Evidence: `server/fastify/src/routes/assets.ts`; `src/ts/server/assets.ts`;
  `docs/archive/server-client-protocol-stability-performance/active-risk-analysis.md`.
- Trigger: asset-heavy real-session metrics show high uncached `repeatedReads`.

### Ordinary `.risu` export streaming is evidence-gated

- What remains: ordinary `/api/v1/export/risusave` builds a complete
  `Uint8Array`. The route now measures snapshot, encode, and output cost for
  ordinary and bundle export.
- Why open: focused fixtures showed small uncompressed costs and gzip compression
  as the dominant encode cost; a streaming block-envelope writer needs large real
  export evidence before widening the compatibility surface.
- Evidence: `server/fastify/src/routes/save.ts`;
  `server/fastify/src/risuSave/exportSnapshot.ts`;
  `server/fastify/src/risuSave/blockCodec.ts`;
  `docs/archive/server-client-protocol-stability-performance/active-risk-analysis.md`.
- Trigger: large message-heavy exports show materialized-buffer memory pressure.

## Cross-cutting and audit maintenance

### ~~Fastify-backed Vite dev mode still needs an owner decision~~ **Resolved**

- Resolved: `isFastifyServer` is now unconditionally `true` and
  `globalThis.__FASTIFY__` injection has been removed. `pnpm dev` proxies
  `/api` to the Fastify backend and the app uses Fastify paths in all
  environments.

### Dead group-chat strings and comments remain

- What remains: group-chat behavior is removed/guarded, but dead language keys and
  comments still mention group chat.
- Why open: this is cleanup only; the runtime guard is already enforced by
  `setDatabase`, server defaults, and the `A4R-group-chat-removed` audit rule.
- Evidence: `src/lang/*` `removeFromGroup`, `src/ts/cbs.ts` `{{char}}`
  description, `src/ts/plugins/apiV3/risuai.d.ts` "characters and group chats";
  guards in `src/ts/storage/database.svelte.ts`,
  `server/fastify/src/databaseDefaults.ts`, and
  `util/client-thinning-audit.ts`.
- Trigger: final legacy-text cleanup pass.

### Fanout audit misses quoted Svelte attribute interpolations

- What remains: the `A4R-fanout` Svelte extractor reads `<script>` blocks and
  markup attributes shaped as `attr={...}`. It does not parse quoted
  interpolations such as `attr="{ ... }"`.
- Why open: no current mutating dispatch site is known to live in that shape, but it
  is a documented audit blind spot.
- Evidence: `util/client-thinning-audit.ts`
  (`extractSvelteAttributeExpressions`, `FANOUT_SVELTE_PATHS`).
- Trigger: a mutating dispatch lands inside a quoted Svelte interpolation, or the
  extractor is proactively generalized to the broader brace-group parser used by
  the group-chat audit.
