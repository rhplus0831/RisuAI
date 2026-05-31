# Providers And Models

Provider and model behavior is split between browser model metadata, Fastify
provider dispatch, and a shared capability table that decides whether a request
shape can run on the server.

## Browser Model Registry

Important files:

| Path                                                                                           | Purpose                                                                            |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/ts/model/types.ts`                                                                        | `LLMProvider`, `LLMFormat`, `LLMTokenizer`, `LLMFlags`, and `LLMModel` vocabulary. |
| `src/ts/model/modellist.ts`                                                                    | Static model registry, dynamic registration, custom models, and `getModelInfo()`.  |
| `src/ts/model/providers/`                                                                      | Provider-specific static model lists.                                              |
| `src/ts/model/openrouter.ts`, `nanogpt.ts`, `ollama.ts`, `ooba.ts`, `horde/getModels.ts`       | Browser-side model/provider catalog helpers.                                       |
| `src/lib/UI/ModelList.svelte`, `ModelGrid.svelte`, `NanoGPT*`, `OpenrouterProviderList.svelte` | Model-picker and provider UI surfaces.                                             |

`Database.aiModel` and related fields select model strings for main, auxiliary,
fallback, translator, memory, and provider-specific flows. Custom and dynamic
models are browser registry concepts; the server does not import the full
browser model registry.

## Server Provider Dispatch

Fastify dispatch is centered in `server/fastify/src/prompt/chatDispatch.ts`.
Provider-specific adapters live in `server/fastify/src/generation/`:

- OpenAI, OpenAI Responses, OpenAI-compatible, and legacy instruct.
- Anthropic, Gemini, Vertex auth, Bedrock/SigV4, Cohere, Mistral, Ollama,
  Kobold, Horde, Ooba legacy, and Echo.
- Shared frame/SSE helpers and additional-parameter handling.

The server resolves provider settings, URLs, and secrets from its unmasked
database state. Browser projections mask provider secrets through
`server/fastify/src/providerSecrets.ts`, and settings writes resolve masked
sentinels back to the currently stored secret so a redacted projection does not
overwrite real credentials.

## Capability Table

`src/ts/process/request/providerCapability.ts` is shared by browser and server
paths. It decides which provider/content shapes are:

- `server`: supported by the Fastify server assembly/dispatch path.
- `local`: allowed only outside Fastify mode.
- `unsupported`: hard-failed in Fastify mode.

Do not fork this table in server-only code. It is the contract that keeps
browser preflight, `/api/v1/generate/chat`, and `/api/v1/generate/completion`
aligned.

## Chat Generation Vs Completion

`/api/v1/generate/chat` is the server-assembled chat path. The browser sends raw
chat inputs; the server assembles the prompt, dispatches the provider, streams
chat SSE frames, runs post-generation derivation, and persists the result for
server-dispatch paths.

`/api/v1/generate/completion` is lower level:

- Server-intent requests send already-shaped messages and sampling intent, not
  provider wire credentials/options.
- The server resolves the provider, wire model, endpoint, and secrets from the
  database before dispatching.
- A legacy direct-provider envelope remains for compatibility tests/tools.
- Some providers that are non-streaming on the direct completion route are
  wrapped into single-frame results on the chat route.

## Server Assembly Gates

Fastify mode hard-fails shapes that cannot be represented safely on the server.
Major unsupported gates include:

| Gate                                                        | Reason                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Non-text send tail for unsupported content classes          | The server will not silently drop browser-only content.            |
| Group chat                                                  | Removed/no-port.                                                   |
| Non-server-routable provider or plugin/WebLLM-only provider | No Fastify provider adapter.                                       |
| Non-vision image-caption fallback                           | Browser-only captioning pipeline has no server equivalent.         |
| Interactive Lua dialogs                                     | Server prompt assembly cannot drive browser dialogs mid-request.   |
| Plugin V2 edit/replacer hooks                               | Browser plugin execution is not ported to Fastify prompt assembly. |

Supported multimodal/image/asset/inlay inputs are routed through server asset
ids where possible. Fastify-mode inlay bytes are uploaded to `/api/v1/assets`
and sent to generation as id aliases; prompt assembly resolves bytes from the
server asset store when a provider needs inline media.

## Provider Secrets And Settings

Provider/API-key settings are grouped as command-backed settings. Secret fields
are masked in bootstrap and projection responses, then rehydrated on writes.

When adding a provider setting:

- Add it to the browser settings metadata and server settings group mapping.
- Decide whether it is a provider secret and update `providerSecrets.ts`.
- Update the shared capability table if it affects server routability.
- Add route/provider tests for both server-intent completion and chat generation
  if the provider can run on the server.
