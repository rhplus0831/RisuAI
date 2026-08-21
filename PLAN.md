# Server-Owned Intermediate Display Processing — Implementation Plan

## Status

Implemented on 2026-08-21 with the rollout-safe protocol-v1 boundary described
below. Raw messages remain authoritative and the client fallback remains
compiled for browser plugins, older servers, unsupported dynamic-asset
similarity, stale requests, and transport failures.

Implementation findings resolved the original open decisions as follows:

1. Dynamic-asset fuzzy matching selects `client_fallback` in protocol v1; exact
   server parity would require moving the browser embedding model across the
   boundary.
2. The initial cache limits are 512 entries, 16 MiB total UTF-8 output, and 512
   KiB per entry. The batch route accepts at most 64 targets, 512 KiB per source,
   and 4 MiB of source text per request.
3. Growing streaming prefixes use the same exact post-first-asset POST seam,
   are coalesced in the browser, and explicitly bypass the shared server LRU.
   The proposed additive SSE projection was not used because the generation
   server does not possess the browser's first additional-asset-pass output;
   emitting a transform there would reorder the compatibility pipeline.
4. Version 1 uses only the separate POST operation; hydration remains raw and
   authoritative.
5. The whole client transform is retained as a negotiated compatibility and
   plugin fallback.

The related `screenHeight` compatibility defect is intentionally tracked in a
separate report at
`/home/codex/docs/screen-height-client-context-report.md`. That fix should land
independently, preferably before this plan reaches client cutover.

## Objective

Move expensive intermediate message-display processing, centered on
`processScriptFull(..., 'editdisplay')`, from the browser to Fastify. The browser
should receive a fully transformed `displaySource`, then retain responsibility
for browser-native asset/inlay resolution, Markdown rendering, HTML/CSS
sanitization, translation presentation, metadata insertion, DOM enhancement,
and interaction.

The result should reduce browser CPU and interpreter work without persisting
derived display text, changing raw message authority, or turning Fastify into an
HTML renderer.

## Decisions

1. **Raw messages remain authoritative.** SQLite `messages.json` remains the
   lossless source of truth. `displaySource` is disposable derived data and must
   never be accepted as message content by mutation or generation code.
2. **The boundary is intermediate text, not HTML.** The initial migration moves
   the existing `processScriptFull(..., 'editdisplay')` seam. The browser keeps
   the surrounding `ParseMarkdown()` pipeline, including its first and optional
   second additional-asset pass, inlay blob URLs, thought/tool presentation,
   sentence formatting, Markdown, style decoding, DOMPurify, and DOM observers.
3. **Preserve transform ordering.** The client supplies the exact string that
   currently enters `processScriptFull` after the first additional-asset pass.
   Fastify returns the string that should enter the optional second asset pass.
4. **No browser plugin reordering.** When a browser plugin has registered an
   `editdisplay` hook, the entire current client `processScriptFull` path remains
   active. Fastify does not attempt to run the server stages around a client
   plugin with extra round trips, because that would alter the required order.
5. **Current variable semantics remain valid.** V2 display-trigger variables
   stay request-local temporary variables. Lua `editDisplay` may continue to
   produce durable chat-scriptstate changes, as the client does today. A bot
   relying on repeated render-time durable mutations is considered fragile bot
   behavior, not a reason to keep the transform in the browser.
6. **Single active display client is a supported invariant.** A writer-intent
   bootstrap supersedes the previous browser in normal use; the stale browser
   stops server communication and becomes frozen/read-only. The server cache may
   therefore retain only one active display-context namespace. In-flight work
   still carries immutable request context and source hashes so takeover timing
   cannot misapply a result.
7. **The cache is process-local and non-authoritative.** No SQLite table,
   migration, command event, backup data, or resource revision is created for
   cached display output.

## Current Boundary

The live message path is distributed across these stages:

1. `Chat.svelte` selects original, translated, or bilingual text and performs
   the initial display-oriented `risuChatParser` expansion.
2. `ParseMarkdown()` performs an initial additional-asset pass.
3. `processScriptFull(..., 'editdisplay')` runs:
   - Lua `editDisplay` hooks;
   - the declarative V2 `display` trigger;
   - browser plugin edit hooks;
   - another CBS/Risu parser expansion;
   - global, active-preset, character, and module regex scripts;
   - optional dynamic-asset name matching.
4. When the transform changed the string, `ParseMarkdown()` repeats additional
   asset expansion.
5. The browser resolves inlays, converts thought/tool markers, inserts sentence
   breaks, renders Markdown and code markers, scopes styles, sanitizes twice
   where necessary, inserts metadata, and activates DOM behavior.

The new Fastify service owns stage 3 only. This boundary is narrow enough to
avoid server DOM work and broad enough to remove Lua/V2/regex/dynamic-match CPU
from the browser. It also preserves the exact pre/post additional-asset order.

## Non-Goals

- Do not render Markdown, KaTeX, highlighted code, complete HTML, or the final
  DOM on Fastify.
- Do not move DOMPurify, CSS selector scoping, blob URL creation, BGM activation,
  copy/download controls, or partial-edit DOM mapping to Fastify.
- Do not persist `displaySource` in message rows or any compatibility export.
- Do not make derived output part of revision ordering, backups, import/export,
  prompt construction, translation source hashes, TTS source text, or editing.
- Do not execute browser plugins on Fastify.
- Do not solve general simultaneous multi-client rendering. The cache design is
  optimized for the active-writer takeover model while remaining safe for
  already-in-flight stale work.
- Do not redefine Lua display-variable compatibility in this project. A future
  policy that makes all display writes temporary would be a separate behavior
  change.
- Do not combine the independent `screenHeight` fix with the display-source
  patch series.

## Required Invariants

- Editing, copying source text, TTS, translation, partial editing, prompt
  assembly, and exports continue to use the raw message or raw translation.
- A server result is applied only to the exact client-selected display layer,
  source hash, character/chat/message identity, transcript index/role, display
  context, and client projection epoch that requested it.
- Original, translated, bilingual, greeting, preview, bookmark, and custom-HTML
  message surfaces either receive parity-correct output or explicitly retain the
  client fallback.
- Script order remains Lua → V2 display trigger → plugin hook → CBS → regex →
  dynamic asset matching. Plugin presence selects full client fallback.
- Active prompt-preset regex selection retains the current no-global-fallback
  behavior when a selected preset has no regex rows.
- V2 display variables remain temporary. Durable Lua scriptstate changes are
  applied at most once for one deduplicated transform execution.
- Cache hits never replay side effects. A transform that changes durable state
  is returned but is not inserted under a reusable cross-request key.
- Fastify failures, unsupported capabilities, stale targets, and network loss
  preserve the current client transform as a correctness fallback during
  rollout.
- Streaming cancellation, detach/reattach, replay gaps, Continue extension,
  regenerate ownership, and terminal persistence remain unchanged.
- Sanitized final browser output must remain byte- or DOM-equivalent for the
  compatibility corpus, apart from separately approved bug fixes.

## Display Context Contract

Introduce an additive normalized context shared by generation and display
processing:

```ts
interface ReportedClientContext {
  browserLanguage?: string
  screenWidth?: number
  screenHeight?: number
}

interface DisplayRequestContext extends ReportedClientContext {
  pageSessionId: string
}
```

`pageSessionId` is an ephemeral identifier created once per page runtime and is
not stored in `sessionStorage`. A reload therefore starts a fresh display cache
namespace, matching the lifetime of the browser's current parse memo and Lua
engine caches more closely than the writer session, which intentionally survives
same-tab reloads.

The server captures and normalizes the complete context once at the start of a
display request. Transform code must never read a mutable "last client" global.
The active cache service may compare that immutable context with its current
namespace and retire the previous namespace because only one client is expected
to remain active.

`screenHeight` support is a prerequisite for complete CBS parity but is owned by
the separate issue report, not implemented as an incidental part of this plan.

## Cache Design

### Active Namespace

Maintain one process-local `DisplaySourceCache` namespace identified by:

```text
databaseLineage
+ activeWriterEpoch
+ pageSessionId
+ normalized browserLanguage
+ normalized screenWidth
+ normalized screenHeight
+ display-transform protocol version
```

When any namespace field changes:

1. atomically install the new namespace;
2. retire the old LRU so it cannot receive new lookups;
3. let already-running requests finish against their captured namespace;
4. discard their results if their namespace is no longer active;
5. never cancel durable generation merely because the display namespace changed.

This deliberately keeps one viewport/session partition, which is appropriate
under the clarified single-client lifecycle. Correctness still comes from the
captured namespace and keys, not from connection arrival order.

### Entry Key

Inside the namespace, use a SHA-256 fingerprint over canonical, stable JSON:

```text
source text and source hash
+ display-layer kind (original / translation / bilingual / greeting / preview)
+ character ID and effective display character
+ chat ID
+ stable message ID when present
+ transcript index, role, first-message flag, and name/saying context
+ chat scriptstate and relevant global variables
+ character custom scripts and Lua/V2 trigger definitions
+ global and effective active-preset regex scripts
+ active module IDs and relevant module regex/trigger/asset definitions
+ display-affecting settings
+ character/module asset metadata used by dynamic matching
+ CBS conditions
+ transform implementation version
```

Do not use the global database revision as the primary key. It is a safe
fallback during early development, but unrelated settings or background-chat
mutations would destroy useful display cache locality. Prefer extracting a pure
canonical dependency-signature helper from the existing
`ChatBodyParseMemo.ts` signatures and sharing its JSON-compatible representation
with the server implementation.

The signature must include, at minimum, the fields already tracked by the
browser parse memo: character custom scripts/triggers/assets/default variables,
active chat ID/modules/scriptstate, global/active-preset/module regex scripts,
module triggers/assets/toggles, dynamic-asset settings, and the CBS conditions.

### Storage and Eviction

- Store completed promises while a key is in flight so duplicate callers share
  one execution and one possible side effect.
- Store successful side-effect-free results in a move-to-end LRU.
- Do not cache rejected, aborted, stale, oversized, or fallback results.
- Do not cache a result when the run produced a durable state delta. Return the
  result, commit the delta, and let the next request compute under the new
  scriptstate fingerprint.
- Bound both entry count and UTF-8 output bytes. Select final constants from the
  Phase 0 corpus; initial test candidates are 512 entries, 16 MiB total output,
  and 512 KiB maximum per cached entry.
- Avoid a correctness TTL. Random/time-sensitive output currently remains stable
  for the lifetime of a browser memo entry. `pageSessionId`, dependency changes,
  LRU eviction, and server restart provide equivalent bounded lifetimes.
- Add counters for hits, misses, in-flight joins, evictions, uncached durable
  writes, oversize bypasses, fallback reasons, per-stage duration, and output
  bytes. Never record message/script contents in metrics.

### Streaming

Growing streamed prefixes must not enter the shared LRU: nearly every prefix is
unique and would evict stable transcript entries.

Use one job/attempt-local display projection slot keyed by generation identity,
target message identity, display context, and monotonically increasing sequence.
Only the newest cumulative source is retained. Server-side coalescing should
bound transform frequency, and terminal settlement must force one final exact
transform.

## Proposed Wire Contract

Start with a separate active-writer authenticated operation so derived display
work and possible Lua scriptstate writes do not contaminate authoritative
message GET semantics:

```text
POST /api/v1/chats/:chatId/display-sources
```

Request, conceptually:

```ts
interface DisplaySourceRequest {
  protocolVersion: 1
  baseRevision: number
  context: DisplayRequestContext
  targets: Array<{
    requestKey: string
    characterId: string
    messageId?: string
    index: number
    role: string | null
    firstMessage: boolean
    layer: 'original' | 'translation' | 'bilingual' | 'greeting' | 'preview'
    source: string
    sourceHash: string
    projectionEpoch: number
  }>
}
```

The `source` is the exact string at the existing `processScriptFull` entry seam,
after the browser's first additional-asset pass. This makes the server operation
usable for original, translated, bilingual, synthetic greeting, and preview
rows without pretending that every source is a persisted message. Validate
target count, per-source bytes, total bytes, IDs, numeric indexes, and context
fields before running user scripts.

Response, conceptually:

```ts
interface DisplaySourceResponse {
  protocolVersion: 1
  revision: number
  contextFingerprint: string
  entries: Array<
    | {
        requestKey: string
        status: 'ok'
        sourceHash: string
        dependencyFingerprint: string
        displaySource: string
      }
    | {
        requestKey: string
        status: 'client_fallback' | 'stale' | 'error'
        sourceHash: string
        reason: string
      }
  >
}
```

The client must compare `requestKey`, `sourceHash`, context, target identity, and
projection epoch before applying an entry. The response revision advances only
when Lua produced and the server committed a durable scriptstate delta.

After the separate operation is stable, an optional projection may be folded
into chat hydration responses to remove the second round trip. Keep the same
internal service and envelope; do not add `displaySource` directly to the
persisted `Message` type.

## Phase 0 — Baseline, Corpus, and Contract Lock

### Work

- Build a display parity corpus covering:
  - plain text and Markdown-containing text;
  - original, translated, bilingual, greeting, preview, and custom-HTML inputs;
  - global, active-preset, character, and module regex scripts;
  - `<cbs>` regex inputs and screen/language callbacks;
  - Lua `editDisplay`, multiple Lua owners, failures, timeouts, and variable
    reads/writes;
  - declarative display triggers and temporary variables;
  - dynamic assets and fuzzy name matching;
  - groups/simple characters and alternate greetings;
  - malformed scripts and bounded-regex rejection;
  - browser plugin presence and fallback.
- Record the string immediately before and after the current client
  `processScriptFull(..., 'editdisplay')` call, plus the final sanitized DOM.
- Add deterministic cost counters for Lua boots/runs, trigger effects, regex
  executions, cache hits/misses, parser calls, and bytes. Do not gate CI on wall
  time.
- Decide measured cache limits using typical and pathological message bodies.
- Lock the version-1 request/response schemas and fallback reason catalog.

### Acceptance Criteria

- The corpus proves the selected boundary without relying on final HTML as the
  server contract.
- Every known browser-only feature is either outside the boundary or has an
  explicit whole-path client fallback.
- A failing transform cannot destroy or modify raw message/translation data.

## Phase 1 — Extract Pure Dependency and Context Helpers

### Work

- Extract the JSON-compatible display dependency representation from
  `ChatBodyParseMemo.ts` into a Svelte-free module usable by browser tests and
  Fastify.
- Keep browser reactivity reads in a thin adapter; keep normalization, stable
  serialization, hashing, and field selection pure.
- Add `DisplayRequestContext` validation and ephemeral page-session creation.
- Consume the separately implemented `screenHeight` field when available; keep
  it optional for compatibility with older clients.
- Implement the active namespace and bounded byte-aware LRU with in-flight
  promise deduplication.
- Register namespace retirement on active-writer changes and database-lineage
  replacement. Also retire when a display request reports a changed page
  session or normalized viewport/language context.

### Acceptance Criteria

- Changing each relevant dependency changes the fingerprint.
- Unrelated settings and background-chat changes do not change it.
- A viewport/session/takeover change cannot return an entry from the retired
  namespace.
- In-flight old-namespace work cannot populate the new namespace.
- LRU byte and entry limits are deterministic in tests.

## Phase 2 — Build the Fastify Display Transform Service

### Work

- Add a server module that composes existing primitives in client order:
  1. `runLuaEditTrigger(..., 'editdisplay')`;
  2. `runTrigger(..., 'display', { displayMode: true, displayData })`;
  3. capability gate for browser plugin hooks;
  4. non-mutating CBS expansion;
  5. async bounded regex `processScriptAsync(..., 'editdisplay')`;
  6. dynamic-asset matching parity.
- Resolve the exact character/chat/active-module/active-preset scope from the
  authoritative server database, while treating the supplied source string as
  the selected presentation-layer input.
- Reuse the existing server Lua timeout, aggregate budget, abort checks, trigger
  budgets, and bounded-regex limits.
- Run one chat's batch in deterministic target order and deduplicate identical
  keys. If Lua changes scriptstate, later targets in the same ordered batch see
  the updated working state.
- Accumulate durable scriptstate changes on the working chat. Commit the final
  delta once through a targeted transaction/event after all successful entries;
  do not issue one command per message.
- Do not recursively regenerate display sources after that commit.
- Return identity content on parity-compatible ordinary script failure where the
  client currently does so; return explicit fallback for unsafe/unsupported
  cases.

### Acceptance Criteria

- Server output matches the recorded client boundary for every supported corpus
  row.
- V2 display variables never persist.
- Lua durable changes are committed once, cache hits do not replay them, and a
  state-changing run is not stored as reusable output.
- Bounded-regex rejection, Lua timeout, cancellation, and stale-writer takeover
  cannot leave a partial durable mutation.
- The service never imports browser DOM, Svelte stores, DOMPurify, Markdown, or
  plugin runtime code.

## Phase 3 — Add the Batch Route and Browser Bridge

### Work

- Register the route in `app.ts` and `routeManifest.ts` as authenticated and
  active-writer guarded because a cache miss can execute Lua variable writes.
- Add strict request count/byte limits and protocol metrics.
- Add a browser adapter that batches mounted-message transform requests by chat
  and context. Do not send one HTTP request per row.
- Fence each response to the initiating message/layer/source/projection state.
- Integrate at the existing `ParseMarkdown()` seam:
  - client first additional-asset pass;
  - server display transform;
  - client optional second asset pass and remaining parser work.
- Keep `memoizedChatBodyParse()` above the combined operation so a browser memo
  hit performs no network request, matching current behavior.
- Preserve the last successfully parsed body while a replacement transform is
  pending; avoid flashing raw text or blank rows.
- Select the whole-path client fallback when:
  - plugin `editdisplay` handlers are registered;
  - the server does not advertise protocol support;
  - the route returns `client_fallback`;
  - the writer is stale/offline;
  - source/target freshness changed;
  - an unsupported legacy surface is encountered.

### Acceptance Criteria

- Initial transcript rendering uses one bounded batch per chat window, not one
  request per row.
- Reopening or remounting unchanged visible rows hits browser/server caches and
  does not rerun Lua or regex work.
- Original, translated, bilingual, and greeting changes select distinct keys
  and cannot cross-apply.
- Editing a message invalidates only that source and other entries whose real
  dependency fingerprints changed.
- Losing writer ownership drops pending derived results and enters the existing
  takeover flow without damaging drafts or raw messages.

## Phase 4 — Server-Owned Streaming Display Projections

### Work

- Mark growing mounted-generation targets explicitly and carry their message,
  layer, source-hash, context, and projection identity through the ordinary
  batch contract. This preserves the post-first-additional-asset boundary that
  the generation SSE producer cannot observe.
- Coalesce same-target prefixes in the browser batch queue before dispatch. A
  superseded parse resolves without executing the full local script path; the
  latest cumulative prefix is the only target sent for that batch slot.
- Serialize display batches on Fastify so Lua side effects remain ordered.
- Do not place partial prefixes in the shared LRU. Cache the final persisted row
  only when a later ordinary display request establishes a stable key.
- Leave durable generation replay and raw token frames unchanged. Reattach or a
  replay gap reconstructs display output by rendering the latest cumulative raw
  source through the same negotiated batch route.
- Fence client application with message/layer/source/context identity and the
  monotonically increasing display projection epoch.
- For browser plugin fallback, keep the current client coalescer and transform
  path for the whole generation.

### Acceptance Criteria

- Streaming remains visibly incremental without per-token server transforms.
- Detach/reattach reconstructs a valid projection from the durable cumulative
  source without adding derived text to replay storage.
- Stop, transport failure, post-token failure, Continue, regenerate, and
  half-streaming retain their exact current persisted-text semantics.
- A viewport/page-session change during generation cannot apply old-context
  display output after a new-context request wins.

## Phase 5 — Cutover, Observability, and Cleanup

### Work

- Advertise `displaySourceProtocol: { version: 1 }` from bootstrap.
- Initially enable the server path only for parity-supported rows while keeping
  the client fallback compiled and tested.
- Add development-only parity diagnostics that compare pure fixtures, not live
  double execution of side-effectful Lua.
- Monitor cache hit rate, transform duration, Lua runs, fallback reasons,
  response bytes, and client parser counts.
- Make the server path default after the corpus, streaming journey, browser
  smoke tests, and performance gates pass.
- Remove only the redundant browser Lua/V2/regex path after plugin fallback and
  old-server compatibility policy are explicitly retired. Keep shared client
  helpers needed by Playground, imports, previews, or compatibility tests.
- Update `STRUCTURE.md`, the prompt/scripting guide, client runtime guide, chat UI
  guide, route manifest documentation, and test-suite guide.

### Acceptance Criteria

- Supported messages no longer execute client Lua/V2/editdisplay regex work.
- Final sanitized DOM and user interactions remain equivalent.
- Browser main-thread render counts and Lua engine work decrease on initial
  hydration, broad display refresh, and streaming.
- Server CPU and response bytes remain within measured budgets.
- No cached or wire-derived display text enters SQLite, backups, exports,
  commands, translation hashes, or prompt assembly.

## Test Matrix

### Server Unit Tests

- Transform order and identity behavior.
- Active-preset/global/character/module regex ordering and fallback.
- CBS conditions and client context.
- V2 display state/temp variables and effect allowlist.
- Lua success, identity, timeout, abort, multiple owners, and durable variable
  delta.
- Dynamic asset selection and module assets.
- Dependency fingerprints for every relevant field.
- Cache hit/miss, in-flight join, LRU order, byte bounds, namespace retirement,
  oversized bypass, stale completion, and durable-write bypass.

### Route Tests

- Auth and active-writer enforcement.
- Request and total byte limits.
- Malformed/stale targets and mixed per-entry outcomes.
- One transactional scriptstate commit for a batch.
- Revision/event behavior only when durable state changed.
- Takeover during an in-flight transform.
- Database-lineage replacement and process restart.

### Browser Tests

- Exact integration at the pre/post additional-asset seam.
- Last-good-body behavior while pending.
- Source/layer/projection freshness drops.
- Translation, bilingual, greeting, preview, bookmark, custom HTML, partial edit,
  copy, TTS, and message editing continue using correct layers.
- Plugin registration selects the full client fallback.
- Older server/no capability selects the full client fallback.
- Offline/takeover behavior retains raw content and drafts.

### Streaming Tests

- Incremental projection cadence and forced terminal settlement.
- Send, Continue append/extend, regenerate, reroll, half-streaming, cancel,
  reattach, replay gap, and post-token failure.
- Old-context frame dropped after page/viewport context change.
- No shared-LRU entry for partial prefixes.

### Performance Gates

- Count client Lua boots/runs, editdisplay regex executions, `ParseMarkdown`
  calls, display-source requests, server cache hits, and bytes.
- Exercise at least the configured initial transcript tail and a long streaming
  message.
- Use deterministic counts/allocation bounds in CI; record wall-clock timing only
  as diagnostic evidence.

## Likely Files

### Shared and Browser

- `src/ts/process/request/clientContext.ts`
- `src/lib/ChatScreens/ChatBodyParseMemo.ts`
- `src/lib/ChatScreens/ChatBody.svelte`
- `src/ts/parser/parser.svelte.ts`
- `src/ts/process/scripts.ts`
- `src/ts/process/postGeneration/streamResponse.ts`
- `src/ts/process/request/serverChatEvents.ts`
- `src/ts/server/hydrationReads.ts`
- A new Svelte-free display dependency/context module
- A new browser display-source route adapter

### Fastify

- `server/fastify/src/app.ts`
- `server/fastify/src/routeManifest.ts`
- `server/fastify/src/routes/resourceReads.ts` or a focused new display route
- `server/fastify/src/prompt/scripts.ts`
- `server/fastify/src/prompt/triggers.ts`
- `server/fastify/src/prompt/luaRuntime.ts`
- `server/fastify/src/prompt/modules.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/prompt/sseEvents.ts`
- New display transform, cache, and route modules

### Focused Existing Tests

- `src/lib/ChatScreens/ChatBody.parseMemo.test.ts`
- `src/ts/process/scripts.editdisplay.test.ts`
- `src/ts/process/scriptings.test.ts`
- `src/ts/__tests__/renderCostHarness.ts`
- `server/fastify/__tests__/luaRuntime.test.ts`
- `server/fastify/__tests__/triggers.test.ts`
- `server/fastify/__tests__/boundedRegex.test.ts`
- `server/fastify/__tests__/generation.chat.test.ts`
- `server/fastify/__tests__/durableGeneration.test.ts`
- New server display transform/cache/route tests

## Resolved Implementation Decisions

1. Dynamic-asset fuzzy matching selects client fallback in version 1.
2. The bounded limits are recorded in the status section and shared protocol
   constants.
3. Mounted growing prefixes reuse the browser's existing render coalescing and
   the display batch adapter's latest-prefix replacement; no partial prefix is
   inserted into the shared LRU.
4. The first release uses only the separate POST operation.
5. Old-server and plugin fallback remains supported; deleting it requires a
   separate compatibility decision.

Co-Authored-By: Codex <noreply@openai.com>
