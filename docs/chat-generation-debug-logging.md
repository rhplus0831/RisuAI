# Chat Generation Debug Logging Scope

Last explored: 2026-06-25

This note captures the current findings for adding diagnostics around the
chat creation / generation flow. It is intentionally a planning artifact:
use it to keep the call flow, insertion points, and implementation slices from
getting lost across context compaction.

## Problem Statement

Two active debugging problems motivated this exploration:

- The built prompt does not match what is expected.
- `onOutput` triggers caused by Lua errors inside modules are effectively
  swallowed from the user's/debugger's point of view.

The live Fastify variation is unreleased, so the logging design can stay
additive and pragmatic. There is no need for a DB migration or durable user
facing audit table unless a later product requirement asks for it.

## Existing Observability To Reuse

Prefer the current observability stack over a new parallel system.

- Fastify/Pino logging is already enabled from `server/fastify/src/app.ts`.
  Use `req.log` or `app.log` when writing process logs.
- Request tracing is in `server/fastify/src/requestTrace.ts`.
  When `RISU_API_TRACE_MODE=agent|human` is enabled, every API response gets
  `X-Request-UID`, and JSONL traces are written under `data/trace/`.
- `pnpm dev:agent` already runs with agent trace mode, so `data/trace/agent.jsonl`
  is the natural file to correlate browser-visible failures to API requests.
- Request trace captures headers and JSON bodies with redaction, but deliberately
  omits `text/event-stream` response bodies as `event-stream`. Generation needs
  explicit structured lifecycle logs because `/api/v1/generate/chat` is SSE.
- Structured protocol metrics live in `server/fastify/src/protocolMetrics.ts`
  and are gated by `RISU_PROTOCOL_METRICS`.
- Generation already emits `generation_prompt_assembly`,
  `generation_assembly_persistence`, `generation_persistence`, and
  `generation_persistence_retry` from `server/fastify/src/routes/generationChat.ts`.

Recommendation: use `X-Request-UID` plus `x-risu-caller` for HTTP correlation,
and use `emitProtocolMetric()` for structured generation diagnostics. Avoid a
new always-on log file or DB table.

## Current Call Flow

High-level browser to server path:

1. UI send starts in `src/lib/ChatScreens/DefaultChatScreen.svelte`.
   It builds/appends the user message, then calls the chat runtime.
2. `src/ts/process/index.svelte.ts` `sendChat()` coordinates generation.
   In Fastify mode it preflights with `resolveServerPromptAssembly()` and
   provider capability checks.
3. `src/ts/process/serverBackedSendChat.ts` `assembleServerBackedSendChat()`
   builds `ServerChatInput`, marks durable when applicable, collects inlay asset
   refs, then calls the server chat SSE adapter.
4. `src/ts/process/request/serverChat.ts` opens `/api/v1/generate/chat`.
   `requestServerChat()` handles prompt-only flows, while
   `requestServerChatGeneration()` handles real generation and durable jobs.
5. `server/fastify/src/routes/generationChat.ts` receives
   `POST /api/v1/generate/chat`, authenticates, validates, maps the request body
   with `toAssembleInput()`, preflights chat generation settings, then chooses:
   - inline `streamAssembly()` for non-durable / preview-style flows;
   - `startDurableGeneration()` -> `runGenerationJob()` for durable sends.
6. Both inline and durable paths call `assemblePromptWithMetrics()`, which calls
   `server/fastify/src/prompt/assemble.ts` `assemblePrompt()`.
7. `assemblePrompt()` performs:
   - scope resolution;
   - submit transforms: `runInputTrigger`, `appendUserMessageRow`,
     `applyEditInput`, run-var application;
   - static/plain slots;
   - lorebook preflight;
   - history and bias construction;
   - memory bridge;
   - `renderAndBudget()`.
8. The authoritative assembled prompt is `state.formated` after
   `renderAndBudget()`. It returns as `AssembleResult.formated` and
   `prompt.formated`. `prompt.messages` is only a lossy role/content projection.
9. `server/fastify/src/prompt/chatDispatch.ts` `dispatchChatProvider()` receives
   the assembled rows, resolves provider/model/profile, runs provider-specific
   reformatting, then calls the provider adapter.
10. Provider adapters under `server/fastify/src/generation/` build the actual
    upstream request body. Example: OpenAI builds and fetches in
    `server/fastify/src/generation/openai.ts`.
11. `server/fastify/src/prompt/providerTransport.ts` maps provider frames back
    to chat SSE frames and invokes post-generation derivation before terminal
    `done`.

## Prompt Logging Insertion Points

For prompt mismatch debugging, log at boundaries where data shape can change.
Prefer hashes and summaries by default; full prompt text should be explicit
opt-in sidecar content with redaction/size limits.

1. Browser preflight and request correlation
   - Files:
     - `src/ts/process/index.svelte.ts`
     - `src/ts/process/request/serverChat.ts`
   - Log:
     - server assembly verdict;
     - durable verdict;
     - mode;
     - chat id;
     - character id;
     - last message id/hash;
     - `X-Request-UID` response header;
     - durable job id when `job_accepted` arrives.
   - Also add `x-risu-caller` labels for `chat-generate`, `chat-reattach`,
     `chat-cancel`, and `preview-prompt`.

2. Server route entry
   - File: `server/fastify/src/routes/generationChat.ts`
   - Around: `POST /api/v1/generate/chat`
   - Log:
     - `requestUid`;
     - Fastify request id;
     - chat id;
     - character id;
     - mode;
     - durable flag;
     - expected revision;
     - inlay asset ref count.

3. Assembly stage timing and final assembled prompt summary
   - File: `server/fastify/src/prompt/assemble.ts`
   - Around: `assemblePrompt()` after `renderAndBudget()`, before return.
   - Log:
     - `promptHash` over authoritative `formated` rows;
     - row count;
     - role sequence;
     - per-row content length/hash summary;
     - input tokens;
     - output budget;
     - model preset id;
     - prompt preset id;
     - loadout id;
     - active module ids/count;
     - lorebook activation ids/count;
     - mutation counts.

4. Route emission before provider dispatch
   - File: `server/fastify/src/routes/generationChat.ts`
   - Around:
     - `streamAssembly()` after `assemblePromptWithMetrics()`;
     - `runGenerationJob()` after `assemblePromptWithMetrics()`.
   - Log:
     - same prompt summary id/hash;
     - generated `generationId`/durable job id;
     - SSE prompt emitted/not emitted;
     - persisted assembly revision if any.

5. Dispatch normalization
   - File: `server/fastify/src/prompt/chatDispatch.ts`
   - Around: `dispatchChatProvider()` after provider/model resolution and after
     `reformatMessages()`.
   - Log:
     - provider route;
     - selected model and wire model;
     - profile id if present;
     - pre-reformat prompt hash;
     - post-reformat prompt hash;
     - row count/role sequence before and after.

6. Provider adapter request body
   - Files: `server/fastify/src/generation/*.ts`
   - Around: immediately before upstream `fetch()` / request creation.
   - Log:
     - provider;
     - sanitized endpoint host/path;
     - request body hash;
     - shape-specific counts, such as messages count, system length,
       tool count, image/audio part count;
     - streaming flag.
   - Do not log provider API keys. Do not log full body unless an explicit
     full-trace flag is enabled.

## Lua `onOutput` Failure Flow

The primary server-side swallow point is not the Lua VM. The VM captures Lua
load/dispatch errors, and normal callers convert those into thrown errors:

- `server/fastify/src/prompt/luaRuntime.ts` `runServerLua()`
- `server/fastify/src/prompt/luaRuntime.ts` `throwServerLuaFailure()`

The visible swallow happens after provider output:

1. `emitProviderChunks()` invokes route post-generation handling.
2. Inline calls `buildPostGenerationFrame()`.
3. Durable calls `buildDurablePostGeneration()`.
4. Both call `resolvePostGenerationResult()`.
5. `resolvePostGenerationResult()` calls `runServerPostGeneration()`.
6. `runServerPostGeneration()` runs:
   - `applyEditOutput()`;
   - append/continue/regenerate assistant row logic;
   - run-var pass;
   - `runOutputTrigger()`.
7. `runOutputTrigger()` calls `runTrigger(..., 'output', ...)`.
8. Module triggers enter through `getActiveModules()` and `getModuleTriggers()`.
9. `runTrigger()` calls `ctx.runLua()` for `triggerlua` effects.
10. Lua output mode dispatches `onOutput` in `runServerLua()`.
11. Lua failure throws back up to `resolvePostGenerationResult()`.
12. The catch in `resolvePostGenerationResult()` falls back to raw provider text,
    returns `postGenError`, and clears chat-var mutations.
13. Inline/durable generation emits only a `warning` frame and persists raw text.
14. The browser only collects warnings and `console.warn`s them in
    `src/ts/process/request/serverChat.ts`.

That fallback preserves generated text, which is useful, but it makes module Lua
failures easy to miss.

## Lua Logging Insertion Points

1. Minimal high-value log
   - File: `server/fastify/src/routes/generationChat.ts`
   - Function: `resolvePostGenerationResult()`
   - Catch block around the raw fallback.
   - Log:
     - `err`;
     - generation id;
     - chat id;
     - character id;
     - mode;
     - durable/inline context if available;
     - completion text length/hash;
     - fallback type: `raw_provider_text`;
     - derived source classification:
       - `lua_output_trigger`;
       - `lua_edit_output`;
       - `regex_edit_output`;
       - `unknown_post_generation`.

2. Lua runtime result summary
   - File: `server/fastify/src/prompt/luaRuntime.ts`
   - Function: `runServerLua()`
   - When `RISU_PROTOCOL_METRICS=1`, every Lua run emits
     `generation_lua_runtime`; metrics remain off otherwise.
   - Log:
     - mode;
     - timed out;
     - interactive invoked;
     - whether the requested handler was registered (`onOutput`, `onInput`,
       `callListenMain`, etc.);
     - result shape (`undefined`, `array`, `string`, etc.);
     - aborted;
     - code hash;
     - code byte length;
     - elapsed milliseconds;
     - aggregate budget used/remaining.
   - Do not log the Lua source or runtime error text here; failures can contain
     prompt/completion content if the script throws user data.

3. Trigger/module attribution
   - Files:
     - `server/fastify/src/prompt/modules.ts`
     - `server/fastify/src/prompt/triggers.ts`
     - `server/fastify/src/prompt/assemble.ts`
   - Extend trigger run args with source metadata:
     - owner type: character/module;
     - owner id;
     - owner name;
     - trigger index/id/comment if available;
     - effect index;
     - lowLevelAccess.
   - This is needed to answer "which module caused the `onOutput` failure?".

4. Trigger selection and edit-effect diagnostics
   - Files:
     - `server/fastify/src/prompt/triggers.ts`
     - `server/fastify/src/prompt/luaRuntime.ts`
   - Metrics:
     - `generation_trigger_selection`: trigger counts, selected counts,
       character/module split, and trigger-Lua effect counts for each run mode.
     - `generation_trigger_skipped`: selected triggers skipped by condition
       failure, with owner/trigger attribution.
     - `generation_trigger_lua_effect`: each `triggerlua` effect that reaches
       `runTrigger()`, including message-count delta, transcript/last-message
       before/after hashes, stop flag, var-change flag, owner/trigger/effect
       attribution, and code hash/size.
     - `generation_lua_edit_trigger_effect`: each `listenEdit` trigger-Lua edit
       hook, including before/after content hashes, content byte counts, row
       counts for request rows, and owner/trigger/effect attribution.
   - These are the primary signals for "GigaTrans module Lua ran, but the
     character's own Lua did not": compare the character/module owner rows for
     `output` and `editOutput`.

5. Legacy browser-side edit-output catch
   - File: `src/ts/process/scriptings.ts`
   - Function: `runLuaEditTrigger()`
   - The legacy browser path can return original content after a Lua edit-output
     failure. Add richer `console.warn`/protocol diagnostic data inside the loop,
     not only the outer catch, if browser-local parity paths are still relevant.

## Implementation Slices

### Slice 1: Correlation And Raw-Fallback Visibility

Scope: 0.5 to 1 day.

- Add `x-risu-caller` labels in the browser chat adapter.
- Capture/log `X-Request-UID` in browser generation diagnostics.
- Enrich existing `generation_prompt_assembly` metric with request/job fields
  where available.
- Add a `generation_post_generation_fallback` protocol metric at the
  `resolvePostGenerationResult()` catch.
- Keep all fields metadata-only.

Risk: low. This is additive and should not change behavior.

### Slice 2: Prompt Summary Hashes

Scope: 1 to 2 days.

- Add a shared prompt summary/hash helper on the server.
- Log authoritative assembled prompt summaries after `renderAndBudget()`.
- Log route-level prompt summaries when the prompt SSE event is emitted.
- Log dispatch pre/post reformat summaries.
- Add tests proving the same assembled prompt hash is carried through assembly
  and route emission, and changes when provider reformatting changes the rows.

Risk: low to medium. The main risk is accidental content leakage; keep summaries
hash/length/count based.

### Slice 3: Provider Body Summaries

Scope: 1 day after Slice 2.

- Add provider adapter request summaries before upstream calls.
- Include body hash and shape counts, not raw text.
- Add focused tests for at least OpenAI-compatible/OpenAI and one non-OpenAI
  shape such as Anthropic or Gemini.

Risk: medium. Need careful redaction and provider-specific shaping discipline.

### Slice 4: Opt-In Full Prompt/Body Sidecars

Scope: 1 to 2 days.

- Add a separate explicit env flag, for example
  `RISU_GENERATION_TRACE_FULL_PROMPT=1`.
- Write full prompt/provider body sidecars under `data/trace/` with gzip,
  max-size caps, and redaction.
- Reference sidecar paths from protocol metrics.
- Make this off by default, even when `RISU_PROTOCOL_METRICS=1`.

Risk: medium. Prompts can contain private chat text, secrets accidentally placed
in prompts, and large assets. Needs clear guardrails.

### Slice 5: Lua Trigger Source Attribution

Scope: 1 to 2 days.

- Thread trigger source metadata from active module resolution into trigger runs.
- Include source metadata in Lua failure metrics and raw-fallback metrics.
- Add route/unit tests with a module `onOutput` Lua error proving the metric names
  the module/trigger.

Risk: medium. Touches trigger/module plumbing, but behavior can stay unchanged.

### Slice 6: Lua Positive-Path Diagnostics

Status: implemented.

- `generation_lua_runtime` now emits for successful Lua runs when
  `RISU_PROTOCOL_METRICS=1`, with `handlerRegistered` and `resultShape`.
- `generation_trigger_selection`, `generation_trigger_skipped`, and
  `generation_trigger_lua_effect` show whether character/module triggers were
  collected, selected, skipped, and executed.
- `generation_lua_edit_trigger_effect` shows whether trigger-Lua edit hooks
  changed post-generation content.

Risk: low. Metrics are opt-in and metadata-only.

## Verification Plan

Use focused tests before broad checks.

- Server route/unit tests for `/api/v1/generate/chat` prompt assembly metrics.
- A test fixture with a module `onOutput` Lua failure that asserts:
  - raw text fallback still persists;
  - warning still emits;
  - protocol metric records the failure and fallback;
  - module/trigger attribution appears after Slice 5.
- Provider adapter tests for request summary redaction/hashing.
- Type checks:
  - `pnpm exec tsc -p tsconfig.client-lib.json`
  - `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`
- Before commit, run Prettier per repo guidance.

## Design Guardrails

- Do not hold `FastifyRequest` objects inside durable jobs. Copy primitive
  correlation ids only.
- Keep metrics opt-in through `RISU_PROTOCOL_METRICS`.
- Keep full prompt/body capture behind a separate explicit flag.
- Redact secrets and avoid logging provider keys, cookies, auth headers, or
  full request bodies by default.
- Prefer one shared prompt/body summary helper over ad hoc hashes in each route.
- Preserve current generation behavior unless explicitly changing policy:
  logging the Lua fallback is lower risk than converting it to a hard failure.
