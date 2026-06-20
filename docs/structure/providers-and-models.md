# Providers And Models

Provider/model behavior is split between browser model metadata, Fastify
provider dispatch, and the shared capability table that decides whether a
request shape can run on the server.

## Browser Model Registry

| Path                                                                                            | Role                                                                                               |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/ts/model/types.ts`                                                                         | `LLMProvider`, `LLMFormat`, `LLMTokenizer`, `LLMFlags`, `LLMModel`.                                |
| `src/ts/model/modellist.ts`                                                                     | Static/dynamic/custom model registry and `getModelInfo()`.                                         |
| `src/ts/model/modelRoles.ts`                                                                    | Legacy model role helpers for main, auxiliary, memory, fallback, and tool flows.                   |
| `src/ts/model/modelProfileRecords.ts`, `modelProfileResolver.ts`, `modelProfileUiState.ts`      | Durable model profile records, role bindings, compatibility resolution, and settings UI summaries. |
| `src/ts/model/modelGrid.ts`                                                                     | Model-grid normalization and filtering helpers for picker UI.                                      |
| `src/ts/model/providers/`                                                                       | Provider-specific static model lists.                                                              |
| `src/ts/model/openrouter.ts`, `nanogpt.ts`, `ollama.ts`, `ooba.ts`, `src/ts/horde/getModels.ts` | Browser provider catalog helpers.                                                                  |
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
main, auxiliary, fallback, translator, memory, and tool flows when no durable
profile binding owns that role. Static/legacy fallback model ids still use flat
settings and pass through the `staticModel` path. Dynamic registry additions are
browser-side; persisted `xcustom:::` custom models are server-routable when
their stored URL/key/format pass the capability table. The server reconstructs
narrow dispatch metadata from persisted settings, profile-owned options, string
prefixes, and the OpenAI model allowlist; it does not import the full browser UI
registry. `src/ts/model/providers/nanogpt.ts` contains static endpoint
constants; dynamic NanoGPT account/model fetching lives in
`src/ts/model/nanogpt.ts`.

## Settings -> Model Profile Flow

Settings -> Model is now profile-first. `BotSettings.svelte` routes model
settings to `ModelSettingsShell.svelte`, which owns the visible workflow:

| Surface | Role |
| --- | --- |
| `ModelProfileRoleList.svelte` | Roles tab. Edits `modelRoleProfiles` with explicit Apply/Cancel, binding modes (`profile`, supported `inherit`, `legacy`), effective profile summaries, provider/model/request-model summaries, status, and fallback counts. |
| `ModelProfileList.svelte` | Profiles tab. Lists profile name/id, provider, model, request model, fallback count, status, role usage, and create/edit/duplicate/delete actions. |
| `ModelProfileEditorDrawer.svelte` | Command-backed profile drawer for first-class provider fields, profile runtime overrides, fallbacks, and profile-local secret placeholder preserve/replace/clear behavior. |
| `ModelRuntimeDefaultsEditor.svelte` | Edits `modelRuntimeDefaults` with explicit Save/Cancel and a compact count summary. |
| `ModelRoleList.svelte` | Legacy role editor shown only inside Advanced Legacy Settings for compatibility data. |

The shell prompts clearly legacy-only databases to Convert to Profiles through
the atomic conversion command. Declining hides the prompt for the session while
leaving the Convert to Profiles action visible. Advanced Legacy Settings still
shows the current legacy main/aux fields and the old role/provider controls so
older data, copied settings, and compatibility provider globals remain
reachable.

First-class profile provider panels are intentionally limited to:

- `openai`
- `anthropic`
- `google`
- `vertex`
- `custom-api`
- `debug-echo`

The first-class panels write top-level `providerId`, selected `modelId`,
`providerOptions` such as `apiKey`, `requestModel`, endpoint/base URL, extra
headers, additional params, Vertex fields, and Custom API tokenizer/flag
metadata. Custom API profiles represent OpenAI-compatible Chat Completions; the
UI stores a base URL and warns when the user includes `/chat/completions`
because dispatch appends that suffix.
Debug Echo profiles use the existing Echo dispatcher and return a small JSON
payload containing the profile-local Base URL and Request Model for provider
debugging.

## Durable Profile Data Flow

Defaults and normalization run in `src/ts/storage/database.svelte.ts` and
`server/fastify/src/databaseDefaults.ts`. Settings command validators in
`src/ts/server/commands.ts` and `server/fastify/src/routes/commands.ts` accept
only supported profile, provider option, runtime option, role-binding, and
fallback-ref shapes. Preset and loadout paths in `src/ts/presetSplit.ts`,
`server/fastify/src/commands/splitPresets.ts`, and `src/ts/loadout.ts` preserve
durable profile fields while still accepting legacy flat data.

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
- Memory summaries use memory-role profiles and profile-owned provider options.
  Memory embeddings stay outside chat profiles on the separate
  Hypa/Voyage/custom embedding config.
- The Custom Models catalog (`customModels` / `xcustom:::`) remains separate
  from first-class Custom API profiles.

## Server Provider Dispatch

Fastify dispatch is centered in `server/fastify/src/prompt/chatDispatch.ts`.
Provider adapters live in `server/fastify/src/generation/`:

- OpenAI, OpenAI Responses, OpenAI-compatible, and legacy instruct.
- OpenRouter and NanoGPT as OpenAI-compatible variants where applicable.
- Anthropic, Gemini, Vertex auth, Bedrock/SigV4, Cohere, Mistral, Ollama,
  Kobold, Horde, Ooba legacy, and Echo.
- Shared additional-parameter, frame, and SSE helpers.

The server resolves provider settings, endpoints, model ids, and secrets from
durable profile context when present, then from flat compatibility settings when
needed. Browser projections mask secrets through
`server/fastify/src/providerSecrets.ts`; settings writes resolve masked
sentinels back to current stored secrets.

Routing notes that matter when debugging provider drift:

| Area                     | Notes                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI-compatible ids    | Vanilla OpenAI ids use an allowlist; unknown OpenAI-compatible ids need custom/provider config.                                           |
| Reverse proxy / `risu::` | Server dispatch derives endpoint/key behavior from persisted proxy/custom-model settings.                                                 |
| OpenRouter               | Routes through OpenAI-compatible dispatch when persisted OpenRouter settings make the model server-routable.                              |
| NanoGPT                  | Message, legacy, and responses formats route to Anthropic-compatible, legacy instruct, or Responses-style adapters as selected by format. |
| Ollama local             | Native Ollama routes when an Ollama URL is configured.                                                                                    |
| Ollama Cloud             | `ollama-cloud` remaps by `ollamaRequestFormat` to OpenAI-compatible, Responses, or Anthropic-compatible dispatch.                         |
| Bedrock                  | Uses Bedrock/SigV4 model metadata and wire-model prefix handling.                                                                         |
| Horde                    | Requires an instruct chat template in the shared capability table; dispatch is buffered, not incremental.                                 |
| Logit bias               | Server chat dispatch does not currently carry browser-only logit-bias behavior.                                                           |

## Capability Table

`src/ts/process/request/providerCapability.ts` is the shared pure provider
routing decision table. Given resolved model metadata and the narrow config it
needs, it returns either a server provider name (`routable: true`) or a stable
unsupported reason category.

Do not fork this table for chat/completion routing. Browser chat preflight and
Fastify dispatch share it. Active durable profiles with incomplete or
unsupported status are blocked before browser request dispatch, server-intent
completion, `/generate/chat` SSE/job acceptance, and final server chat dispatch.
Server-intent completion sends shaped messages to Fastify; provider/model
routing is resolved server-side. Memory summaries use memory-role profile
resolution and profile-owned provider options. Memory embeddings intentionally
remain outside chat profiles on the separate Hypa/Voyage/custom embedding
contract in `memoryEmbeddingModel.ts`; deadlines are bounded through
`memoryProviderDeadline.ts`.

## Generation Client Map

| Path                                             | Role                                                           |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `src/ts/process/request/serverPromptAssembly.ts` | Browser preflight for server prompt assembly support and mode. |
| `src/ts/process/request/serverCompletion.ts`     | Server-intent completion route adapter.                        |
| `src/ts/process/serverBackedSendChat.ts`         | Chat send/preview bridge from UI inputs to Fastify routes.     |
| `src/ts/process/request/serverChat.ts`           | Chat SSE parser and request adapter.                           |
| `src/ts/process/request/serverChatEvents.ts`     | Client-side chat SSE frame/message-patch contract types.       |
| `src/ts/process/request/durableGeneration.ts`    | Durable send/continue/regenerate request helpers.              |
| `src/ts/process/reattach.ts`                     | Bootstrap-driven reattach for active durable generation jobs.  |
| `server/fastify/src/prompt/sseEvents.ts`         | Server-side chat SSE frame contract helpers.                   |

## Generation Surfaces

`/api/v1/generate/chat` is server-assembled. The browser sends raw chat inputs;
the server assembles the prompt, dispatches the provider, streams chat SSE
frames, runs post-generation derivation, and persists the result. Durable
send/continue/regenerate jobs are process-local in `generationJobs.ts`, exposed
through bootstrap `activeGenerationJobs`, reattached with
`GET /api/v1/generate/chat/:id/stream`, and cancelled with
`DELETE /api/v1/generate/chat/:id`.

Server chat assembly applies the effective profile-bound model and runtime
overlay before prompt budgeting and provider dispatch. Chat-scoped generation
settings can select model/prompt presets; the model-runtime projection resolves
the active profile, request model, provider options, fallbacks, and runtime
options before the server builds dispatch config.

`/api/v1/generate/completion` is lower-level. Normal browser traffic sends
already-shaped messages and sampling intent as `kind: "server-intent"`; the
server rejects provider/model/options/secrets in that envelope and resolves them
from persisted settings. A legacy direct-provider envelope remains for
compatibility tests/tools.

## Server Assembly Gates

Fastify hard-fails shapes it cannot represent safely:

| Gate                                               | Reason                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| Send whose latest row is not a text user message   | Server prompt assembly only owns send when the latest row is text from the user. |
| Non-text send tail for unsupported content classes | Server will not silently drop browser-only content.                              |
| Group chat                                         | Removed/no-port.                                                                 |
| Plugin/WebLLM/non-server-routable providers        | No Fastify provider adapter.                                                     |
| Non-vision image-caption fallback                  | Browser captioning pipeline has no server equivalent.                            |
| Interactive Lua dialogs                            | Server prompt assembly cannot drive browser dialogs mid-request.                 |
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
