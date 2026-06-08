# Providers And Models

Provider/model behavior is split between browser model metadata, Fastify
provider dispatch, and the shared capability table that decides whether a
request shape can run on the server.

## Browser Model Registry

| Path                                                                                            | Role                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/ts/model/types.ts`                                                                         | `LLMProvider`, `LLMFormat`, `LLMTokenizer`, `LLMFlags`, `LLMModel`. |
| `src/ts/model/modellist.ts`                                                                     | Static/dynamic/custom model registry and `getModelInfo()`.          |
| `src/ts/model/providers/`                                                                       | Provider-specific static model lists.                               |
| `src/ts/model/openrouter.ts`, `nanogpt.ts`, `ollama.ts`, `ooba.ts`, `src/ts/horde/getModels.ts` | Browser provider catalog helpers.                                   |
| `src/lib/UI/ModelList.svelte`, `ModelGrid.svelte`, `NanoGPT*`, `OpenrouterProviderList.svelte`  | Model-picker UI.                                                    |

`Database.aiModel` and related fields select model strings for main, auxiliary,
fallback, translator, memory, and tool flows. Dynamic registry additions are
browser-side; persisted `xcustom:::` custom models are server-routable when
their stored URL/key/format pass the capability table. The server imports only
narrow metadata needed for dispatch decisions, not the full browser UI registry.

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

## Capability Table

`src/ts/process/request/providerCapability.ts` is the shared pure provider
routing decision table. Given resolved model metadata and the narrow config it
needs, it returns either a server provider name (`routable: true`) or a stable
unsupported reason category.

Do not fork this table in server-only code. Browser chat preflight and Fastify
dispatch share it. Server-intent completion sends shaped messages to Fastify;
provider/model routing is resolved server-side.

## Generation Surfaces

`/api/v1/generate/chat` is server-assembled. The browser sends raw chat inputs;
the server assembles the prompt, dispatches the provider, streams chat SSE
frames, runs post-generation derivation, and persists the result.

`/api/v1/generate/completion` is lower-level. The browser sends already-shaped
messages and sampling intent, and the server resolves provider/model/options
and secrets from persisted settings. A legacy direct-provider envelope remains
for compatibility tests/tools.

## Server Assembly Gates

Fastify hard-fails shapes it cannot represent safely:

| Gate                                               | Reason                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| Non-text send tail for unsupported content classes | Server will not silently drop browser-only content.              |
| Group chat                                         | Removed/no-port.                                                 |
| Plugin/WebLLM/non-server-routable providers        | No Fastify provider adapter.                                     |
| Non-vision image-caption fallback                  | Browser captioning pipeline has no server equivalent.            |
| Interactive Lua dialogs                            | Server prompt assembly cannot drive browser dialogs mid-request. |
| Plugin V2 edit/replacer hooks                      | Browser plugin execution is no-port.                             |

Supported multimodal/image/asset/inlay inputs route through server asset ids
where possible. Prompt assembly resolves bytes from the server asset store when
a provider needs inline media.

## Adding Provider Behavior

Update browser model/settings metadata, `providerCapability.ts`,
`server/fastify/src/prompt/chatDispatch.ts`, provider secrets/settings groups,
generation adapters, and server chat/completion tests for server-routable
providers.
