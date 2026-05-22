# Next Steps

Date: 2026-05-22

Use this list to pick the next chunk of work. **Phase 5 closed
2026-05-22**: all 28 slices landed and `src/ts/process/index.svelte.ts`
went from 1625 to 445 lines (73% reduction). The historical
slice picker is now archived at
[`sendchat-slicing.md`](sendchat-slicing.md). Per-slice details
are below under "Completed Slices".

## Immediate

1. **Phase 6 - Stage 3 dispatch moves server-side.** Per
   [`runtime-stages.md`](../runtime-stages.md), the next phase is
   moving the provider dispatch (currently in
   `src/ts/process/dispatch/dispatchRequest.ts` and
   `src/ts/process/request/request.ts`) onto the Fastify backend.
   The browser keeps a thin client that reads the server's SSE
   stream. Open work: define the server route surface, the SSE
   contract, and the client adapter that replaces
   `dispatchRequest`'s `requestChatData(...)` call with a network
   round-trip. Preserve the 26 sendChat fixtures and the helper
   tests as the safety net; the fixture provider fake will likely
   shift from `vi.mock('../request/request')` to a fake SSE
   transport. The dispatch helper's 5-variant discriminated union
   return (`preview` / `previewPrompt` / `aborted` / `failed` /
   `success`) is a natural seam between the client and the new
   server boundary.

2. **Follow-up: hub-route session auth.** The Fastify hub route
   at `ANY /api/v1/hub/*` is gated by `requireAuth`, so on
   password-protected deployments browser-loaded resources
   (`<img src=hubURL/resource/...>`,
   `<iframe src=hubURL/hub/login>`) will 401 because the browser
   cannot send `risu-auth` on element-loaded requests. The
   accepted scoping decision (Phase 3D-Broad option (b)) was to
   ship the limitation and revisit when a session-cookie path
   is needed. Unguarded deployments are unaffected. The Express
   `/hub-proxy/*` was rate-limited but not auth-gated, so it
   did not have this issue. A later slice can either drop
   `requireAuth` from the hub route to match the Express
   behavior or add a session-cookie auth path.

## Completed Slices

- **Phase 6-5 - anthropic messages end-to-end.** Done 2026-05-22.
  First non-OpenAI-compatible provider lands. New
  `server/fastify/src/generation/anthropic.ts` mirrors the openai
  dispatcher's shape: `resolveAnthropicRequest` (validates +
  defaults baseUrl `https://api.anthropic.com/v1`, version
  `2023-06-01`, maxTokens `1024`), `runAnthropic` (non-streaming
  POST to `/messages` with `x-api-key` + `anthropic-version`
  headers; concatenates every `content[].type === 'text'` block
  on success; surfaces `body.error.message` on non-2xx), and
  `runAnthropicStream` (consumes upstream SSE events
  `message_start` / `content_block_start` / `content_block_delta`
  / `message_delta` / `message_stop` / `ping`; emits `kind:
  'token'` for each `delta.text_delta`; emits the trailing
  `kind: 'done'` on `message_stop` with `finishReason` derived
  from the prior `message_delta.stop_reason`, mapping `end_turn`
  / `stop_sequence` → `stop` and `max_tokens` → `length`).
  Route changes: `'anthropic'` added to SUPPORTED_PROVIDERS;
  dispatched ahead of the OpenAI-compatible branch with its own
  `AnthropicOptions` (`apiKey`, optional `baseUrl` / `version` /
  `system` / `maxTokens` / `temperature`). Client adapter:
  `formatToServerProvider(LLMFormat.Anthropic) → 'anthropic'`
  gated by `isVanillaAnthropic` (refuses reverse_proxy,
  xcustom:::, and any model carrying a hardcoded `endpoint`;
  AWSBedrockClaude has a separate format already filtered out).
  `buildProviderOptions` emits `{apiKey: db.claudeAPIKey,
  maxTokens?, temperature?}` under `options.anthropic`. New
  `extractAnthropicSystem(formated)` helper pulls every
  string-content `role === 'system'` message out of the
  formated array, joins with `\n\n`, and surfaces them as the
  top-level `system` field; multimodal-content system messages
  stay in the messages array (the server-routed multimodal path
  is a later concern). `requestServerCompletion` invokes the
  helper only when `provider === 'anthropic'`.
  New `anthropic-basic` dual-mode fixture
  (`claude-opus-4-7`, single user turn, `db.claudeAPIKey:
  'sk-ant-fixture'`, `db.useStreaming: false`). Shared snapshot
  pins stages `[1, 3, 4]`, `runInlayScreen` fires, assistant
  text `'fixture claude reply'`. `serverCompletionFetch` gains
  an `'anthropic'` branch returning the canned reply (default
  overridable via `setAnthropicResult`); the openai branch also
  now serves `'nanogpt'` and `'openrouter'` providers (same wire
  shape on the SPA → server hop). Per-fixture expected-call
  table in the server-backed sweep gains the anthropic entry.
  Infrastructure: a new
  `src/ts/process/__fixtures__/mocks/tokenizerFetch.ts` serves
  `/token/*` URLs from disk (Phase 6-5 needs the Claude
  tokenizer for prompt preflight). Both fixture sweep files
  also `vi.mock('@mlc-ai/web-tokenizers')` with a whitespace
  splitter because the real WASM module doesn't initialize in
  happy-dom; this only affects models routed through the
  `tokenizeWebTokenizers` path (Claude / NovelAI / Llama /
  Cohere / Mistral / etc.) and snapshots for those fixtures are
  mock-dependent by design. Tests: anthropic dispatcher gains
  14 cases (`resolveAnthropicRequest` defaulting, baseUrl
  /messages + Bearer + version headers, system / temperature
  omit-when-absent, upstream error.message, no-content fail,
  pre-aborted no-op, streaming token / max_tokens-mapping /
  no-message_stop fallback / pre-aborted / ping-and-block-
  ignored); the route test file gains 3 cases (anthropic 400
  on missing apiKey, non-stream forward + headers + system
  pass-through, streaming SSE relay); adapter test file gains 3
  cases for the Anthropic gate (vanilla maps to 'anthropic',
  reverse_proxy refused) plus 1 request-shape case (system
  field extracted + options.anthropic emitted) and a dedicated
  `extractAnthropicSystem` describe with 3 cases (no-system
  passthrough, multi-system join with `\n\n`, multimodal
  preservation). 501 case in the route test updated from
  `'anthropic'` → `'gemini'`. Verification: `pnpm test` (497
  across 46 files, +8 = 6 adapter + 1 local + 1 server-backed),
  `pnpm api:test` (188 across 14 files, +17), `pnpm check`,
  `pnpm build` all green.

- **Phase 6-4c - nanogpt + openrouter variants.** Done 2026-05-22.
  Extends the openai dispatcher with hardcoded baseUrl + extra
  request headers per variant. The dispatcher itself gained an
  optional `extraHeaders` field on `OpenAIRequest`; the route
  factored its openai-handlers into `handleOpenAICompatible{Buffered,Streaming}`
  taking a pre-resolved `OpenAICompatibleVariant`. New variants:
  `nanogpt` routes to `https://nano-gpt.com/api/v1` (or
  `/api/subscription/v1` when `options.nanogpt.useSubscription === true`),
  optionally adds `X-Provider: <hint>`. `openrouter` routes to
  `https://openrouter.ai/api/v1` with hardcoded
  `X-Title: RisuAI` + `HTTP-Referer: https://risuai.xyz`. Client
  side: `formatToServerProvider(NanoGPT) → 'nanogpt'`; the
  OpenAICompatible branch now goes through `selectOpenAIVariant`
  which routes `aiModel === 'openrouter'` to `'openrouter'` and
  everything else (modulo reverse_proxy / xcustom::: / keyIdentifier
  / endpoint refusals) to `'openai'`. New `resolveProviderModel`
  helper overrides the wire-level `model` field with
  `db.nanogptRequestModel` / `db.openrouterRequestModel` for the
  two variants (the vanilla openai path keeps using
  `aiModel`/`modelInfo.id`), matching what the local
  `request/openAI/requests.ts:255-262` already does.
  `buildProviderOptions` gained `nanogpt` and `openrouter`
  branches (key from `db.nanogptKey` / `db.openrouterKey`,
  `useSubscription` from `db.nanogptUseSubscriptionEndpoint`,
  `providerHint` from `db.nanogptProvider`, `maxTokens` /
  `temperature` pulled from `targ`). Tests: openai dispatcher
  gained 1 case (extraHeaders reaching upstream),
  `generation.completion.test.ts` gained 5 cases (nanogpt 400 on
  missing apiKey, nanogpt forward with X-Provider, nanogpt
  subscription endpoint, openrouter 400 on missing apiKey,
  openrouter forward with X-Title + HTTP-Referer); adapter test
  changed the dropped-NanoGPT-under-OpenAICompatible case into
  routes-NanoGPT-to-'nanogpt' + routes-openrouter-to-'openrouter',
  added per-provider request-body cases for nanogpt and
  openrouter (apiKey / useSubscription / providerHint / wire-model
  override). No new fixtures: both variants share the openai wire
  shape on the SPA-to-server hop, so `openai-basic` covers the
  orchestrator parity contract. Verification: `pnpm test` (489
  across 46 files, +3 adapter cases), `pnpm api:test` (171 across
  13 files, +6), `pnpm check`, `pnpm build` all green.

- **Phase 6-4b - openai client adapter + dual-mode fixture.** Done
  2026-05-22. Extends the Phase 6-2 adapter and the Phase 6-3
  dual-mode harness to cover OpenAI Chat Completions, closing
  the Phase 6-4a server route end-to-end. Three changes:
  - `formatToServerProvider(LLMFormat.OpenAICompatible)` now
    returns `'openai'` (was `null`). The pure-format function
    stays a one-line lookup.
  - `getServerCompletionProvider` gained a second-stage
    `isVanillaOpenAI(targ)` gate. The OpenAICompatible format
    covers many derivatives that share the wire shape but route
    through different upstreams + keys; the gate refuses
    `aiModel === 'reverse_proxy'`, `aiModel.startsWith('xcustom:::')`,
    `aiModel === 'nanogpt' | 'openrouter'`,
    `modelInfo.keyIdentifier` (DeepInfra/DeepSeek/etc. OaiCompAPIKeys
    path), and `modelInfo.endpoint` (any hardcoded URL override).
    Each derivative gets its own slice when its upstream is wired.
  - `buildProviderOptions` emits `options.openai = { apiKey,
    maxTokens?, temperature? }`. `apiKey` comes from `db.openAIKey`;
    `maxTokens` / `temperature` are pulled from `targ` (resolved
    by `requestChatDataMain` from `db.maxResponse` /
    `db.temperature / 100`). Both numeric fields are omitted when
    `targ` does not carry them.
  - New `openai-basic` dual-mode fixture: `aiModel: 'gpt-4o'`,
    `db.openAIKey: 'sk-fixture'`, single user turn. Shared
    snapshot is identical between local and server-backed paths
    (stages `[1, 3, 4]`, `runInlayScreen` fires, assistant text
    `'fixture openai reply'`).
  - `serverCompletionFetch.ts` gained an `'openai'` branch that
    returns `{type: 'success', result, model}` for non-streaming
    or the same payload via the SSE envelope when `stream: true`.
    Result text is module-scoped (`setOpenAIResult` for future
    multi-fixture flexibility; defaults to `'fixture openai reply'`).
  - The server-backed sweep's per-fixture call assertion is now a
    table keyed on fixture name; both `echo-basic` and
    `openai-basic` carry their own expected `{provider, model,
    stream, options}` shape.
  Test changes: `serverCompletion.test.ts` updated the
  OpenAICompatible mapping assertion and added 6 gate cases
  (vanilla OpenAI, reverse_proxy, xcustom:::, NanoGPT/OpenRouter
  aliases, keyIdentifier set, endpoint set) plus 2 request-shape
  cases (`options.openai` carries `apiKey + maxTokens + temperature`;
  omits the numeric fields when targ lacks them). 28 cases total
  (up from 20). The 5 gate-test cases for `getServerCompletionProvider`
  also gain coverage of the openai path through the
  `'returns the provider when every gate passes'` style fixture.
  Out of scope: NanoGPT / OpenRouter / DeepInfra / DeepSeek /
  reverse_proxy / xcustom::: server-side dispatchers (each its
  own slice); tools / vision / multi-gen / schema mode on openai
  (each its own slice); browser-passes-key → server-reads-key
  swap (Phase 9). Verification: `pnpm test` (486 across 46 files,
  up from 476; +8 adapter cases + 1 local fixture + 1
  server-backed fixture), `pnpm check`, `pnpm api:test` (165
  unchanged — client-only), `pnpm build` all green.

- **Phase 6-4a - openai server dispatcher + route.** Done
  2026-05-22. First real provider on the Phase 6 server boundary.
  Server-only slice; client wiring lands in 6-4b. New files:
  `server/fastify/src/generation/frames.ts` (shared
  `CompletionStreamFrame` and `CompletionResult` types so the
  route's `writeSseChunk` can drive any provider's dispatcher),
  `server/fastify/src/generation/openai.ts` (`resolveOpenAIRequest`
  + `runOpenAI` for non-streaming + `runOpenAIStream` async
  generator). The non-streaming path POSTs
  `{baseUrl}/chat/completions` with a `Bearer <apiKey>` header,
  forwards `{model, messages, stream, max_tokens?, temperature?}`,
  and returns `{type: 'success' | 'fail', result, model?}`. Errors
  bubble through `body.error.message` when present, otherwise
  `HTTP <status>`. The streaming path consumes upstream OpenAI SSE
  (`data: <json>` lines, `data: [DONE]` sentinel), extracts
  `choices[0].delta.content` from each frame, propagates
  `finish_reason` into a trailing `{kind: 'done'}` frame, and
  re-emits in the Phase 6-1 envelope (`event: chunk` /
  `event: done`). Handles partial frames split across reader
  reads. `echo.ts` now re-exports its result/frame aliases from
  `frames.ts` so the two dispatchers share one type. Touched
  files: `server/fastify/src/routes/generation.ts` factored out
  `attachAbort` / `pipeStream` / `writeSseChunk` helpers (now
  generic over `CompletionStreamFrame`), added `'openai'` to
  `SUPPORTED_PROVIDERS`, added `handleOpenAIBuffered` /
  `handleOpenAIStreaming` branches behind a provider switch, and
  changed the 501 reason from
  `'provider not implemented in Phase 6-1: <name>'` to
  `'provider not implemented yet: <name>'`. New tests:
  `server/fastify/__tests__/openai.test.ts` adds 16 cases
  (`resolveOpenAIRequest` validation, non-streaming happy path /
  Bearer header / baseUrl trailing slash / upstream error.message
  / HTTP-status fallback / no-content fail / pre-aborted signal,
  streaming token-frame relay / no-`[DONE]` fallback /
  finish_reason propagation / pre-aborted no-op / partial-frame
  reassembly). `server/fastify/__tests__/generation.completion.test.ts`
  swaps the 501 case from `'openai'` to `'anthropic'`, threads a
  per-test `globalThis.fetch` restore through beforeEach/afterEach,
  and adds 4 openai route cases (missing apiKey → 400, non-stream
  forwards body + Bearer + returns assistant content,
  non-stream propagates upstream error message, streaming relays
  SSE deltas through the normalized envelope). Decisions locked:
  (1) browser passes `apiKey` in the request body for now; the
  server-side key store is a Phase 9 concern per the phase doc;
  (2) tools / schemas / vision / multi-gen / function calling /
  bias strings are explicitly out of scope; the route accepts
  the minimal payload (`model`, `messages`, `apiKey`, optional
  `baseUrl` / `maxTokens` / `temperature`) and each later slice
  extends as the surface area is needed; (3) shared `frames.ts`
  rather than per-provider frame types so the route stays
  provider-agnostic. Verification: `pnpm api:test` (165 across
  13 files, up from 145/12; +20), `pnpm check`, `pnpm test` (476
  unchanged — server-only), `pnpm build` all green.

- **Phase 6-3 - dual-mode fixture harness + first echo fixture.**
  Done 2026-05-22. Adds the mechanism for asserting that a sendChat
  fixture produces the same observable output through both the
  local dispatch path and the server-backed adapter path, then
  proves it with one echo fixture. New files:
  `src/ts/process/__fixtures__/db/echo-basic.json` (minimal
  one-user-turn fixture: `aiModel: 'echo_model'`,
  `useStreaming: false`, `useServerGeneration: true`,
  `echoMessage: 'fixture echo reply'`),
  `src/ts/process/__fixtures__/upstream/echo-basic.jsonl`
  (non-streaming success entry for the local provider fake),
  `src/ts/process/__fixtures__/expected/echo-basic.json` (the
  recorded shared snapshot: `stages: [1, 3, 4]`, `runInlayScreen`
  fires, assistant message `"fixture echo reply"`),
  `src/ts/process/__fixtures__/mocks/serverCompletionFetch.ts`
  (fetch stub emulating the Phase 6-1 route: echo returns either
  JSON `{type: 'success', result}` or an SSE `event: chunk + done`
  pair depending on `body.stream`; other providers return 501;
  unknown URLs throw; calls recorded into a parallel
  `getServerCompletionCalls()` array), and
  `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
  (server-backed sweep, mirrors the local sweep's mock setup minus
  `vi.mock('../request/request')`; mocks `../../platform` with the
  hoisted-getter pattern to force `isFastifyServer: true`; mocks
  `../../storage/nodeStorage` to short-circuit auth; installs the
  fetch stub via `vi.stubGlobal`). The existing
  `sendChat.fixtures.test.ts` appends `'echo-basic'` to FIXTURES
  so both sweeps assert against the same expected snapshot. Shared
  snapshot contract: the server-backed runner strips `providerCalls`
  from both expected and captured before comparing, then asserts
  `getServerCompletionCalls()` separately (provider `'echo'`,
  model `'echo_model'`, `stream: false`, `risu-auth` header set,
  `options.echo` derived from db). Decisions locked: (1) separate
  test file instead of toggling vi.mock per test — zero risk of
  drift in the existing 25-fixture sweep; (2) drop `providerCalls`
  from the shared snapshot — the two modes legitimately observe
  different things at the request boundary, and the shared
  snapshot pins everything else (messages, generationInfo, stages,
  side effects, doingChat); (3) `db.useStreaming: false` in the
  fixture so the server-backed path uses JSON (the SSE-streaming
  path is already covered by the Phase 6-2 unit tests); (4)
  fixture named `echo-basic` rather than encoding dual-mode in the
  name. Out of scope: converting any of the existing 25 fixtures
  to dual-mode (they use providers without server-side
  implementations yet — each becomes eligible as its provider
  slice lands in Phase 6-4+); booting a real Fastify instance in
  the SPA test harness (route already covered by
  `server/fastify/__tests__/generation.completion.test.ts` via
  app.inject; the dual-mode runner only needs a fetch-shaped
  fake); orchestrator-level SSE streaming wiring. Verification:
  `pnpm test` (476 across 46 files, up from 474/45 — +1 local,
  +1 server-backed), `pnpm check`, `pnpm api:test` (145
  unchanged), `pnpm build` all green.

- **Phase 6-2 - client adapter for echo (flag-gated).** Done
  2026-05-22. Browser-side adapter that posts to the Phase 6-1
  route. New module `src/ts/process/request/serverCompletion.ts`
  exports three functions: `formatToServerProvider` (maps
  `LLMFormat.Echo` to `'echo'`; every other format returns `null`),
  `getServerCompletionProvider` (combines `isFastifyServer` +
  `db.useServerGeneration` + `!previewBody` + format gate into a
  single nullable provider), and `requestServerCompletion` (does
  the actual POST to `/api/v1/generate/completion`). The branch
  lives in `src/ts/process/request/request.ts` inside
  `requestChatDataMain`, immediately after `reformater(...)` and
  before the format `switch`; it short-circuits to the server path
  when `getServerCompletionProvider` returns non-null and otherwise
  falls through to the existing dispatch. The dispatch helper at
  `src/ts/process/dispatch/dispatchRequest.ts` is unchanged. The
  outer `requestChatData` retry / fallback / escape / trigger /
  pluginV2 replacer wrappers continue to apply because the branch
  sits below them. Adapter behavior: non-streaming response goes
  through `response.json()` and is mapped to
  `{type: 'success' | 'fail', result, model?}`; streaming response
  iterates the `ReadableStream<Uint8Array>` body and parses the
  Phase 6-1 SSE envelope (`event: chunk` + `event: done`),
  accumulating token frames into a single string returned as
  `{type: 'success', result}` (orchestrator-level streaming wiring
  is deferred — see "out of scope" below). Auth flows through
  `getNodeServerProxyAuth()`. Errors map to the `requestDataResponse`
  fail shape: HTTP non-2xx extracts `body.reason` then `body.error`,
  falling back to `HTTP <status>`; fetch exceptions return
  `Network error: <msg>` (or `Aborted` if the signal is already
  aborted). Echo-specific payload: `options.echo.message` from
  `db.echoMessage` and `options.echo.delayMs` from
  `(db.echoDelay ?? 0) * 1000` (seconds → milliseconds), mirroring
  the local `requestEcho` defaults. New DB field
  `useServerGeneration?: boolean` (defaulting `false` via the
  normalization in `setDatabase`); migrations are unnecessary
  because the gate reads `=== true`. 20 new tests in
  `src/ts/process/request/tests/serverCompletion.test.ts`:
  `formatToServerProvider` (3 cases), `getServerCompletionProvider`
  (5 cases pinning the four gate failures and the happy path),
  non-streaming (7 cases — body / headers shape, delayMs scaling,
  server fail, 501 reason extraction, 401 error extraction,
  network error, pre-aborted signal), and streaming (5 cases —
  single chunk + done, multi-chunk concat, partial-frame split
  across reads, mid-stream abort, missing body). The
  `../../modules` mock pattern from Phase 5-27 was reused to
  neutralize a `moduleUpdate` `$effect` chain triggered by
  `setDatabase` in the test harness. Decisions locked: (1) branch
  inside `requestChatDataMain`, not `dispatchRequest` (the
  Phase 6 doc's "`requestChatData` keeps both modes side by side"
  phrasing maps to this seam); (2) flag stored in `db`
  (`useServerGeneration`) rather than `globalThis` (server-injected
  flag is a Phase 9 concern); (3) hand-rolled SSE parser (~30
  lines) instead of a dependency; (4) preview-prompt
  (`targ.previewBody === true`) stays on the local path because
  preview is a debugging tool for the local request-shaping code,
  not the server-routing code. Out of scope: dual-mode sendChat
  fixture sweep (next slice — the existing 26 fixtures
  `vi.mock('../request/request')` at the function-export level so
  the server path is never reached today; that harness rework +
  adding an echo-routed fixture is Phase 6-3); orchestrator-level
  streaming wiring (the adapter accumulates SSE token frames into a
  single string today — when the first real streaming provider
  lands the adapter will return `{type: 'streaming', result:
  ReadableStream<StreamResponseChunk>}` to feed
  `consumeStreamResponse`); additional providers (each is its own
  slice). Verification: `pnpm test` (474 across 45 files, up from
  454/44), `pnpm check`, `pnpm api:test` (145 unchanged), `pnpm
  build` all green. Existing 26 sendChat fixtures unaffected (flag
  defaults off).

- **Phase 6-1 - generate/completion route + echo provider.** Done
  2026-05-22. **Phase 6 opens.** Server-only slice that lands the
  Stage 3 server boundary: a new `POST /api/v1/generate/completion`
  route gated by `requireAuth`, JSON-schema-validated, that dispatches
  on an explicit `provider` discriminant. Only `echo` is implemented;
  every other provider returns `501` with
  `{reason: 'provider not implemented in Phase 6-1: <name>'}`.
  Non-streaming responses match the browser-side `requestDataResponse`
  shape (`{type: 'success' | 'fail', result}`) so the next slice's
  client adapter can map server output 1:1 into the dispatch helper's
  `req` variable. Streaming responses use the envelope from the phase
  doc: `event: chunk` frames with `{"type":"token","content":"..."}`
  payloads, then `event: done` with `{"finishReason":"stop"}`. Client
  disconnect aborts via `req.raw.on('close', ...)` → `AbortController`.
  Echo accepts `options.echo.message` and `options.echo.delayMs`;
  defaults (`'Echo Message'` / `0`) mirror the browser-side
  `requestEcho`. Files added: `server/fastify/src/generation/echo.ts`
  (pure dispatcher; non-streaming `runEcho` returns
  `{type, result, aborted?}`, streaming `runEchoStream` is an
  `AsyncGenerator<{kind: 'token' | 'done', ...}>`), and
  `server/fastify/src/routes/generation.ts` (route plugin).
  `app.ts` registers the plugin. 18 new tests across
  `server/fastify/__tests__/echo.test.ts` (9 cases pinning the
  dispatcher) and `server/fastify/__tests__/generation.completion.test.ts`
  (9 cases pinning auth, schema validation for `provider` / `messages`
  / `stream`, the 501 unknown-provider path, echo non-streaming happy
  path, default-message fallback, streaming SSE envelope, and the
  `delayMs` timing). No client wiring; the dispatch helper at
  `src/ts/process/dispatch/dispatchRequest.ts` still uses local-mode
  `requestChatData`. Decision recorded in this slice: the wire
  contract carries an explicit `provider` discriminant instead of
  the server resolving it from the model id via `modellist.ts`. The
  alternative (server-side `getModelInfo`) was rejected because
  `modellist.ts` is browser-coupled (top-level imports of
  `getDatabase`, `DBState`, `customProviderStore`, `pluginV2`,
  `customV3ProviderMetaStore`, `fetchNative`) and two of the format
  dispatches (`reverse_proxy` reading `db.customAPIFormat`,
  `xcustom:::` reading `db.customModels`) depend on browser DB state
  that the server should not hold until Phase 9; the client adapter
  in the next slice will carry a small `format → provider` map.
  Verification: `pnpm api:test` (145 tests across 12 files, up from
  127/10), `pnpm check`, `pnpm test` (454 SPA tests across 44 files),
  `pnpm build` all green.

- **Phase 5 - coordinator closeout slice 28.** Done 2026-05-22.
  **Phase 5 is closed.** Final cleanup pass on
  `src/ts/process/index.svelte.ts`. Removed the vestigial
  `isAborted` local plus dead `chats` and `currentTokens`
  reassignments; `history.chats` now feeds `buildMemoryWindow`
  inline. Hoisted a single
  `const setProcessStage = (stage) => chatProcessStage.set(stage)`
  at the top of the try block, replacing three inlined callbacks
  at the `buildMemoryWindow` / `dispatchRequest` / `runStage4`
  call sites; converted `let → const` for `promptInfo`,
  `unformated`, `hasCachePoint`, and the `normalizeTemplate`
  destructure where none are reassigned; dropped a stray
  double-blank line after the `renderFinalPrompt` call.
  No behavior changes. All 26 sendChat fixtures stay green
  without re-recording; `pnpm check`, `pnpm test`, `pnpm api:test`,
  and `pnpm build` all clean. **Final coordinator size: 445
  lines (down from 1625 at Phase 5 start — 73% reduction).**

  Phase 5 retrospective: 28 slices, 29 extracted modules (under
  `src/ts/process/` and the `promptAssembly/`, `promptBudget/`,
  `postGeneration/`, and `dispatch/` subdirectories), 9 fixture
  gates landed during Phase 5 (raising the snapshot count from
  17 to 26), and 454 unit tests plus 127 API tests green at
  closeout. Two pattern wrinkles documented in the slice
  history: `.svelte.ts` files cannot be reliably intercepted by
  `vi.mock` (forced workarounds in 5-20 and 5-27), and the
  web-mode default in `setDatabase` forcibly clears
  `promptInfoInsideChat` (loadFixture re-applies it for F4-F,
  and `sendChatContext.test.ts` re-applies it in its seedDb).

- **Phase 5 - entry context slice 27.** Done 2026-05-22.
  Extracted the sendChat entry-context setup into
  `src/ts/process/sendChatContext.ts`. The new helper takes
  `chatProcessIndex` plus `chatAdditonalTokens` and returns the
  selected character/chat, chatroom, promptInfo, tokenizer, and
  max context token budget. Owns the preset-chain selection
  (gated on `chatProcessIndex === -1` and `db.presetChain`;
  random pick from comma-separated names; `changeToPreset(id, true)`
  on hit, `alertToast` on miss), `db.statics.messages += 1`, the
  `selectedCharID` store lookup, the `nowChatroom.lastInteraction`
  stamp, `selectedChat = nowChatroom.chatPage`, the chatId
  backfill loop (with the `??` quirk that intentionally
  preserves an existing empty-string `chatId`), the promptInfo
  seed (gated on `db.promptInfoInsideChat`; captures
  `promptName` from the active botPreset and `promptToggles`
  from `parseToggleSyntax(...)` plus `getModuleToggles()` with
  `'select'`/`'text'`/raw='1' branches),
  the gpt-vs-non-gpt `caculatedChatTokens` choice (5 vs 3) with
  the `arg.chatAdditonalTokens` override, the `ChatTokenizer`
  construction with `'noName'`/`'name'` strategy, and the
  `maxContextTokens` read. The coordinator keeps the closures
  (`throwError`, `runCurrentChatFunction`, `reformatContent`,
  `findCharacterbyIdwithCache`) plus the `currentChar` /
  `currentChat` assignment in scope because
  `runCurrentChatFunction` closes over `currentChar`. Eight imports
  left `index.svelte.ts`: `changeToPreset`, `alertToast`,
  `parseToggleSyntax`, `getModuleToggles`, `ChatTokenizer`,
  `selectedCharID`, `MessagePresetInfo`, `v4`. uuid now has zero
  call sites in the coordinator. Helper test
  `sendChatContext.test.ts` adds 15 cases pinning preset-chain
  hit/miss/reentrant (verifying side effects via
  `DBState.db.botPresetsId` rather than mocking `changeToPreset` —
  vi.mock on `database.svelte.ts` did not reliably intercept
  exports, mirroring the known `.svelte.ts` mocking limitation from
  slice 5-20), the stats counter, lastInteraction stamp, chatId
  backfill (with the `??` empty-string preservation quirk),
  promptInfo for `promptInfoInsideChat=false`/`=true` with
  `botPresets[id].name`, select / text / boolean toggle harvest,
  tokenizer gpt / non-gpt / override branches, and selectedChar /
  selectedChat lookup. All 26 sendChat fixtures stay green without
  re-recording; `index.svelte.ts` drops from 515 to 448 lines —
  under the 500-line stretch goal that slice 5-28 targets.

- **Phase 5 - stage-4 orchestrator slice 26.** Done 2026-05-22.
  Extracted the stage-4 closeout into
  `src/ts/process/postGeneration/runStage4.ts`. Owns the stage-3
  duration writeback (`stageTimings.stage3Duration` +
  `generationInfo.stageTiming.stage3`), the stage-4 transition
  (`setProcessStage(4)` + `stageTimings.stage4Start`), and four
  exit branches: (a) `resendChat=true` calls `finalizeStage4`
  first then returns `{status: 'resend'}`; (b)
  `viewScreen='emotion' && !emoChanged && !abortSignal.aborted`
  routes to `runEmotionEmbeddingFallback` or `runEmotionLlmFallback`
  based on `db.emotionProcesser` and returns `{status: 'done'}`
  _without_ calling `finalizeStage4` (matches production's
  `return true` from those branches); (c) `viewScreen='imggen'`
  calls `runImggenStableDiff` then `finalizeStage4`; (d) default
  path calls `finalizeStage4`. The notification
  (`fireDesktopNotification(result)` under `db.notification`) and
  provider-emotion application via `applyEmotionFromResponse` fire
  before the routing branches and may flip
  `emoChanged` to true, short-circuiting the emotion fallback.
  `currentChar.inlayViewScreen=true` skips both emotion and
  imggen branches entirely.
  Seven imports left `index.svelte.ts`:
  `fireDesktopNotification`, `applyEmotionFromResponse`,
  `runImggenStableDiff`, `runEmotionLlmFallback`,
  `runEmotionEmbeddingFallback`, `loadAndTrimCharEmotion`,
  `finalizeStage4`. The resend recursion (`return await
sendChat(chatProcessIndex, {signal: abortSignal})`) stays in the
  coordinator for the same circular-import reason as the
  auto-continue handoff. Helper test `runStage4.test.ts` mocks
  all seven delegates and adds 12 cases pinning the stage
  transition, resend short-circuit, notification gate, provider-
  emotion short-circuit, emotion fallback routing (both
  processors), the `emoChanged=true` and `aborted=true` skip
  cases, imggen routing, inlayViewScreen skip, and the default
  path. All 26 sendChat fixtures stay green without re-recording;
  `index.svelte.ts` drops from 558 to 515 lines.

  Also fixed a latent type-check issue in
  `orchestrateResponse.test.ts` (slice 5-25): three `as
DispatchSuccessReq` casts now use `as unknown as
DispatchSuccessReq` to satisfy strict-mode conversion rules in
  svelte-check. The cast was passing vitest but failing
  svelte-check; only surfaced when this slice re-ran the full
  `pnpm check`.

- **Phase 5 - response orchestration slice 25.** Done 2026-05-22.
  Extracted the post-dispatch response stage into
  `src/ts/process/postGeneration/orchestrateResponse.ts`. Owns the
  streaming / non-streaming branch chooser: streaming routes
  through `consumeStreamResponse`, then post-stream abort gate
  (`streamAborted || abortSignal.aborted`), `addRerolls`,
  `applyOutputTrigger` (reassigning local `currentChat` from
  `triggerChat ?? chat`), `runInlayScreen` with optional promise
  resolution and DB writeback, and conditional `sayTTS` under
  `db.ttsAutoSpeech`. Non-streaming routes through
  `applyNonStreamResponse`, then `addRerolls` (gated on
  `mrerolls.length > 1`), `applyOutputTrigger` writing
  `triggerChat` directly to DB without touching the local
  `currentChat` (asymmetry preserved verbatim). Both branches
  then run `evaluateAutoContinue`; on `shouldContinue` the helper
  returns `{ status: 'continue', resultTokens }` and the
  coordinator handles the actual handoff (releases `doingChat`,
  resets `iOwnDoingChat`, recurses into `sendChat`) so the helper
  avoids a circular import. Otherwise `evaluateIgp` runs and the
  helper returns `{ status: 'done', currentChat, result,
emoChanged, resendChat }`. After extraction these imports left
  `index.svelte.ts` (eight total): `consumeStreamResponse`,
  `applyNonStreamResponse`, `applyOutputTrigger`,
  `runInlayScreen`, `sayTTS`, `addRerolls`, `evaluateAutoContinue`,
  `evaluateIgp`. Helper test `orchestrateResponse.test.ts` mocks
  all eight delegates and adds 7 cases: streaming happy path with
  inlay + TTS, streaming `streamAborted=true` short-circuit,
  streaming with external `abortSignal.aborted`, non-streaming
  with `triggerChat` writeback + `addRerolls` for `mrerolls > 1`,
  non-streaming `mrerolls.length === 1` skip, auto-continue
  handoff (skips IGP), and the done-path return shape. All 26
  sendChat fixtures stay green without re-recording;
  `index.svelte.ts` drops from 637 to 558 lines.

- **Phase 5 - dispatch request slice 24.** Done 2026-05-22.
  Extracted the provider dispatch boundary into
  `src/ts/process/dispatch/dispatchRequest.ts`. Owns the stage-3
  transition (`setProcessStage(3)` + `stageTimings.stage3Start`),
  the `arg.preview` early return (carrying the formated array so
  the coordinator can write `previewFormated`), `generationId =
v4()` + `getGenerationModelString()` + `generationInfo`
  construction, the `requestChatData(...)` invocation with the
  full request payload (formated, biasString, currentChar,
  useStreaming, isGroupChat, bias, continue, chatId,
  imageResponse, previewBody = `arg.previewPrompt`, escape,
  rememberToolUsage), the `req.model` override into
  `generationInfo.model` via `getGenerationModelString(req.model)`,
  the `arg.previewPrompt + req.type === 'success'` preview-body
  early return, the post-provider `abortSignal.aborted` check, and
  the `req.type === 'fail'` early return. Returns a 5-variant
  discriminated union (`preview` / `previewPrompt` / `aborted` /
  `failed` / `success`); the coordinator owns the
  `previewFormated` / `previewBody` module-level writes, the
  `throwError(reason)` call on failure, and `generationInfo`
  attachment. The `failed` variant carries `generationInfo` so
  the coordinator assigns it before `throwError`, preserving the
  `provider-error` fixture's `reportSendChatError(...,
generationInfo)` behavior. F4-G `preview-prompt` landed first,
  pinning the `previewPrompt: true` branch. After extraction
  these imports left `index.svelte.ts`: `getGenerationModelString`,
  `requestChatData` (uuid `v4` moved later to `sendChatContext.ts`
  for the chatId backfill). Two `console.log` debug calls at the old lines
  473/476 were dropped during the move. Helper test
  `dispatchRequest.test.ts` adds 11 cases covering preview
  short-circuit, previewPrompt success / fail-fallthrough,
  streaming / multiline / non-streaming success variants,
  `req.model` override propagation, fail with carried
  `generationInfo`, post-provider abort, previewPrompt priority
  over abort, and the request payload (formated / biasString /
  continue / escape / useStreaming / isGroupChat). All 26 sendChat
  fixtures stay green without re-recording; `index.svelte.ts`
  drops from 662 to 637 lines.

- **Phase 5 - final prompt render slice 23.** Done 2026-05-21.
  Extracted ~324 lines of prompt rendering into
  `src/ts/process/promptAssembly/renderFinalPrompt.ts`. Owns
  `pushPrompts` (with the gpt/claude/openrouter/reverse_proxy
  consecutive-system coalesce), the `[Continue the last response]`
  push under the same model gate, the 12-card prompt template
  walker (persona / description / authornote / lorebook /
  postEverything / plain / jailbreak / cot / chatML / chat /
  memory / cache), the non-template `formatingOrder` fallback,
  the automatic 3-deep `user`-role cache-point walk-back inside
  the `chat` card (gated on `automaticCachePoint && !hasCachePoint`),
  the explicit `cache` card depth walk, the final trim pass, the
  character `depth_prompt` splice at `length - depth`, and the
  `runLuaEditTrigger('editRequest', ...)` calls for both the
  formated array and (when prompt-info text capture is on) the
  parallel `promptBodyformatedForChatStore`. Returns
  `{ formated, promptText? }`; `promptText` is set only when both
  `promptInfoInsideChat` and `promptTextInfoInsideChat` are
  enabled, and the coordinator attaches `promptInfo.promptText`
  conditionally. F4-F `prompt-info-text` landed first, pinning
  `messages[1].promptInfo.promptText` for a template that
  exercises persona / description / authornote (defaultText) /
  plain. `loadFixture.ts` re-applies
  `db.promptInfoInsideChat` / `db.promptTextInfoInsideChat`
  post-`setDatabase` because the web-mode default in
  `setDatabase` forcibly clears `promptInfoInsideChat` to false.
  After extraction, these imports left `index.svelte.ts`:
  `parseChatML`, `prebuiltAssetCommand`, `runLuaEditTrigger`,
  `systemizeChat`. Helper test `renderFinalPrompt.test.ts` adds
  21 cases covering formatOrder coalesce gating, continue marker
  gating, persona / description / authornote innerFormat
  substitution, plain card role conversion, chatML parsing,
  jailbreak / cot toggle suppression, memory card innerFormat,
  chat card slice math (full / negative-end / start>=end), the
  automatic cache-point walk-back (with and without
  `hasCachePoint`), the explicit cache card with `role='all'`,
  the depth_prompt splice, the editRequest pass-through and
  mutation paths, and the three prompt-info text capture paths
  (innerFormat captured raw, plain card content captured rendered,
  globalNote excluded, dual editRequest dispatch order, suppressed
  when either flag is off). All 25 sendChat fixtures stay green
  without re-recording; `index.svelte.ts` drops from 968 to 662
  lines.

- **Phase 5 - memory window slice 22.** Done 2026-05-21.
  Extracted the long-term-memory branching and the memory-card
  split into `src/ts/process/promptAssembly/buildMemoryWindow.ts`.
  The helper takes
  `{ chats, currentTokens, maxContextTokens, currentChat, nowChatroom, tokenizer, selectedChar, selectedChat, memoryCardUsed, promptTemplate, unformated, stageTimings, throwError, setProcessStage }`
  and returns a stopped / non-stopped discriminated union carrying
  `{ chats, currentTokens, currentChat, memories }` on success.
  The coordinator narrows with `memWindow.stopSending === true`.
  On the `nowChatroom.supaMemory && DBState.db.hypaV3` branch the
  helper brackets `hypaMemoryV3` with stage-timing transitions
  (`stage1Duration`, `stage2Start`, `stage2Duration`) and a
  `setProcessStage(2)` / `setProcessStage(1)` callback pair,
  persisting `hypaV3Data` to both the supplied `currentChat` and
  `DBState.db.characters[selectedChar].chats[selectedChat]`. A
  HypaV3 error writes back any partial memory before stopping.
  The fallback (non-Hypa) branch shifts the oldest chats until
  under budget, stops with `language.errors.toomuchtoken` if
  `chats.length <= 1` still exceeds, and records
  `currentChat.lastMemory`. The memory-card split rewrites
  `unformated.chats` per `memoryCardUsed`: `supaMemory` /
  `hypaMemory` rows either become returned `memories[]` entries
  with the originals zeroed (then filtered) or get wrapped with
  `<Previous Conversation>…</Previous Conversation>`. Other rows
  pick up `removable: true`. Without a prompt template the trailing
  chat is promoted to `unformated.lastChat` first. F4-B
  `prompt-template-memory-cache` (landed during 5-19) pins the
  Hypa happy path; no new fixture was added. The `hypaMemoryV3`
  import moved out of `index.svelte.ts`. Two pre-existing
  `console.log` debug calls inside the Hypa branch were dropped.
  Helper test `buildMemoryWindow.test.ts` adds 11 cases:
  Hypa happy path, Hypa error with memory writeback, Hypa error
  without memory, `supaMemory: false` skip, fallback noop with
  `lastMemory`, fallback trim with `lastMemory`, fallback
  `toomuchtoken`, memory-card split with `memoryCardUsed=true`
  (extract + zero + filter + non-memory `removable: true`),
  memory-card split with `memoryCardUsed=false`
  (`<Previous Conversation>` wrap), `!promptTemplate` last-chat
  promotion, and empty-content filter with multimodal preservation.
  All 24 sendChat fixtures stay green without re-recording;
  `index.svelte.ts` drops from 1017 to 968 lines.

- **Phase 5 - history assembly window slice 21.** Done 2026-05-21.
  Extracted the surrounding history-assembly machinery into
  `src/ts/process/promptAssembly/buildHistoryWindow.ts`:
  `exampleMessage` + initial tokenization, the
  `[Start a new chat]` marker (with the `novelai` and
  `trimStartNewChat` gates), the `makeMs` filter that handles
  `disabled: true` and `disabled: 'allBefore'`, first-message
  resolution from `firstMessage` / `alternateGreetings[fmIndex]`
  with `processScript('editprocess')` and the `sendName` prefix,
  start-trigger handling with `setCurrentChat` on chat mutation
  plus the `stopSending` early return, the per-message loop
  calling the 5-20 `formatHistoryMessage`, and the depth-prompt
  token preflight. The helper returns a stopped / non-stopped
  discriminated union with success metadata. The coordinator narrows with
  `if (history.stopSending === true)` because the project tsconfig
  has `strict: false`, which weakens boolean discriminant narrowing.
  Two F4-E gate fixtures landed first with one
  `vi.mock('../triggers')` override keyed by
  `triggerscript[0].comment`: `start-trigger-control` pins the
  mutation path, and `start-trigger-stop` pins the early return
  (`stages: [1]`, no provider calls or side effects, no new
  assistant row, `doingChat: false`).
  After extraction these imports left `index.svelte.ts`:
  `Message`, `setCurrentChat`, `getUserName`, `processScript`,
  `exampleMessage`, `runTrigger`, and `formatHistoryMessage`.
  Two pre-existing debug logs in the region were dropped. Helper
  test `buildHistoryWindow.test.ts` adds 10 cases for examples,
  marker gates, `makeMs`, first-message selection, start-trigger
  behavior, and depth prompts. All 24 sendChat fixtures stay green
  without re-recording; `index.svelte.ts` drops from 1101 to 1017
  lines.

- **Phase 5 - history message formatter slice 20.** Done 2026-05-21.
  Extracted the ~150-line per-message loop body into
  `src/ts/process/promptAssembly/formatHistoryMessage.ts`. The
  helper takes
  `{ msg, index, totalCount, currentChar, usingPromptTemplate, findCharacterbyIdwithCache }`
  and returns the assembled `OpenAIChat`. The coordinator loop
  becomes a four-line wrapper that calls the helper, pushes onto
  `chats`, and tokenizes. The per-sendChat
  `findCharacterbyIdwithCache` cache stays in the coordinator and
  is threaded as a callback. The pre-existing unused `name`
  local is preserved (renamed `_name`) because the call has the
  cache-population side effect that the sendName branch relies
  on. After extraction, `index.svelte.ts` dropped these imports:
  `processScriptFull`, `getInlayAsset`, `runImageEmbedding`,
  `getModuleAssets`, `readImage`.
  F4-D `history-media-fallback` was landed first. It covers a
  no-vision model + `{{inlay::test-image}}` user message with a
  stubbed `runImageEmbedding`, pinning that the caption is
  appended (`"Look: [fake caption]"`) and the inlay tag is
  stripped. The `{{asset_prompt::icon}}` half of the original
  F4-D scope is deferred: vitest cannot reliably `vi.mock` the
  `.svelte.ts` module (`globalApi.svelte`) where `readImage`
  lives. The 5-20 unit test covers the `{{asset_prompt::missing}}`
  no-op branch instead; full asset-icon coverage will return
  with a different mocking strategy.
  Helper test `formatHistoryMessage.test.ts` adds 15 cases:
  basic conversion (user / char / chatId backfill), inlay
  handling (caption append, video first-wins, signature
  unbounded, char-message strip, char-message inlayeddata
  record), Thoughts extraction (strip + accumulate, depth-clamp
  drop, depth -1 no-op), sendName wrapper (on under template,
  off without template), asset_prompt no-match strip, and
  empty-multimodals deletion. All 22 sendChat fixtures stay
  green without re-recording; `index.svelte.ts` drops from 1241
  to 1101 lines.

- **Phase 5 - template token preflight slice 19.** Done 2026-05-21.
  Extracted the ~170-line preflight walker (per-card token math +
  `memoryCardUsed` / `hasCachePoint` flag setters plus the
  no-template branch that tokenizes every `unformated` slot) into
  `src/ts/process/promptBudget/preflightTemplateTokens.ts`. The
  helper returns `{ addedTokens, memoryCardUsed, hasCachePoint }`;
  the coordinator does `currentTokens += preflight.addedTokens`
  and keeps `hasCachePoint` as `let` (the final render walker
  reassigns it inside the `case 'chat'` automatic walk-back). The
  local `systemizeChat` function moved out of `index.svelte.ts`
  into `src/ts/process/promptAssembly/systemizeChat.ts` so both
  the preflight helper and the still-inline final render walker
  import it from the same module. F4-B
  `prompt-template-memory-cache` was landed first; it combines a
  template `memory` card (innerFormat-wrapping the Hypa V3 mock
  summary) with an explicit `cache` card (depth: 2, role: 'user')
  under `automaticCachePoint: true`, pinning that the explicit
  cache marker suppresses the automatic walk-back. Helper test
  `preflightTemplateTokens.test.ts` covers 16 cases:
  no-template path (every slot tokenized, empty input), flag
  setters (memory + cache), per-card branches (jailbreak / cot
  toggles, postEverything with `postEndInnerFormat`), and the
  `chat` card range math (negative `rangeStart`, `'end'`
  rangeEnd, `start >= end`, `-1000` sentinel, `systemizeChat`,
  `chatAsOriginalOnSystem`). All 21 sendChat fixtures stay green
  without re-recording; `index.svelte.ts` drops from 1419 to
  1241 lines.

- **Phase 5 - lorebook placement slice 18.** Done 2026-05-21.
  Extracted `loadLoreBookV3Prompt()` plus the `replaceposition` /
  `resolvePosition` closures, four lore-placement loops (normal,
  description with `before_desc` unshift, postEverything system,
  postEverything assistant), the inject-mode `positionParser`
  closure, and the `depthPrompts` filter into
  `src/ts/process/promptAssembly/buildLorebookContext.ts`. The
  helper mutates `unformated.lorebook` / `.description` /
  `.postEverything` in place and returns
  `{ resolvePosition, positionParser, depthPrompts }`. The two
  depth-prompt loops at the token-preflight and history-splice
  sites stay inline in `sendChat` because they execute at
  different stages and consume `lore.depthPrompts` directly. The
  coordinator now stages `buildPersona` and
  `buildInlayViewInstruction` _before_ `buildLorebookContext` so
  the original postEverything order is preserved: cot →
  inlay-view → lore depth=0 system → lore depth=0 assistant
  (last, for prefill). Two pre-existing `console.log` calls
  (`console.log(normalActives)` and `console.log(injectionLorePosSet)`)
  were dropped during the move - both were development noise
  that survived earlier slices. F4-C `lorebook-position-depth`
  was landed first; it exercises `before_desc`, `after_desc`,
  `@@depth 1`, `@@reverse_depth 1`, `@@position pt_<name>`, and
  `{{position::<name>}}` resolution in one fixture. Helper test
  `src/ts/process/__tests__/buildLorebookContext.test.ts` adds
  12 cases covering placement, `resolvePosition` (substitution,
  no-op, unresolved drop), `positionParser` passthrough, and
  `depthPrompts` filtering. All 20 sendChat fixtures stay green
  without re-recording; `index.svelte.ts` drops from 1543 to
  1419 lines.

- **Phase 5 - static prompt sections slice 17.** Done 2026-05-21.
  Extracted the author-note + chain-of-thought block (previously
  21 lines around `index.svelte.ts:283-303`) and the
  persona + inlay-view block (previously 24 lines around
  `index.svelte.ts:371-394`) into
  `src/ts/process/promptAssembly/buildStaticPromptSections.ts` as
  four pure functions: `buildAuthorNote`, `buildCotInstruction`,
  `buildPersona`, and `buildInlayViewInstruction`. Each returns
  `OpenAIChat[]` (0 or 1 entries) and the coordinator stages
  each push at the correct point in the `unformated` assembly so
  the relative `postEverything` ordering (cot before
  description/lorebook, inlay-view after) stays explicit at the
  call site. `buildCotInstruction` takes `usingPromptTemplate` as
  its only argument; everything else reads from `DBState` or the
  passed `currentChar` / `currentChat`. The `getAuthorNoteDefaultText`
  / `getPersonaPrompt` imports in `index.svelte.ts` were dropped
  along with the inlined logic. Helper test
  `src/ts/process/__tests__/buildStaticPromptSections.test.ts`
  covers 16 cases: author-note chat-note vs template-default vs
  empty (4), cot off / on / off-via-customChainOfThought /
  no-template-suppression-doesn't-apply (5), persona on / off
  (2), and inlay-view emotion (with images, empty images,
  feature-off) + imggen + viewScreen-none (5). All 19 sendChat
  fixtures stay green without re-recording; `index.svelte.ts`
  drops to 1543 lines.

- **Phase 5 - template-normalization slice 16.** Done 2026-05-21.
  Extracted the prompt-template clone, implicit `postEverything`
  insertion, and utility-bot forced template (originally lines
  273-319 of `index.svelte.ts`) into
  `src/ts/process/promptAssembly/normalizeTemplate.ts`. The
  coordinator call site is one line: a destructure of
  `{ promptTemplate, usingPromptTemplate }`. `usingPromptTemplate`
  intentionally reflects the user's _original_ choice (so the
  forced utility template does not flip the downstream
  `usingPromptTemplate && ...` gates that key off whether the user
  opted into template mode). Two gate fixtures landed in the same
  slice:
  - `prompt-template-basic` (F4-A): template with persona,
    description, authornote, plain, chatML, chat - no explicit
    `postEverything`. `chainOfThought: true` so the implicit
    `postEverything` add is observable as the trailing cot system
    message in the snapshot.
  - `utility-bot-template` (F4-H): `utilityBot: true`, no user
    template, default `utilOverride: false`. Pins that the forced
    6-card template _replaces_ the default `mainPrompt` /
    `globalNote` so `formated` shrinks to description plus the
    start-new-chat marker plus the user message. `inputTokens`
    drops from `233` (simple-send) to `30`.
    Helper test `src/ts/process/__tests__/normalizeTemplate.test.ts`
    covers eight branches: no template, implicit-postEverything add,
    postEverything-already-present, db state non-mutation,
    utility-bot forces template, utility-bot + `utilOverride: true`
    keeps user template, `utilOverride: true` with no template still
    forces the utility template, and non-utility passthrough. All 19
    fixtures stay green; `index.svelte.ts` is now 1580 lines.

- **Docker runtime dependencies.** Done 2026-05-21. Moved
  `@fastify/websocket` and `tsx` from `devDependencies` to
  `dependencies` in `package.json` so the Dockerfile's
  `pnpm install --prod --frozen-lockfile` in the `deps` stage
  resolves both packages before they are copied into the
  `runtime` stage. Verified by re-running the prod-only install
  in isolation: `node_modules/tsx/dist/cli.mjs` and
  `node_modules/@fastify/websocket/package.json` are present;
  dev-only deps (`svelte-check`, `vitest`) stay absent. The
  Dockerfile and `docker-compose.yml` are unchanged.

- **Phase 5 - extraction slices 1-3.** Done 2026-05-21.
  `3c5a92b2` extracted `evaluateAutoContinue` to
  `src/ts/process/autoContinue.ts`; `75e266f5` made
  `sendChat` own the `doingChat` lease it acquires and clear it in
  `finally`; `9c3713bb` extracted `reportSendChatError` to
  `src/ts/process/sendChatErrors.ts` with targeted tests.

- **Phase 5 - post-generation slices 4-8.** Done 2026-05-21.
  `a2162545`, `da124c9b`, `0f44c35f`, `bd152cdf`, and
  `bfa128b4` extracted desktop notification, IGP dispatch,
  stage-4 timing writeback, response-emotion handling, and
  imggen stable-diff dispatch under
  `src/ts/process/postGeneration/`, each with a focused test.

- **Phase 5 - plain-prompt sections slice 15.** Done 2026-05-21.
  Extracted the non-template main / jailbreak / globalNote
  assembly (gated by `!currentChar.utilityBot && !promptTemplate`)
  into `src/ts/process/promptAssembly/buildPlainPromptSections.ts`.
  The helper returns `{ main, jailbreak, globalNote }` as
  `OpenAIChat[]` and keeps the `@@role`-tagged `formatPrompt`
  closure internal. The coordinator gate stays at the call site;
  only the assembly body moved. Targeted test
  `src/ts/process/__tests__/buildPlainPromptSections.test.ts`
  covers `mainPrompt` only, `systemPrompt` with/without
  `{{original}}`, the empty-string fallback, `additionalPrompt`
  gated by `db.promptPreprocess` (three branches),
  `jailbreakToggle` on/off, `replaceGlobalNote` present/absent,
  and the `formatPrompt` `@@` / `@@@` / implicit-system parsing.
  All 17 sendChat fixtures stayed green without re-recording.

- **Phase 5 - description-assembly slice 14.** Done 2026-05-21.
  Extracted the leading character-description system message
  (`desc` + `additionalInformations` + `personality` + `scenario`,
  each run through `risuChatParser`) into
  `src/ts/process/promptAssembly/buildDescription.ts`. The
  coordinator now calls
  `unformated.description.push(await buildDescription(currentChar, currentChat))`,
  matching the seam style used by Phase 5-13's `promptBudget/`.
  Targeted test
  `src/ts/process/__tests__/buildDescription.test.ts` covers
  desc-only, personality / scenario combos, exact concat order,
  the `descriptionPrefix` gate on `db.promptPreprocess` (both
  branches), and a call-time-read check on `DBState`. All 17
  sendChat fixtures stayed green without re-recording.

- **Phase 5 - request-budget slice 13.** Done 2026-05-21.
  `1de94ca9` extracted the post-`editRequest` token recheck +
  `outputTokens` estimate into
  `src/ts/process/promptBudget/finalizeRequestBudget.ts`. The
  helper returns a discriminated ok / overflow result so the
  coordinator keeps ownership of the `throwError` exit. Targeted test
  `src/ts/process/__tests__/finalizeRequestBudget.test.ts` covers
  happy path, `outputTokens` clamp, removable-trim success,
  multimodal-only survival, and the no-trim-possible overflow.

- **Phase 5 - emotion/output/response slices 9-12.** Done
  2026-05-21. `3509972f`, `79ce8ce5`, `4424140e`, `d67543b2`,
  `7519c384`, `241a6f13`, and `d926228a` extracted char-emotion
  store helpers, LLM and embedding emotion fallbacks, collapsed
  outer emotion dispatch, deduped output-trigger handling, and
  moved the non-streaming and streaming response loops to
  `postGeneration/nonStreamResponse.ts` and
  `postGeneration/streamResponse.ts`.

- **Phase 0 removals - Group chat.** Done 2026-05-20. Single
  commit; the type narrowing forced types, runtime, and UI to
  land together. `isGroupChat` was preserved as a `false`
  back-compat shim for user scripts. See [`removals.md`](removals.md)
  for the as-landed inventory.

- **Phase 0 removals - Peer multi-user chat.** Done 2026-05-20.
  See [`removals.md`](removals.md) for the as-landed inventory.

- **Phase 0 removals - Risu Account Sync + Drive sync.** Done
  2026-05-20. Landed as a single commit. The `backuplocal.ts`
  helpers were preserved (moved to `src/ts/storage/backup.ts`) so
  the in-app local backup buttons keep working; the doc claim that
  those helpers "rode alongside the Drive code path" turned out to
  be wrong. See [`removals.md`](removals.md) for the as-landed
  inventory.

- **Phase 0 removals - Legacy memory engines.** Done 2026-05-20.
  Two commits: V3 decoupling (rename `supaMemoryKey` →
  `hypaV3Key` with migration fallback), then the bulk removal.
  See [`removals.md`](removals.md) for the as-landed inventory.

- **Phase 1 - Fastify foundation.** Done 2026-05-20. Adds
  `server/fastify/` with `config.ts`, `db.ts` (`node:sqlite` +
  `schema_version`), `auth.ts`, `http.ts`, health/auth routes,
  root `pnpm api:*` scripts, Vite `/api` dev proxy, and a vitest
  smoke harness.

- **Phase 2 - Server storage, import, assets, backups.** Done
  2026-05-20. Adds `GET /api/v1/bootstrap`, JSON
  `POST /api/v1/import/risusave`, raw asset upload/read/head/exists
  routes, backup create/list/restore/delete routes, static serving
  from `RISU_API_STATIC_ROOT`, and the Docker switch to Fastify on
  port 6002. No server-side `.risu` export/bundle or asset delete
  route exists in Phase 2.

- **Phase 4 - sendChat characterization scaffolding + first slice.**
  Done 2026-05-20. Adds the fixture loader, provider fake,
  snapshot harness, per-side-effect mocks, and three fixtures
  (`simple-send`, `preview`, `continue`). A small defensive guard
  on `src/ts/parser/parser.svelte.ts:506-507` (optional chaining
  of `selIdState` and `DBState.db.characters`) was needed so the
  module's top-level `$effect.root` does not throw at vitest
  teardown.

- **Phase 4 - second fixture slice.** Done 2026-05-20. Adds
  `regenerate` (multiline reroll), `provider-error` (upstream
  fail produces a `risuerror` chat message under
  `inlayErrorResponse: true`), and `auto-continue` (recursive
  `sendChat` call with `autoContinueMinTokens`). The `uuid` mock
  counter now resets between fixtures so snapshots are
  order-independent.

- **Phase 4 - prompt-shape slice.** Done 2026-05-20. Bumps the
  snapshot schema so `providerCalls` carries the normalized call
  records (mode + formated + opt-in flags) instead of just a
  count. Adds `author-note` (chat-level note lands at the end of
  the default `formatingOrder`) and `cache-point`
  (`automaticCachePoint` walk-back marks the last 3 user entries
  - only reachable through a `promptTemplate` with a `chat`
    card). All 8 prior fixtures were re-recorded.

- **Phase 4 - persona / lorebook / abort slice.** Done
  2026-05-20. Adds `persona` (db.personaPrompt merged into the
  leading system block by `pushPrompts`'s same-role coalescer),
  `lorebook-keyword` (one globalLore entry with `key: "cat"`
  activated by user message), and `client-abort` (pre-aborted
  AbortSignal now returns the aborted dispatch union in
  `src/ts/process/dispatch/dispatchRequest.ts:127`).
  Adds an
  `aborted: true` flag to the fixture schema; the test driver
  synthesizes a pre-aborted controller and threads its signal
  into `sendChat`.

- **Phase 4 - lorebook finisher + multimodal slice.** Done
  2026-05-20. Adds `lorebook-constant`, `lorebook-recursive`,
  and `multimodal-image`. The multimodal slice introduces a
  `vi.mock` of `src/ts/process/files/inlays` to return a canned
  PNG and stub `supportsInlayImage`. It also uses an
  `xcustom:::` model with `hasImageInput` + the `Unknown`
  tokenizer so token math runs offline.

- **Phase 3 closeout - Express deletion.** Done 2026-05-21.
  After every Express surface had been mirrored on Fastify and
  the SPA was targeting the Fastify routes, the Express server
  was removed in a single commit: deleted `server/node/`,
  removed the `runserver` script from `package.json`, and
  dropped the `express`, `express-rate-limit`, and
  `node-html-parser` dependencies. `pnpm api:test`,
  `pnpm test`, `pnpm check`, and `pnpm build` were all green
  before and after. Phase 3 is closed.

- **Phase 3D-Broad - Legacy NodeStorage surface on Fastify.**
  Done 2026-05-21. Two commits (server + client) plus a docs
  pass.
  - Server-side: new
    `server/fastify/src/routes/legacyStorage.ts` adds
    `GET /api/v1/storage/list`, `GET /api/v1/storage/read`,
    `POST /api/v1/storage/write`, and
    `POST /api/v1/storage/remove`. Files live under
    `${dataDir}/save/`, keys are hex-encoded utf-8 paths,
    write bodies flow through a scoped catch-all
    content-type parser as raw bytes. Adds
    `POST /api/v1/auth/crypto` as the sha256 hex shim that
    mirrors Express's `/api/crypto`. The Fastify
    static-serving index injection now sets both
    `globalThis.__NODE__ = true` and
    `globalThis.__FASTIFY__ = true` so every SPA self-host
    gate activates.
  - Client-side: `src/ts/storage/nodeStorage.ts` picks its
    endpoint set at module-load time based on
    `platform.isFastifyServer` (Fastify family routes vs the
    Express family). A `fetchAuthStatus` helper normalizes
    the two different auth-status response shapes
    (`{noPassword, authorized}` vs `{status}`) into the
    existing `unset` / `incorrect` / `success` enum.
    `removeItem` hex-encodes each key separately when on
    Fastify so the server can validate every `$$`-joined
    segment as hex.
  - Tests in `server/fastify/__tests__/legacyStorage.test.ts`
    cover auth gating, hex validation, write/read
    round-trip, empty read for missing key, utf-8 list
    decoding, single + many key removal, idempotent remove,
    and the crypto endpoint. The Fastify static test now
    asserts both flag injections.
  - Known limitation accepted in scope (b): the Fastify hub
    route keeps `requireAuth`, so browser-loaded resources
    on password-protected deployments will 401. The follow-up
    is in the Phase 3 entry above.

- **Phase 3D-Narrow - Client proxy / hub URL switchover.** Done
  2026-05-21. Two commits.
  - Server-side: `server/fastify/src/app.ts` lazily reads and
    caches `dist/index.html` on the first SPA request, injects
    `<script>globalThis.__FASTIFY__ = true;</script>` after the
    opening `<head ...>` tag, and serves the cached result from
    both `GET /` and the SPA fallback in
    `setNotFoundHandler`. `@fastify/static`'s auto-index is
    disabled. `static.test.ts` covers the injection.
  - Client-side: `platform.isFastifyServer` is derived from
    `globalThis.__FASTIFY__`; `platform.isWeb` now also
    excludes Fastify deployments. `globalApi.svelte.ts` URL
    builders prefer Fastify routes when `isFastifyServer` is
    true: `getProxy2Url` -> `/api/v1/proxy/fetch`; new helpers
    `getProxyStreamJobsCreateUrl` /
    `getProxyStreamJobDeleteUrl` / `getProxyStreamJobWsPath`
    replace the old `getProxyStreamJobBaseUrl` and target the
    `/api/v1/proxy/stream-jobs` surface. `characterCards.ts`
    `hubURL` becomes `/api/v1/hub`.
  - At this point in the chronology, Express (`isNodeServer`) and
    Tauri / web branches were otherwise untouched; the scope was
    the proxy + hub URLs only. `NodeStorage` and the other
    `isNodeServer`-gated paths still targeted Express endpoints
    until Phase 3D-Broad moved them to Fastify when
    `isFastifyServer` is true.

- **Phase 3C - Hub passthrough on Fastify.** Done 2026-05-20.
  Adds `ANY /api/v1/hub/*` (`server/fastify/src/routes/hub.ts`)
  forwarding to `config.hubUrl` (`RISU_HUB_URL` env, default
  `https://sv.risuai.xyz`). Mirrors the Express
  `hubProxyFunc` semantics: strip the `/api/v1/hub` prefix
  and append the suffix; honor `x-risu-node-path` as a
  complete URL override; drop host / connection /
  content-length / risu-auth / x-risu-node-path from the
  forwarded headers; set `origin` to the hub origin; strip
  `content-encoding` / `content-length` / `transfer-encoding`
  from upstream responses; follow exactly one 3xx redirect
  manually; return 502 on upstream connection failure. Adds
  the `hubUrl` field to `AppConfig` (with a `parseHubUrl`
  validator) and updates every existing test harness for the
  new required field. Tests in
  `server/fastify/__tests__/hub.test.ts` cover auth gating,
  GET path+query forward, POST body forward + origin rewrite,
  request header strip, response header strip, the
  `x-risu-node-path` URL override, single-redirect following,
  and the 502 failure path.

- **Phase 3B - Proxy stream-jobs (HTTP + WebSocket).** Done
  2026-05-20. Landed in two commits.
  - **3B-1** added the lifecycle module
    `server/fastify/src/streamJobs.ts`: a `JobRegistry` class
    (create / pushEvent / attach / detach / markDone / cleanup /
    deleteJob / tickGc), `sanitizeLocalTargetUrl`, timeout /
    heartbeat normalizers, and `runStreamJob`. The
    local-network host check is re-implemented over
    `node:net`'s `BlockList`, which (unlike the Express
    string-matching original) accepts IPv4-mapped IPv6
    addresses in both the dotted `::ffff:127.0.0.1` and the
    WHATWG-canonical `::ffff:7f00:1` forms.
  - **3B-2** added the HTTP and WebSocket routes in
    `server/fastify/src/routes/streamJobs.ts`:
    `POST /api/v1/proxy/stream-jobs`,
    `DELETE /api/v1/proxy/stream-jobs/:id`, and the WS upgrade
    at `GET /api/v1/proxy/stream-jobs/:id/ws`. The WS route is
    the single documented exception that accepts the ES256
    assertion via a `risu-auth` query-string parameter in
    addition to the header (so EventSource-style fallbacks can
    attach). `buildApp` now owns a `JobRegistry` instance,
    schedules `tickGc` on a 60 s `unref`'d interval, and tears
    the registry down via `onClose`.
  - Initially added `@fastify/websocket` as a dev dependency; the
    later Docker runtime-dependency follow-up promoted it to
    `dependencies`. Tests in
    `server/fastify/__tests__/streamJobs.test.ts` cover the
    lifecycle module (48 cases - URL allow/reject, buffering
    caps, GC, abort, `runStreamJob` round-trip) and
    `__tests__/streamJobsRoutes.test.ts` covers the routes (11
    cases - POST validation matrix, DELETE idempotency, WS
    happy path, query-param auth, 401, 404, pending-event
    flush). The WS tests use the plugin's `injectWS` with an
    `onInit` hook so the `message` listener is attached
    before any frames arrive.

- **Phase 3A - Generic provider proxy on Fastify.** Done
  2026-05-20. Adds `POST /api/v1/proxy/fetch` plus pure helpers
  in `server/fastify/src/proxy.ts` (timeout controller,
  `decodeRisuUrl`, `parseRisuHeader`,
  `normalizeForwardHeaders`, `filterResponseHeaders`). The route
  is scoped under `app.register` with a catch-all
  content-type parser so request bodies are forwarded as raw
  bytes for any content type. Auth uses the standard
  `requireAuth` (ES256 only, consistent with every other
  Fastify route). Tests in
  `server/fastify/__tests__/proxy.test.ts` cover auth gating,
  missing URL, status / body / filtered-header forward,
  request-side header stripping, `risu-header` JSON override,
  `risu-timeout-ms` -> 504, and multi-chunk SSE streaming.
  At this point in the chronology, Express `/proxy` / `/proxy2`
  remained live and client rewiring was a later slice. Phase
  3D-Narrow and the Phase 3 closeout later rewired the SPA and
  deleted Express.

- **Phase 4 - memory + trigger close-out slice.** Done
  2026-05-20. Adds `hypav3-memory`, `editrequest-trigger`, and
  `editoutput-trigger` - the final three fixtures of the
  Phase 4 plan. `hypav3-memory` mocks `memory/hypav3` via
  `importActual`+override and pins `stages: [1, 2, 1, 3, 4]`.
  `editrequest-trigger` swaps the entire `scriptings` module
  (because the real one imports wasmoon at top level and
  wasmoon's `createRequire` rejects the happy-dom URL); the
  fake `runLuaEditTrigger` appends a marker entry on
  `'editRequest'`. `editoutput-trigger` uses a plain
  `customscript` regex of type `'editoutput'` and pins that
  the rewrite is applied inside the streaming loop before
  `runInlayScreen` sees the text. Phase 4 is now complete.

## Closed (do not reopen without a contract)

These choices are locked. Reopening means writing a short rationale
in this file and updating the relevant phase doc:

- Tauri stays as-is. Do not add or modify Tauri-specific code in
  Phase 0-9.
- Hub proxy stays. Do not delete the Fastify `/api/v1/hub/*`
  passthrough. The legacy `/hub-proxy/*` route was removed with
  Express.
- No whole-state PUT in the Fastify API.
- Only Hypa V3 survives. Do not write code that re-introduces
  Supa / Hypa V2 / Hanurai.
- Fastify is ES256-only on authenticated routes. Do not add a
  password-header acceptance path to `requireAuth` or to any
  individual route. The password is only used during initial
  setup to register a client public key; subsequent requests
  authenticate via an ES256 assertion in the `risu-auth` header
  (or the matching query-string parameter for WebSocket
  upgrades). The Express proxy's `isAuthorizedRequest` /
  `checkProxyAuth` password-header path is not ported.

## Verification before closing a slice

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Tauri build is verified manually at phase boundaries, not
per-slice.
