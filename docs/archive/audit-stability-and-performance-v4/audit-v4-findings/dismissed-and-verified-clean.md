# V4 Audit — Dismissed Candidates And Verified-Clean Results (Detail)

Full-detail companion to `../audit-stability-and-performance-v4.md` (sections
"Investigated And Dismissed" and "Verified-Clean Sweeps"). Each candidate
below was adversarially refuted by the round-2/round-4 verification lenses,
or proven clean by a round-3 sweep's own negative result. They are recorded
so they are NOT re-opened without new evidence. Every entry names the
precise NEW evidence that would justify a re-open — derived honestly from the
refutation grounds, not from the original claim. Symbol names are the durable
anchors; line numbers drift.

## Dismissed

Six candidates were refuted. R1 was an attempted re-open of a v2 dismissal,
re-affirmed instead; R2-R6 are new candidates that survived as code-level
facts but were unreachable on the live Fastify-only runtime.

### R1 — Durable submission lock wedges the chat when `attachGenerationViewer` throws after `register()`

- Original claim: finder `durable-job-state-machine`, claimed **medium**
  (stab/server) — "Durable submission lock is claimed before
  `attachGenerationViewer()`, which can throw on a dead socket, leaving the
  chat wedged at HTTP 409 for ~20 minutes with no runner to release it." The
  finder asserted that `startDurableGeneration` claims the one-running-job-
  per-chat lock via `generationJobs.register()` BEFORE the unguarded
  `attachGenerationViewer()` call and BEFORE `trackRunner(runGenerationJob)`;
  since the lock is released ONLY in `runGenerationJob`'s `finally`
  (`clearRunning`), a synchronous throw from attach would strand the lock at
  `done=false` until the 20-minute staleness GC.
- Location: `server/fastify/src/routes/generationChat.ts` —
  `startDurableGeneration` (`register()` ~`:1816`, `attachGenerationViewer()`
  ~`:1817`, `trackRunner(runGenerationJob)` ~`:1820`); sole lock release
  `runGenerationJob` `finally` `clearRunning` ~`:1763`; attach internals
  `:1100-1144` (`reply.raw.writeHead` `:1108`, `makeSseJobClient.send`
  → `writeBoundedRaw` `streamBackpressure.ts:51` `raw.write`, no try/catch);
  staleness branch `streamJobs.ts:422-428`.
- Refutation (REFUTED 3-0; re-affirms v2 dismissed candidate #1). This is a
  restatement of v2's first dismissed item
  (`docs/archive/audit-stability-and-performance-v2/audit-stability-and-performance-v2.md:914-917`:
  "structurally plausible (register precedes attach with no try/catch) but no
  synchronous throw site exists between `register` and `trackRunner` in
  current code"). All three lenses confirmed the candidate's STRUCTURAL facts
  — register precedes the unguarded attach, the lock's sole releaser is the
  runner's `finally`, and the 20-minute arithmetic is correct
  (`timeoutMs` defaults to `PROXY_STREAM_DEFAULT_TIMEOUT_MS=600_000`,
  staleness cleanup at `max(600000, timeoutMs*2)=1_200_000ms`) — but all
  three refuted the load-bearing TRIGGER: `attachGenerationViewer` does not
  throw synchronously on a dead socket. The liveness and mechanism lenses
  empirically tested the actual runtime (Node 24.15.0, Fastify 5.8.5 from
  `node_modules`): with the client sending an RST so the server socket is
  `destroyed=true`, `reply.hijack()`, `reply.raw.writeHead(200,…)`, and
  `reply.raw.write(…)` all complete WITHOUT throwing (`write` returns
  `false`). Node silently swallows writes to a destroyed `ServerResponse`;
  the only error variant, write-after-end (`ERR_STREAM_WRITE_AFTER_END`), is
  an ASYNC uncaught exception, not a synchronous throw — and it is
  additionally pre-empted because `writeBoundedRaw` guards
  `if (isWritableEnded(raw)) return false` (`streamBackpressure.ts:44`)
  before reaching the `raw.write` at `:51`. The double-`writeHead`
  (`ERR_HTTP_HEADERS_SENT`) form is unreachable: a single hijack + one
  `writeHead` with static valid headers, no prior reply sent in the handler.
  `attach()` is throw-safe (`sendBoundedJobClient` wraps `client.send` in
  try/catch, the replay buffer is empty at attach time), and
  `formatPromptChatFrame` is a pure `JSON.stringify` of `{type,jobId}`. The
  `register()`→`trackRunner()` section is fully synchronous (no `await`), so
  no destroy can interleave mid-section. Therefore `trackRunner` is always
  reached, `runGenerationJob`'s `finally` always clears the lock, and the
  20-minute 409 wedge cannot arm. The candidate supplied a library behavior
  contradicted by the live runtime — not new valid evidence — so the v2
  dismissal stands.
- Would re-open if: a NEW, demonstrated synchronous throw site appears
  between `register()` and `trackRunner()` — e.g. a code change that calls
  `.end()` on the reply before the bounded write (defeating the
  `isWritableEnded` guard so write-after-end becomes reachable), a future
  `attachGenerationViewer` line that can throw synchronously on a destroyed
  socket under the project's Node version, or moving any throwing `await`
  into that currently-synchronous span. Absent such a site, do NOT re-open;
  the empirical Node 24 behavior was the dispositive evidence.

### R2 — Ooba/textgen streaming WS abort-listener leak

- Original claim: finder `client-listener-leaks`, claimed **low**
  (stab/client) — the ooba streaming branch registers
  `abortSignal?.addEventListener('abort', close)` with neither `{ once: true }`
  nor a paired `removeEventListener`, unlike every sibling abort-listener
  site (`sseParse.ts`, `serverCompletion.ts`, `streamResponse.ts`,
  `events.ts`, `globalApi.svelte.ts`), so each ooba streaming request leaks
  one `abort` listener bound to the request's signal.
- Location: `src/ts/process/request/request.ts` ~`:805` (the
  `useStreaming` branch the finder called `requestOobaStream`; the verifier
  corrected the containing function to `requestOobaLegacy`, `close` ~`:780`,
  socket created ~`:766`).
- Refutation (refuted; lone skeptic, info). The MECHANISM is real in source
  — the `requestOobaLegacy` `useStreaming` branch does add an `abort`
  listener with no `once` and no removal, and on `stream_end` the socket
  closes but the listener stays attached. But the containing function is
  DEAD CODE on the Fastify runtime. The trace: `requestChatData`
  (request.ts ~`:231`) always calls `requestChatDataMain` (~`:295`/`:469`);
  `requestChatDataMain` (~`:518`) calls `resolveServerCompletionRoute`, which
  (`serverCompletion.ts:22-33`) returns `server` unconditionally and never
  `local`, so it returns `requestServerCompletion` (~`:520`) and the provider
  switch (~`:534`, where `case OobaLegacy` lives) is never reached. The
  `local` arm of `ServerCompletionRoute` is declared but produced nowhere.
  The main send also routes `OobaLegacy` server-side via
  `resolveServerPromptAssembly` (only `server`/`unsupported`), since
  `OobaLegacy` is server-routable (`providerCapability.ts:119-120`, no gate);
  streaming scripting `LLM()` callers hit the same gate. The only caller of
  `requestOobaLegacy` is the dead switch. Even taken at face value the leak
  is bounded — the live runtime mints a fresh `AbortController` per
  generation, so the dead listener is GC'd with its per-request signal.
- Would re-open if: a browser-local provider dispatch route ever returns
  again — i.e. `resolveServerCompletionRoute`/`resolveServerPromptAssembly`
  gains a `local` arm that reaches the client provider switch, or a caller
  reuses a long-lived `AbortSignal` across many ooba streams (turning the
  bounded per-request listener into genuine accumulation). The fix is cheap
  if the path goes live: match the sibling pattern (`{ once: true }` +
  `removeEventListener` in the `cancel()`/`stream_end` path).

### R3 — HypaV3 modal `isOrphan()` per-render transcript scan

- Original claim: finder `complexity-client`, claimed **low** (perf/client)
  — `ModalSummaryItem` puts `disabled={isOrphan()}` directly in markup on the
  Reroll button, so `isOrphan()` re-evaluates on every item render;
  `isOrphan()` loops `summary.chatMemos` doing a full
  `chat.message.findIndex` transcript scan per memo, amplified across all
  visible summaries per modal frame —
  `O(visibleSummaries × chatMemos × transcriptLength)` jank while editing in
  the modal.
- Location: `src/lib/Others/HypaV3Modal/modal-summary-item.svelte` —
  `disabled={isOrphan()}` ~`:464`, `isOrphan()` ~`:146-160`, both the only
  two `isOrphan` references (`:464` and `toggleReroll` ~`:164`) sit inside
  the `{#if !readOnly}` block opened ~`:448`; parent mount
  `HypaV3Modal.svelte` ~`:728` passes `readOnly={serverBackedMemoryMode}`,
  `serverBackedMemoryMode = $derived(canUseServerMemoryApi())` ~`:43`.
- Refutation (refuted; lone skeptic, info). The per-render cost description
  is mechanically accurate, but the liveness premise is wrong: it is DEAD
  CODE. `canUseServerMemoryApi()` is an unconditional `return true`
  (`serverMemory.ts:71-73`, made unconditional by the Fastify sole-platform
  refactor in commit `c28450224`), so `serverBackedMemoryMode` — and thus the
  modal's `readOnly` prop — is unconditionally `true`. The
  `{#if !readOnly}` branch never renders on the live runtime, so `isOrphan()`
  is never evaluated. The same gate also removes the editable interactions
  the candidate cited as re-render amplifiers (the `bind:value` text
  textarea, `toggleImportant`, delete buttons are ALL inside
  `{#if !readOnly}`), so even the re-render-frequency premise fails in the
  live read-only modal. The verifier confirmed the HypaV3Modal files are
  unchanged across the v3 Phase-3 memory commits (those touch server memory,
  not this client modal).
- Would re-open if: a read-WRITE memory modal returns — i.e.
  `canUseServerMemoryApi()` becomes conditional (or any other path sets the
  modal's `readOnly` to `false`), so the `{#if !readOnly}` branch renders and
  `isOrphan()` runs per item. The fix is then a one-pass `Set<string>` of
  `chat.message[*].chatId` built in the parent, passed as a precomputed
  boolean prop (or a `$derived` keyed on `chatMemos` + a transcript-id
  signature).

### R4 — Stale `msgIndex` mid-stream corrupts edits/deletes

- Original claim: finder `hostile-client-send-render`, claimed **medium**
  (stab/client) — `consumeStreamResponse` captures `msgIndex = message.length`
  once at stream start; every coalescer apply writes
  `…message[msgIndex].data`. A concurrent message edit/delete mid-stream
  shifts the array, so `message[msgIndex]` either references a different row
  (silently corrupting it with the streamed text) or is `undefined` when the
  array shrinks past `msgIndex` (a `TypeError` inside the coalescer apply
  that propagates to an `alertError`).
- Location: `src/ts/process/postGeneration/streamResponse.ts`
  (`consumeStreamResponse`, `msgIndex` captured ~`:67`, `applyLatestChunk`
  write ~`:114-117`); inlay writes `orchestrateResponse.ts:137/141/148`; edit
  UI `src/lib/ChatScreens/Chat.svelte` `edit()`/`handlePartialEditSave`
  ~`:256-307`.
- Refutation (refuted 2-1, info; the one confirming lens dropped it to low).
  Two lenses (liveness, severity) refuted: NO live path shifts the message
  array mid-stream. The edit/delete/`rm` handlers in `Chat.svelte` branch on
  `canUseServerCommands()` (always true) into FIRE-AND-FORGET server commands
  (`dispatchDeleteMessageScoped`/`dispatchUpdateMessageScoped` →
  `runServerCommand`) with no local splice — the splice `else` arms are dead.
  A same-tab edit/delete echoes back over SSE as the user's OWN command, and
  `isOwnCommandEvent` (`bootstrap.ts:340-343`/`:439-442`) skips it, so the
  array is never re-applied mid-session. Edit is `messageId`-keyed and
  length-preserving. The 409-conflict rollback (`restoreChatScopedState`)
  restores a clone that still holds the row at `msgIndex`, and a conflict
  needs the cached revision to advance between snapshot and command, which on
  a single-user client only happens via another own-command — and the stream
  issues no command until it completes. The MECHANISM lens CONFIRMED the
  captured-once-`msgIndex` defect as real and live on the durable send path
  (the streaming display write at `streamResponse.ts:114-117` has no id-keyed
  guard, while the id-keyed `findGeneratedAssistantMessage` is used only by
  the terminal write) — but conceded that all three of the finder's claims
  were wrong: (1) the TRIGGER is not a same-tab edit but a SECOND tab that
  claims the active-writer slot and issues a mutation the still-streaming
  stale Tab A applies as a FOREIGN event; (2) the MECHANISM is not an
  in-place splice — a foreign `message` event maps to
  `RESOURCE_PROJECTION_FIELDS['message'] = ['characters']`, so
  `mergeServerProjectionFields` REPLACES the characters array with
  message-free stubs and the open chat's `message[]` becomes EMPTY (the
  dominant outcome is the `TypeError`, not silent wrong-row overwrite, which
  is essentially unreachable on an emptied array); (3) the CONSEQUENCE is no
  durable corruption — the durable generation is server-persisted and the
  terminal write is id-keyed, so persisted truth reconciles by id; the damage
  is a transient failed-send toast in a stale tab that self-heals on the next
  resync/reload. Calibrated to a narrow multi-tab self-race, not the routine
  single-user action the finder claimed.
- Would re-open if: a live path re-introduces an optimistic LOCAL splice of
  the open chat's `message[]` during streaming (e.g. an edit/delete handler
  that mutates the array before the server round-trip), or if the durable
  display write ever runs in a single-tab context where a foreign event can
  reorder rather than empty the array. The robust fix regardless: resolve the
  target row by stable id inside the apply (the message is already stamped
  `chatId: generationId`) via `findGeneratedAssistantMessage`, bailing if it
  no longer exists.

### R5 — Client OpenAI/Google `while(true)` tool loop spins forever

- Original claim: finder `error-retry-storms`, claimed **medium**
  (both/client) — `wrapToolStream`'s outer `while (true)` reads the provider
  stream and on a terminal `__tool_calls` frame executes every tool, re-POSTs
  the provider, and `continue`s with NO round cap and NO total-call budget,
  so a model (or abusive proxy) stuck replaying tool calls drives unbounded
  provider requests + tool executions; `prefix += … / enqueue({'0': prefix})`
  also re-emits the whole growing string each round (`O(N²)`).
- Location: `src/ts/process/request/openAI/requests.ts` (`wrapToolStream`,
  outer `while (true)` ~`:1459`, re-fetch do/while ~`:1564-1592`,
  `prefix +=` ~`:1604-1606`, exit ~`:1610`) and the sibling
  `google.ts:1142`; entry `requestChatData` (`request.ts:238` computes
  `tools = arg.tools ?? await getTools()`).
- Refutation (refuted 2-1, info; the one confirming lens dropped it to low).
  Same server-route reasoning as R2 — `wrapToolStream` is DEAD CODE on the
  Fastify runtime. Both `wrapToolStream` call sites
  (`requests.ts:716`, `google.ts:738`) live inside `requestOpenAI`/
  `requestGoogleCloudVertex`, reachable only from the
  `requestChatDataMain` provider switch (~`:534`), which sits BELOW the
  unconditional server-route gate at `request.ts:518-520`:
  `resolveServerCompletionRoute` (`serverCompletion.ts:22-33`) returns
  `server` for every input except `previewBody===true` (which returns
  `unsupported` → a hard fail at `request.ts:522`, NOT the local path) and
  never returns `local`. Every named ancillary caller (translator, triggers,
  scriptings `LLM()`, igp, emotionFallback, hypav3, stableDiff, aiaccess) and
  even the Plugin-V3 `runLLMModel` direct `requestChatDataMain` caller hit
  that same gate. The server side has NO tool loop at all: `rg` over
  `server/fastify/src` finds zero `callTool`/`tool_calls`/`__tool_calls`, the
  server adapters do single-pass stream reads, and `requestServerCompletion`
  omits `tools` from its payload entirely — so there is nothing to cap
  server-side either. This is the already-known disposition of **v3-L45**
  (`getTools()`/`initializeMCPs()` computed per `requestChatData` but
  DISCARDED on the server completion route). The SEVERITY lens confirmed the
  uncapped loop + `O(N²)` prefix as a genuine prior-audit miss (file
  unchanged since the v3 tree), and noted the non-streaming sibling recurses
  via `requestHTTPOpenAI` (~`:904`) with the same uncapped `do/while`, but
  calibrated it to low: reachable only via opt-in MCP + ancillary non-main
  callers, each round is a visible network round-trip (not an event-loop
  hang), and `arg.abortSignal` flows into `fetchNative` so the user can stop
  it.
- Would re-open if: a browser-local provider dispatch route ever returns —
  i.e. `resolveServerCompletionRoute`/`resolveServerPromptAssembly` gains a
  `local` arm reaching the client provider switch — OR the server gains a
  tool-execution loop (`tools` forwarded + `callTool` on the server adapter)
  that has no round/total-call cap. Either makes the missing `MAX_TOOL_ROUNDS`
  circuit-breaker live. The extension context is recorded with **v3-L45**.

### R6 — `mcp-tool-calls` IndexedDB store grows per tool call forever

- Original claim: finder `sweep:indexeddb-quota`, claimed **medium**
  (stab/client) — `encodeToolCall` does `inst.setItem(call.call.id, call)`
  into the `mcp-tool-calls` localforage store on every MCP tool call whose
  result has text, gated on `arg.rememberToolUsage` (defaults `true`); a whole-
  module grep finds only `setItem`/`getItem` — NO `removeItem`/`clear`/prune/
  LRU/TTL — so the store grows monotonically per tool invocation, never
  reclaimed even when referencing chats are deleted, eventually exhausting the
  origin's IndexedDB quota and rejecting the awaited `setItem` mid-generation.
- Location: `src/ts/process/mcp/mcp.ts` (`createInstance('mcp-tool-calls')`
  ~`:431`, `encodeToolCall` `setItem` ~`:436-438`, `decodeToolCall` `getItem`
  ~`:442-454`); writers `openAI/requests.ts:868/:1528`,
  `anthropic.ts:1086`, `google.ts:918/:1239`; default
  `database.svelte.ts:745` (`data.rememberToolUsage ??= true`).
- Refutation (refuted 2-1, info; the one confirming MECHANISM lens dropped it
  to low). The store MECHANICS are fully real and confirmed by all three
  lenses — only `setItem`/`getItem` touch the instance, there is no prune/
  clear/LRU/TTL anywhere, `rememberToolUsage` defaults `true`, and the
  payload is the full `{call, response}`. But there is NO live writer. Every
  `encodeToolCall` site is gated `if (arg.rememberToolUsage)`, and the ONLY
  assignment of `rememberToolUsage` onto a `requestChatData` arg in the whole
  tree is `dispatchRequest.ts:113`; `dispatchRequest`'s sole live caller is
  `index.svelte.ts:343`, reached only when `assemblyRoute.type === 'local'`
  AND `serverDispatch` is unset — but `resolveServerPromptAssembly`
  (`serverPromptAssembly.ts:250`) returns ONLY `server`/`unsupported`, never
  `local`, and the one path that forces a local route (`arg.reattachJobId`)
  ALSO sets `serverDispatch` and so still skips `dispatchRequest`. The
  encode/decode functions are called only inside the client provider
  adapters, which the server route bypasses; the server omits `tools` from
  its completion payload and its adapters explicitly drop tool/function rows
  (`openaiResponses.ts:172 tools:[]`, `gemini.ts:71-75`, `cohere.ts:133`,
  `ollama.ts:44`), and `server/fastify` never imports `mcp.ts` (IndexedDB is
  browser-only). So the QuotaExceededError-aborts-generation scenario cannot
  occur on the live durable send path — this rides the same dead-tools
  disposition as **v3-L45**. The CONFIRMING mechanism lens noted two
  corrections even while keeping it reachable-at-low: (1) the keys are the
  PROVIDER's `tool_call` ids (`id: toolCall.id`), not fresh v4 UUIDs minted
  per call — the `|| v4()` is only an empty-id fallback (entries still
  accumulate, since provider ids are unique); and (2) the entries are
  load-bearing — `decodeToolCall` reconstructs `tool_calls` into the messages
  array on transcript re-send, so the candidate's "remove once decoded" fix
  would orphan `<tool_call>` markers and break replay (which is WHY no prune
  exists). It scoped the residual reachable leak to opt-in MCP + infrequent
  AUXILIARY-LLM tool calls (a quota failure fails that specific feature, not
  the main send), not the candidate's "any chat send" framing.
- Would re-open if: tool-calling lands on the durable send path — i.e. the
  server forwards `tools` and executes a server-side MCP tool loop, OR a live
  client-local dispatch route returns that reaches the `encodeToolCall`
  adapters with `rememberToolUsage` true. Either gives the unbounded store a
  live writer. A bound should land WITH that work (count-cap LRU, or remove on
  chat/char switch) — but note the load-bearing replay role: any prune must
  not orphan `<tool_call>` markers in the persisted transcript.

## Verified-Clean Sweep Results

Round-3 sweeps that refuted their OWN target hypotheses (info-grade, accepted
on the sweep's code-level verification; no separate skeptic pass — they are
negative results, not findings). Recorded so future audits do not re-plow.

### Image-ingest main-thread decode (`compressImage`/`doLossyCompression`)

- Hypothesis: a hostile oversized image inside an imported third-party card
  triggers a main-thread `compressImage` canvas decode (`new Image()` +
  `drawImage` onto a canvas, then `canvas.toDataURL`), hanging/OOMing the
  renderer.
- What the sweep found: the decode is EXPORT-ONLY; the card-IMPORT (hostile)
  path never reaches it. `doLossyCompression` does cap the OUTPUT to 3000px
  on the longer side but does NOT cap the SOURCE decode — yet every live
  `compressImage` caller is on an EXPORT path (`exportCharacterCard` adding
  emotions/additionalAssets/v3 assets; module export), all operating on the
  user's OWN stored assets read via `readImage`/`loadAsset`, gated on
  `DBState.db.imageCompression`. The import path
  (`importCharacterProcess`) routes every image straight to server upload
  with NO client decode: primary image → `saveAsset(img)`; embedded/data-uri/
  emotion/additional/vits assets → `saveAssets`; charx → `CharXImporter` +
  `saveAssets`; JSON → `saveAsset`. So the specific hostile vector does not
  exist; imported card images are never client-decoded. (The residual live
  decode risk is the inlay path — finding **L36**.)
- Evidence: `src/ts/media/compressImage/compressImage.ts:5`,
  `lossyCompression.ts:1` (decode `:5-31`, 3000px output cap `:14-23`);
  export callers `characterCards.ts:1268/1287/1348/1352/1473`,
  `process/modules.ts:141`; import asset-upload sites
  `characterCards.ts:350/629` (`saveAsset`), `:258/678/724/772/842`
  (`saveAssets`).

### Editor highlighter `highLights` Map (no leak)

- Hypothesis: the module-level `highLights` Map accumulates one entry per
  opened editor without cleanup — a per-open leak.
- What the sweep found: NO leak. `highLights` is keyed by an incrementing
  `highlightId`; entries are inserted only inside `highlighter()`
  (`highLights.set`), and on component unmount `TextAreaInput`'s `onDestroy`
  calls `removeHighlight(highlightId)` (`highLights.delete(id)`) and clears
  the pending `highlightTimer`. The Map is bounded by currently-mounted
  highlighted editors and cleaned up on unmount. Moreover `highlighter()`
  never runs in the live runtime (`disableHighlight` is true everywhere — the
  whole highlighter is dead, finding **I29**), so the Map stays empty
  regardless. `getNewHighlightId` never reuses ids, but since keys are deleted
  on destroy this is a harmless latent note.
- Evidence: `src/ts/gui/highlight.ts:16` (`highLights` Map), `:105`
  (`highLights.set`), `:136` (`removeHighlight`); cleanup
  `src/lib/UI/GUI/TextAreaInput.svelte:229-235` (`onDestroy` clears
  `highlightTimer` + `removeHighlight(highlightId)`).

### CBS autocomplete per-keystroke `AllCBS.filter` scan (dead branch)

- Hypothesis: `autoComplete()` runs an `AllCBS.filter` scan on every
  keystroke, allocating per keystroke and scaling with editor content.
- What the sweep found: DEAD on the live runtime, and bounded even if alive.
  `AllCBS` is a module-level constant (~150 entries) built ONCE at import.
  `autoComplete()`'s `AllCBS.filter(cb => cb.startsWith(qText)).slice(0,10)`
  is a small bounded scan over that fixed array — it does NOT scale with
  editor text length (only `substring(0,caretOffset).split('{{')` touches the
  text, and `qText` is just the trailing token). Crucially, `autoComplete()`
  is wired only to the `contenteditable` `{:else}` branch, rendered only when
  `!($disableHighlight) && highlight`. With `disableHighlight` always true,
  the plain `<textarea>` branch renders and `autoComplete()`/`AllCBS.filter`
  never runs on keystroke. No live per-keystroke CBS allocation.
- Evidence: `src/lib/UI/GUI/TextAreaInput.svelte:166` (`autoComplete()`),
  `:186` (`AllCBS.filter`), `:414-418` (`contenteditable oninput →
  autoComplete()`); `AllCBS` built once `src/ts/gui/highlight.ts:337`.

### highlight.js language registration (once-per-language, not per render)

- Hypothesis: highlight.js language modules are registered per code-block
  render — repeated `registerLanguage` cost on the message render path.
- What the sweep found: registration is ONCE globally per language, guarded.
  `renderHighlightableMarkdown` is on the live message render path; for each
  code block, the dynamic `import(...)` + `hljs.registerLanguage` is guarded
  by `if(!hljs.getLanguage(lang))`, and the single `registerLanguage` call
  site is inside the `languageModule !== null` guard. After the first
  registration `hljs.getLanguage` returns the grammar, so later renders skip
  both the import and the register. The actual per-render cost is
  `hljs.highlight(code,…)` over the code block's text (bounded by code-block
  size — normal markdown rendering work) plus a placeholder regex
  match/replace, NOT re-registration. First render of a given language pays a
  one-time dynamic import; all later renders reuse the registered grammar. No
  finding.
- Evidence: `src/ts/parser/parser.svelte.ts:246`
  (`renderHighlightableMarkdown`, live, called at `:970` and `:1098` during
  message render); per-language guard e.g. `:273`
  (`if(!hljs.getLanguage('bash'))` before dynamic import); single
  `registerLanguage` call site `:428`.
