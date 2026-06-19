# Providers And Models

Provider/model behavior is split between browser model metadata, Fastify
provider dispatch, and the shared capability table that decides whether a
request shape can run on the server.

## Browser Model Registry

| Path                                                                                            | Role                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/ts/model/types.ts`                                                                         | `LLMProvider`, `LLMFormat`, `LLMTokenizer`, `LLMFlags`, `LLMModel`. |
| `src/ts/model/modellist.ts`                                                                     | Static/dynamic/custom model registry and `getModelInfo()`.          |
| `src/ts/model/modelRoles.ts`                                                                    | Model role resolution for main, auxiliary, memory, fallback, and tool flows. |
| `src/ts/model/modelGrid.ts`                                                                     | Model-grid normalization and filtering helpers for picker UI.       |
| `src/ts/model/providers/`                                                                       | Provider-specific static model lists.                               |
| `src/ts/model/openrouter.ts`, `nanogpt.ts`, `ollama.ts`, `ooba.ts`, `src/ts/horde/getModels.ts` | Browser provider catalog helpers.                                   |
| `src/lib/UI/ModelList.svelte`, `ModelGrid.svelte`, `NanoGPT*`, `OpenrouterProviderList.svelte`  | Model-picker UI.                                                    |

`Database.aiModel` and related fields select model strings for main, auxiliary,
fallback, translator, memory, and tool flows. Dynamic registry additions are
browser-side; persisted `xcustom:::` custom models are server-routable when
their stored URL/key/format pass the capability table. The server reconstructs
narrow dispatch metadata from persisted settings, string prefixes, and the
OpenAI model allowlist; it does not import the full browser UI registry.
`src/ts/model/providers/nanogpt.ts` contains static endpoint constants; dynamic
NanoGPT account/model fetching lives in `src/ts/model/nanogpt.ts`.

## Server Provider Dispatch

Fastify dispatch is centered in `server/fastify/src/prompt/chatDispatch.ts`.
Provider adapters live in `server/fastify/src/generation/`:

- OpenAI, OpenAI Responses, OpenAI-compatible, and legacy instruct.
- OpenRouter and NanoGPT as OpenAI-compatible variants where applicable.
- Anthropic, Gemini, Vertex auth, Bedrock/SigV4, Cohere, Mistral, Ollama,
  Kobold, Horde, Ooba legacy, and Echo.
- Shared additional-parameter, frame, and SSE helpers.

The server resolves provider settings, endpoints, model ids, and secrets from
persisted settings. Browser projections mask secrets through
`server/fastify/src/providerSecrets.ts`; settings writes resolve masked
sentinels back to current stored secrets.

Routing notes that matter when debugging provider drift:

| Area                      | Notes                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| OpenAI-compatible ids     | Vanilla OpenAI ids use an allowlist; unknown OpenAI-compatible ids need custom/provider config. |
| Reverse proxy / `risu::`  | Server dispatch derives endpoint/key behavior from persisted proxy/custom-model settings.    |
| OpenRouter                | Routes through OpenAI-compatible dispatch when persisted OpenRouter settings make the model server-routable. |
| NanoGPT                   | Message, legacy, and responses formats route to Anthropic-compatible, legacy instruct, or Responses-style adapters as selected by format. |
| Ollama local              | Native Ollama routes when an Ollama URL is configured.                                         |
| Ollama Cloud              | `ollama-cloud` remaps by `ollamaRequestFormat` to OpenAI-compatible, Responses, or Anthropic-compatible dispatch. |
| Bedrock                   | Uses Bedrock/SigV4 model metadata and wire-model prefix handling.                            |
| Horde                     | Requires an instruct chat template in the shared capability table; dispatch is buffered, not incremental. |
| Logit bias                | Server chat dispatch does not currently carry browser-only logit-bias behavior.              |

## Capability Table

`src/ts/process/request/providerCapability.ts` is the shared pure provider
routing decision table. Given resolved model metadata and the narrow config it
needs, it returns either a server provider name (`routable: true`) or a stable
unsupported reason category.

Do not fork this table for chat/completion routing. Browser chat preflight and
Fastify dispatch share it. Server-intent completion sends shaped messages to
Fastify; provider/model routing is resolved server-side. Memory summary and
embedding jobs intentionally use separate server resolvers because their provider
surface is narrower: summaries use `memorySummaryModel.ts`, embeddings use
`memoryEmbeddingModel.ts`, and deadlines are bounded through
`memoryProviderDeadline.ts`.

## Generation Client Map

| Path                                                  | Role                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `src/ts/process/request/serverPromptAssembly.ts`      | Browser preflight for server prompt assembly support and mode.       |
| `src/ts/process/request/serverCompletion.ts`          | Server-intent completion route adapter.                              |
| `src/ts/process/serverBackedSendChat.ts`              | Chat send/preview bridge from UI inputs to Fastify routes.           |
| `src/ts/process/request/serverChat.ts`                | Chat SSE parser and request adapter.                                 |
| `src/ts/process/request/serverChatEvents.ts`          | Client-side chat SSE frame/message-patch contract types.            |
| `src/ts/process/request/durableGeneration.ts`         | Durable send/continue/regenerate request helpers.                    |
| `src/ts/process/reattach.ts`                          | Bootstrap-driven reattach for active durable generation jobs.        |
| `server/fastify/src/prompt/sseEvents.ts`              | Server-side chat SSE frame contract helpers.                         |

## Generation Surfaces

`/api/v1/generate/chat` is server-assembled. The browser sends raw chat inputs;
the server assembles the prompt, dispatches the provider, streams chat SSE
frames, runs post-generation derivation, and persists the result. Durable
send/continue/regenerate jobs are process-local in `generationJobs.ts`, exposed
through bootstrap `activeGenerationJobs`, reattached with
`GET /api/v1/generate/chat/:id/stream`, and cancelled with
`DELETE /api/v1/generate/chat/:id`.

`/api/v1/generate/completion` is lower-level. Normal browser traffic sends
already-shaped messages and sampling intent as `kind: "server-intent"`; the
server rejects provider/model/options/secrets in that envelope and resolves them
from persisted settings. A legacy direct-provider envelope remains for
compatibility tests/tools.

## Server Assembly Gates

Fastify hard-fails shapes it cannot represent safely:

| Gate                                               | Reason                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| Send whose latest row is not a text user message   | Server prompt assembly only owns send when the latest row is text from the user. |
| Non-text send tail for unsupported content classes | Server will not silently drop browser-only content.              |
| Group chat                                         | Removed/no-port.                                                 |
| Plugin/WebLLM/non-server-routable providers        | No Fastify provider adapter.                                     |
| Non-vision image-caption fallback                  | Browser captioning pipeline has no server equivalent.            |
| Interactive Lua dialogs                            | Server prompt assembly cannot drive browser dialogs mid-request. |
| Plugin V2 edit/replacer hooks                      | Browser plugin execution is no-port.                             |

Supported multimodal/image/asset/inlay inputs route through server asset ids
where possible and only when the selected server-routed model accepts image
input. Prompt assembly resolves bytes from the server asset store when a provider
needs inline media.

## Adding Provider Behavior

Update browser model/settings metadata, `providerCapability.ts`,
`server/fastify/src/prompt/chatDispatch.ts`, provider secrets/settings groups,
generation adapters, and server chat/completion tests for server-routable
providers.
