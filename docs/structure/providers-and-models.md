# Providers And Models

Last audited: 2026-07-17.

Provider/model behavior is split between browser model metadata, Fastify
provider dispatch, and the shared capability table that decides whether a
request shape can run on the server.

## Browser Model Registry

| Path                                                                                            | Role                                                                                               |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/ts/model/types.ts`                                                                         | `LLMProvider`, `LLMFormat`, `LLMTokenizer`, `LLMFlags`, `LLMModel`.                                |
| `src/ts/model/modellist.ts`                                                                     | Static/dynamic/custom model registry and `getModelInfo()`.                                         |
| `src/ts/model/modelRoles.ts`                                                                    | Model role helpers for `chatMain`, `chatAux`, `memory`, `emotion`, `translate`, `otherAx`, `scriptMain`, and `scriptAux`; fallback refs are separate. |
| `src/ts/model/modelProfileRecords.ts`, `modelProfileResolver.ts`, `modelProfileUiState.ts`      | Durable model profile records, role bindings, compatibility resolution, and settings UI summaries. |
| `src/ts/model/modelPresetSnapshots.ts`, `src/ts/promptPresetModelOverrides.svelte.ts`           | Snapshot/override helpers for model preset saves and prompt-preset model overrides.                 |
| `src/ts/model/modelGrid.ts`                                                                     | Model-grid normalization and filtering helpers for picker UI.                                      |
| `src/ts/model/keyedRequestCache.ts`                                                             | In-flight dedupe and bounded successful-result caching keyed by complete provider request context.  |
| `src/ts/model/providers/`                                                                       | Provider-specific static model lists.                                                              |
| `src/ts/model/openrouter.ts`, `nanogpt.ts`, `ollama.ts`, `ooba.ts`, `src/ts/horde/getModels.ts` | Browser provider catalog helpers, including keyed OpenRouter/NanoGPT/Ollama Cloud request reuse.     |
| `src/lib/UI/ModelList.svelte`, `ModelGrid.svelte`, `NanoGPT*`, `OpenrouterProviderList.svelte`  | Model-picker UI.                                                                                   |

`Database.modelProfiles` stores durable reusable profile records, and
`Database.modelRoleProfiles` stores durable role bindings. A profile can own a
selected model id, provider/request options, provider endpoints, a
profile-local API key, runtime options that directly affect a request, and
fallback profile refs. Role bindings can use profile mode, legacy mode, or
inherit mode where a role supports inheritance. The resolver prefers durable
profile records and bindings, then falls back to legacy flat fields for copied
data, older presets, static model bypasses, and settings surfaces that still
write compatibility fields.

Legacy `Database.aiModel` and related flat fields still select model strings for
main, auxiliary, translator, memory, emotion, and script flows when no durable
profile binding owns that role. Static/legacy fallback model ids still use flat
settings and pass through the `staticModel` path. Dynamic registry additions are
browser-side; `modellist.ts` merges custom model records, Plugin V3 provider
metadata, dynamic Google/Anthropic model registration, and prefixed ids such as
`xcustom:::`, `horde:::`, `hf:::`, and `pluginmodel:::`. Persisted
`xcustom:::` custom models are server-routable when their stored URL/key/format
pass the capability table. The server reconstructs narrow dispatch metadata from
persisted settings, profile-owned options, string prefixes, and the OpenAI model
allowlist; it does not import the full browser UI registry.

## Server-Owned Provider And Media Operations

Dynamic NanoGPT account/model fetching lives in `src/ts/model/nanogpt.ts`.
OpenRouter, NanoGPT, Ollama, and Horde helpers carry richer browser catalog
metadata for picker/filter UI than the server needs for dispatch. NanoGPT,
OpenRouter, Ollama Cloud, WaveSpeed, Google, Anthropic, ElevenLabs, and Fish
Speech catalog/account calls use the fixed allowlist in
`server/fastify/src/providerOperations.ts` through
`src/ts/server/providerOperations.ts`. The same boundary owns Google token
counting and DeepL/DeepLX translation; use
`src/ts/server/providerOperationsProtocol.ts` as the operation source of truth.

Credentialed provider and media features use authenticated, no-store Fastify
operations rather than exposing raw stored keys to browser provider code. The
routes do not mutate local durable state and therefore do not require the active
writer. Each accepts a fixed operation/provider discriminator and bounded typed
input; contracts that permit custom endpoints validate them explicitly instead
of accepting a generic URL/method/header proxy. Upstream response sizes,
deadlines, error details, and disconnect cancellation are bounded.

| Route / browser adapter | Fixed boundary | Result / rate limit |
| --- | --- | --- |
| `POST /api/v1/provider-operations` / `src/ts/server/providerOperations.ts` | NanoGPT account/catalog operations; OpenRouter, Ollama Cloud, WaveSpeed, Google, Anthropic, ElevenLabs, and Fish catalogs; Google token counting; DeepL/DeepLX translation. | JSON, `60/min` |
| `POST /api/v1/embedding-operations` / `src/ts/server/embeddingOperations.ts` | Remote `ada`, OpenAI v3, Voyage contextual, or custom embeddings. Stored secrets cannot be paired with a changed one-shot custom endpoint. | JSON vectors, `60/min` |
| `POST /api/v1/tts/synthesize` / `src/ts/server/tts.ts` | ElevenLabs, Fish, Hugging Face, NovelAI, or OpenAI-compatible synthesis. Stored-character OpenAI credentials, endpoint, and options resolve together by character id. | Audio bytes, `60/min` |
| `POST /api/v1/image-generation` / `src/ts/server/imageGeneration.ts` | NovelAI, DALL-E, Stability, Fal, Imagen, OpenAI-compatible, WaveSpeed, or Kei generation with provider-specific request validation. | JPEG/PNG/WebP bytes, `10/min` |
| `POST /api/v1/media/openai/transcriptions` / `src/ts/server/openAITranscription.ts` | One bounded audio/video upload to OpenAI `whisper-1`, using the server-stored OpenAI key and a fixed VTT response format. | VTT text, `10/min` |
| `POST /api/v1/mcp/oauth/refresh` / `src/ts/server/mcpOAuthRefresh.ts` | A stable MCP URL selects its matching stored refresh credential; the browser cannot submit the raw refresh token or client secret. | JSON access token, `30/min` |

The server implementations are `providerOperations.ts`,
`embeddingOperations.ts`, `tts.ts`, `imageGeneration.ts`,
`openAITranscription.ts`, and `mcpOAuthRefresh.ts` under
`server/fastify/src/`; their route registrars live under
`server/fastify/src/routes/`. Request discriminators and browser/server shared
types live in the corresponding `src/ts/server/*Protocol.ts` files, except that
OpenAI transcription validates its fixed contract directly in its adapter and
route. Raw stored/profile credentials resolve only inside Fastify; resource
reads project a masked sentinel so the browser can refer to a stored secret
without receiving it. A user-edited draft key is a one-shot override only for
operations whose protocol permits `credential.source: "provided"`.

OpenRouter model/provider and NanoGPT model/provider catalog requests are keyed
by their full credential/model context and share an in-flight promise. Public
and explicit-draft contexts briefly reuse successful results; failed requests
are not retained. Opaque stored/profile credential references bypass completed
result reuse so a server-side key rotation cannot be hidden behind an unchanged
masked placeholder. OpenRouter and NanoGPT catalogs use a 30-second TTL where
reuse is safe. Ollama Cloud tags use a 15-second cache keyed by credential under
the same rule, while local Ollama discovery remains uncached.
NanoGPT balance/subscription lookups dedupe only concurrent calls. The legacy
model settings surface also debounces draft catalog credentials for 400 ms, so
typing a key does not issue one catalog request per character.

## Settings -> Model Profile Flow

Settings -> Model is now profile-first. `BotSettings.svelte` routes model
settings to `ModelSettingsShell.svelte`, which owns the visible workflow:

| Surface | Role |
| --- | --- |
| `ModelProfileRoleList.svelte` | Roles tab. Edits `modelRoleProfiles` with explicit Apply/Cancel, binding modes (`profile`, supported `inherit`, `legacy`), effective profile summaries, provider/model/request-model summaries, status, and fallback counts. |
| `ModelProfileList.svelte` | Profiles tab. Lists profile name/id, provider, model, request model, fallback count, status, role usage, and create/edit/duplicate/delete actions. |
| `ModelProfileEditorDrawer.svelte` | Command-backed profile drawer for first-class provider fields, profile runtime overrides, fallbacks, and profile-local secret placeholder preserve/replace/clear behavior. |
| `ModelRuntimeDefaultsEditor.svelte` | Edits `modelRuntimeDefaults` with explicit Save/Cancel and a compact count summary. |
| `ModelPresetList.svelte` | Embedded model preset picker/list hosted by `src/lib/Setting/botpreset.svelte`; applies/saves `modelPresets` and `modelPresetsId`. |
| `ModelRoleList.svelte` | Legacy role editor shown only inside Advanced Legacy Settings for compatibility data. |

The shell prompts clearly legacy-only databases to Convert to Profiles through
the atomic conversion command. Declining hides the prompt for the session while
leaving the Convert to Profiles action visible. Advanced Legacy Settings still
shows the current legacy main/aux fields and the old role/provider controls so
older data, copied settings, and compatibility provider globals remain
reachable when at least one role still resolves through legacy settings. The
legacy accordion is hidden once every role resolves from a durable profile,
including supported inherit bindings whose effective source is durable-profile;
legacy-inherit keeps it visible.

First-class profile provider panels are intentionally limited to:

- `openai`
- `anthropic`
- `google`
- `vertex`
- `ollama`
- `custom-api`
- `debug-echo`

The first-class panels write top-level `providerId`, selected `modelId`,
`providerOptions` such as `apiKey`, `requestModel`, endpoint/base URL, extra
headers, additional params, and nested shapes for reverse proxy, OpenRouter,
NanoGPT, Ollama, Vertex, and Custom API metadata. `ModelProviderPanel.svelte`,
`ModelRuntimeOptionsEditor.svelte`, `ModelFallbackEditor.svelte`, and
`modelProfileSecrets.ts` own most of the editor/provider-option plumbing.
Ollama profiles select local or cloud routing, store the native base URL or
cloud API key, and keep the Ollama request model separate from the source row.
Custom API profiles represent OpenAI-compatible Chat Completions; the UI stores
a base URL and warns when the user includes `/chat/completions` because dispatch
appends that suffix.
Debug Echo profiles use the existing Echo dispatcher and return a small JSON
payload containing the profile-local Base URL and Request Model for provider
debugging.

## Durable Profile Data Flow

Defaults and normalization run in `src/ts/storage/database.svelte.ts` and
`server/fastify/src/databaseDefaults.ts`. Settings command validators in
`src/ts/server/commands.ts` and `server/fastify/src/routes/commands.ts` accept
only supported profile, provider option, runtime option, role-binding, and
fallback-ref shapes. Preset and loadout paths in `src/ts/presetSplit.ts`,
`src/ts/model/modelPresetSnapshots.ts`, `src/ts/promptPresetModelOverrides.svelte.ts`,
`server/fastify/src/commands/splitPresets.ts`, and `src/ts/loadout.ts` preserve
durable profile fields while still accepting legacy flat data.

Loadouts follow the same split-preset boundary for prompt templates: they apply
prompt preset ids and let the selected modern prompt preset own
`promptPresets[].promptTemplate`. They should not resurrect stale top-level
`promptTemplate` data as the active template when a prompt preset id resolves.

Provider secret masking in `server/fastify/src/providerSecrets.ts` includes
profile-local `apiKey` values and resolves masked placeholders by stable profile
id. This is separate from older flat provider/custom-model masking, which
remains for compatibility.

`Database.modelRuntimeDefaults` uses the same runtime option schema as profile
`runtimeOptions`. Profile-bound runtime precedence is hard defaults,
`modelRuntimeDefaults`, then profile `runtimeOptions`. Legacy flat parameters
and separate parameters are preserved for compatibility/conversion, but
profile-bound generation does not silently borrow them as active profile
runtime overrides.

Durable profile commands live in the browser command wrappers and Fastify
command handlers. The profile-first UI uses row-oriented commands for profile
create/update/duplicate/delete, role binding updates, create-and-bind,
legacy-to-profile conversion, and runtime defaults updates. Whole-array settings
patches remain compatibility paths for imports, presets, loadouts, and older
callers.

## Agent Preset Model Flow

Agent Preset steps are auxiliary generation calls around the main chat request.
Each step stores a model selection in `AgentPresetStepRecord.model`: either
`inheritMain`, which reuses the already-resolved chat main profile, or
`modelProfile`, which names a durable profile id. Planner/status helpers in
`src/ts/agentPresetResolver.ts` use the same model-profile readiness semantics
as chat preflight, and server execution in
`server/fastify/src/prompt/agentPresetExecution.ts` dispatches through the
normal provider boundary with streaming disabled and provider tools omitted.
`src/ts/agentPresetReferences.ts` owns recognition and expansion of named
output references.

Agent Preset steps use bounded prepared-input scopes and named-output CBS
chaining. Steps can select server-provided sections such as recent chat tail,
chat search snippets, lorebook context, memory context, persona/character
summaries, previous agent outputs, current user message, and after-main main
draft. A selected section is collected and inserted only when the instruction
contains its matching placeholder, such as `{{currentUserMessage}}`.

A step can also consume an already-completed named output directly through
`{{agent::outputKey}}`, independently of the aggregate
`previousAgentOutputs` scope. Before-main consumers can use outputs from earlier
before-main dependency levels. After-main consumers can use all completed
before-main outputs plus earlier after-main levels. A missing or disabled
producer, self-reference, same-level reference, or forward/future-phase
reference classifies the preset as `incomplete` and blocks generation until the
output key or dependencies are corrected. Successful step outputs remain
available to eligible later steps regardless of destination; before-main
`promptOutput` values additionally expand in the main prompt template.

Runtime execution runs dependency levels up to preset `maxConcurrency`, applies
per-step timeout/input/output limits, validates JSON-object outputs when
requested, follows optional/required/fallback/stop failure policies, and writes
step outputs to `promptOutput`, `intermediate`, `userInput`, or `finalOutput`
destinations. At most one enabled before-main `userInput` modifier is allowed;
it must be the last enabled before-main step and replaces and persists the latest
user message before main prompt assembly. At most one enabled after-main
`finalOutput` modifier is allowed, it must be the last enabled after-main step,
and it can modify final text before persistence.
Provider tool-calling is intentionally not part of this path yet.

## Compatibility Caveats

Canonical compatibility surfaces:

- Legacy flat fields remain: `aiModel`, `subModel`, `modelRoles`,
  `seperateModels`, `fallbackModels`, separate parameters, and provider globals.
  They are compatibility/conversion data, not the preferred Settings -> Model
  workflow.
- Compatibility profiles omit `providerId`. They can still generate when the
  resolver and capability table can route the inferred provider/model, but they
  are not first-class provider panels in the editor.
- Unsupported `providerId` values are placeholders. The editor shows them as
  unsupported, preserves compatible data, and active durable generation blocks
  them until the user selects a supported profile/provider.
- Memory summaries use memory-role profiles and profile-owned provider options,
  but server-side summarization currently accepts only the memory/subModel API
  path and OpenAI-compatible summary providers (`openai`, `openrouter`, or
  `nanogpt`). Memory embeddings stay outside chat profiles on the separate
  Hypa/Voyage/custom embedding config.
- The Custom Models catalog (`customModels` / `xcustom:::`) remains separate
  from first-class Custom API profiles.
- Imported old `agentContext*` fields are inert compatibility data. They are no
  longer model-selection inputs, command-patchable settings, or prompt runtime
  triggers.

## Server Provider Dispatch

Fastify dispatch is centered in `server/fastify/src/prompt/chatDispatch.ts`.
Provider adapters live in `server/fastify/src/generation/`:

- OpenAI, OpenAI Responses, OpenAI-compatible, and legacy instruct.
- OpenRouter and NanoGPT as OpenAI-compatible variants where applicable.
- Anthropic, Gemini, Vertex auth, Bedrock/SigV4, Cohere, Mistral, Ollama,
  Kobold, Horde, Ooba legacy, and Echo.
- Shared additional-parameter, frame, and SSE helpers.

Provider adapters build provider-safe wire rows instead of serializing internal
prompt objects. `generation/providerMessages.ts` strips prompt-only metadata,
translates OpenAI/Anthropic image parts, preserves supported reasoning
continuation, and applies Anthropic cache points; Gemini and Responses perform
their native media conversion in their adapters. Provider reasoning output is
normalized into the shared `<Thoughts>` envelope. `generation/jsonControls.ts`
parses the retained JSON schema/interface syntax and applies configured dot-path
extraction to buffered results.

The server resolves provider settings, endpoints, model ids, and secrets from
durable profile context when present, then from flat compatibility settings when
needed. Browser projections mask secrets through
`server/fastify/src/providerSecrets.ts`; settings writes resolve masked
sentinels back to current stored secrets.
Provider adapters may be incremental or buffered. `/api/v1/generate/chat` maps
both shapes to chat SSE frames and wraps buffered outputs as token/done frames,
while direct `/api/v1/generate/completion` rejects streaming for buffered
providers.

Dispatch materializes only sampler/runtime controls declared by the selected
model's capability row, including separate-by-model overrides. The supported
provider arms carry their relevant top-p/top-k/min-p/top-a and penalty fields,
reasoning/thinking/verbosity controls, seed, JSON schema/extraction, prediction,
cache/privacy headers, additional parameters, and provider-specific options.
OpenAI Chat-family routes tokenize prompt bias rows into `logit_bias`; main
send/regenerate can request up to 20 OpenAI/OpenRouter/NanoGPT choices and expose
the extras as reroll alternates.

Routing notes that matter when debugging provider drift:

| Area                     | Notes                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI-compatible ids    | Vanilla OpenAI ids use an allowlist; unknown OpenAI-compatible ids need custom/provider config.                                           |
| Reverse proxy / `risu::` | Server dispatch derives endpoint/key behavior from persisted proxy/custom-model settings.                                                 |
| OpenRouter               | Routes through OpenAI-compatible dispatch when persisted OpenRouter settings make the model server-routable.                              |
| NanoGPT                  | Message, legacy, and responses formats route to Anthropic-compatible, legacy instruct, or Responses-style adapters as selected by format. |
| Ollama local             | Native Ollama routes when an Ollama URL is configured.                                                                                    |
| Ollama Cloud             | `ollama-cloud` remaps by `ollamaRequestFormat` to native Ollama, OpenAI-compatible, Responses, or Anthropic-compatible dispatch.          |
| Ollama Cloud tools       | The browser owns the native Ollama MCP loop; `ollamaCloudToolProxy.ts` forwards only its credential-safe upstream chat request.           |
| Bedrock                  | Uses Bedrock/SigV4 model metadata and wire-model prefix handling.                                                                         |
| Horde                    | Requires an instruct chat template in the shared capability table; dispatch is buffered, not incremental.                                 |
| Logit bias               | OpenAI Chat-family dispatch tokenizes assembled prompt bias rows, including direct token ids and strong-ban variants.                      |
| Completion streaming     | Direct `/generate/completion` rejects streaming for buffered providers such as Cohere, legacy instruct, Responses, Kobold, Ooba legacy, Bedrock, and Horde; `/generate/chat` wraps buffered provider output as token/done frames. |

## Capability Table

`src/ts/process/request/providerCapability.ts` is the shared pure provider
routing decision table. Given resolved model metadata and the narrow config it
needs, it returns either a server provider name (`routable: true`) or a stable
unsupported reason category.

Do not fork this table for chat/completion routing. Browser chat preflight and
Fastify dispatch share it; the chat preflight reaches the table through resolved
model-profile selection and the profile's `providerCapability`. Active durable
profiles with incomplete or unsupported status are blocked before browser
request dispatch, server-intent completion, `/generate/chat` SSE/job
acceptance, and final server chat dispatch.
Server-intent completion sends shaped messages to Fastify; browser
`requestChatDataMain()` resolves profiles only far enough to set mode/static
model/fallback-profile intent, and `requestServerCompletion()` sends that
intent without provider/model/options/secrets. Fastify rejects those fields in
the envelope and re-resolves provider/model/secrets server-side before shared
provider dispatch.

Chat generation has a two-stage effective-config path. Browser preflight uses
`effectiveModelDatabaseForChat()` with model-runtime preset scope for routing
and image gates. Server generation then uses
`buildEffectiveGenerationConfig()` with full chat generation settings,
persona selection, Agent Preset readiness, jailbreak state, prompt-preset
module integration, sidebar-toggle materialization, prompt-preset ownership, and
profile-bound runtime fields before prompt assembly. Effective preset precedence
is selected model preset first, prompt preset fields for full generation,
prompt-preset model overrides after that, then server generation reapplies
prompt-preset model overrides after profile-bound runtime fields.
`chatDispatch.ts` forwards only the supported runtime subset to provider
adapters.

`modelTools` are copied into the effective DB. Fastify OpenAI Responses dispatch
adds `web_search_preview` when the resolved profile runtime enables `search`.
The lower-level server-intent completion protocol also accepts bounded
`tools` definitions and completed `toolRounds`. Tool-bearing requests must be
buffered; Fastify validates definitions, call names, arguments, prior results,
round counts, and total payload sizes, then translates the definitions/history
for OpenAI, OpenRouter, NanoGPT, Anthropic, or Gemini. A provider-requested call
comes back as validated `toolCalls`.

This transport support does not make Fastify an MCP executor. The browser maps
the returned call to an available MCP/function tool, executes it, and sends the
result in a later `toolRounds` request. `/generate/chat` and Agent Preset
execution do not run arbitrary browser MCP tools; the legacy browser OpenAI
loops retain their own orchestration. Ollama with tools likewise stays on its
native browser loop so the browser can execute MCP calls. Ollama Cloud can use
the authenticated `ollamaCloudToolProxy.ts` transport to keep its stored key on
the server, but the tool loop and execution remain browser-owned.
Memory summaries use memory-role profile resolution and profile-owned provider
options. Memory embeddings intentionally remain outside
chat profiles on the separate Hypa/Voyage/custom embedding contract in
`memoryEmbeddingModel.ts`; deadlines are bounded through
`memoryProviderDeadline.ts`.

## Generation Client Map

| Path                                             | Role                                                           |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `src/ts/process/index.svelte.ts`                 | `sendChat()` coordinator and visible generation state.         |
| `src/ts/process/request/serverPromptAssembly.ts` | Browser preflight for server prompt assembly support and mode. |
| `src/ts/process/request/serverCompletion.ts`     | Server-intent completion route adapter.                        |
| `src/ts/process/request/serverToolProtocol.ts`   | Shared bounded tool definition, returned-call, result, and round validation. |
| `src/ts/process/serverBackedSendChat.ts`         | Chat send/preview bridge from UI inputs to Fastify routes.     |
| `src/ts/process/request/serverChat.ts`           | Chat SSE parser and request adapter.                           |
| `src/ts/process/request/serverChatEvents.ts`     | Client-side chat SSE frame/message-patch contract types.       |
| `src/ts/process/request/durableGeneration.ts`    | Durable send/continue/regenerate request helpers.              |
| `src/ts/process/reattach.ts`                     | Bootstrap-driven reattach for active durable generation jobs.  |
| `server/fastify/src/routes/generation.ts`        | Completion route boundary.                                     |
| `server/fastify/src/routes/generationChat.ts`    | Server-assembled chat generation, preview prompt, durable job lifecycle, and chat-settings/profile guards. |
| `server/fastify/src/prompt/chatDispatch.ts`      | Shared server provider dispatch after profile/setting resolution. |
| `server/fastify/src/generation/serverTools.ts`   | OpenAI/Anthropic/Gemini tool wire translation and returned-call validation. |
| `server/fastify/src/ollamaCloudToolProxy.ts`     | Credential-safe Ollama Cloud upstream transport for the browser-owned tool loop. |
| `server/fastify/src/prompt/effectiveGenerationConfig.ts` | Chat-scoped model/prompt preset and runtime overlay application. |
| `server/fastify/src/prompt/sseEvents.ts`         | Server-side chat SSE frame contract helpers.                   |

The live chat flow is `sendChat()` -> `resolveServerPromptAssembly()` ->
`serverBackedSendChat.ts` -> `serverChat.ts` ->
`routes/generationChat.ts` -> `prompt/chatDispatch.ts` -> `generation/*`.
There is no generated API client; browser fetch adapters are handwritten.
`src/ts/process/request/serverChatEvents.ts` manually mirrors
`server/fastify/src/prompt/sseEvents.ts`, so frame additions should stay
additive and be updated on both sides.

## Generation Surfaces

`/api/v1/generate/chat` is server-assembled. The browser sends raw chat inputs;
the server assembles the prompt, dispatches the provider, streams chat SSE
frames, runs post-generation derivation, and persists the result. Durable
send/continue/regenerate is the normal app path: jobs are process-local in
`generationJobs.ts`, emit `job_accepted`, buffer replayable frames, appear in
bootstrap `activeGenerationJobs`, reattach with
`GET /api/v1/generate/chat/:id/stream`, and cancel with
`DELETE /api/v1/generate/chat/:id`. Inline non-durable SSE remains for
tools/tests and preview-style callers. Browser `serverChat.ts` sends
`clientCapabilities.compactPromptEvent`, `promptMetadataOnly`, and
`omitDuplicateDoneResult`; the server may strip heavy prompt fields, delta-trim
`replace_all` message patches with `firstChangedIndex`, and omit an inline
`done.result` when preceding token frames already delivered the same non-empty
text. `done.result` is therefore optional for negotiated inline streams, while
durable jobs retain it so replay and reattach remain self-contained. Agent
Preset execution emits `agent_preset_progress` frames on the same stream.

`generationChat.ts` wraps the provider dispatcher with retained request
policies. Each attempt can run the server request trigger; failures before the
first streamed token use bounded retries and ordered profile/legacy-model
fallbacks. Blank-response fallback, banned-script retries, and character Escape
Output are applied before frames become authoritative. Buffered
multi-generation choices each pass post-generation derivation before their
alternate ids are persisted.

Generation finalization retries are SQLite-backed operational rows with
target snapshots. Persistence is idempotent when the target already has the
final output and rejects stale chat/message/scriptstate targets; retry rows move
through pending/terminal states, and app startup runs an immediate sweep plus a
default 5s interval that also prunes retained terminal rows.

Server chat assembly applies the effective profile-bound model and runtime
overlay before prompt budgeting and provider dispatch. Chat-scoped generation
settings can select model/prompt presets; the model-runtime projection resolves
the active profile, request model, provider options, fallbacks, and runtime
options before the server builds dispatch config. Prompt-preset model overrides
are reapplied after profile-bound runtime fields so prompt preset authorship can
intentionally override the selected model preset. Route preflight rejects stale
legacy `presetId` usage in favor of chat `generationSettings`.

Prompt-template generation precedence is owner-based. A chat-scoped
`generationSettings.promptPresetId` wins when present; otherwise generation uses
the selected/global modern prompt preset. The top-level `promptTemplate` is only
a compatibility fallback when no modern prompt-preset owner resolves. A resolved
modern prompt preset without a template disables template rendering instead of
borrowing stale top-level data.

`/api/v1/generate/preview-prompt` is a one-shot JSON assembly route. It applies
the same server prompt assembly and generation-settings/profile guards but does
not dispatch a provider. Unlike `/api/v1/generate/chat` SSE preview-style
callers, it can return ordinary HTTP errors because it has not already written
SSE headers; chat SSE assembly failures become terminal `error` frames.

`/api/v1/generate/completion` is lower-level. Normal browser traffic sends
already-shaped messages and sampling intent as `kind: "server-intent"`; the
server rejects provider/model/options/secrets in that envelope and resolves them
from persisted settings before calling the same dispatch core. Optional
`tools`/`toolRounds` carry the bounded buffered tool protocol described above;
the response may carry validated `toolCalls` for browser execution. A legacy
direct-provider envelope remains for compatibility tests/tools, routed through
the current provider adapters and their direct completion streaming rules.

## Server Assembly Gates

Fastify hard-fails shapes it cannot represent safely:

| Gate                                               | Reason                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| Send whose latest row is not a text user message   | Server prompt assembly only owns send when the latest row is text from the user. |
| Non-text send tail for unsupported content classes | Server will not silently drop browser-only content.                              |
| Group chat                                         | Removed/no-port.                                                                 |
| Plugin/WebLLM/non-server-routable providers        | No Fastify provider adapter.                                                     |
| Non-vision image-caption fallback                  | Browser captioning pipeline has no server equivalent.                            |
| Interactive Lua dialogs                            | Strict script preflight blocks known dialog sources; otherwise the server Lua runtime fails if a dialog API is invoked because it cannot drive browser dialogs mid-request. Non-interactive Lua remains server-routable. |
| Plugin V2 edit/replacer hooks                      | Browser plugin execution is no-port.                                             |

Supported multimodal/image/asset/inlay inputs route through server asset ids
where possible and only when the selected server-routed model accepts image
input. Prompt assembly resolves bytes from the server asset store when a provider
needs inline media.

## Adding Provider Behavior

Update browser model/settings metadata, `providerCapability.ts`,
`server/fastify/src/prompt/chatDispatch.ts`, provider secrets/settings groups,
generation adapters, and server chat/completion tests for server-routable
providers.
