# Phase 6 - Server-Side Generation

Date: 2026-05-21

## Goal

Move Stage 3 (provider dispatch + streaming) and helper providers
(translation, TTS, image, Stable Horde, tokenizer) behind Fastify
routes. The browser stops holding LLM API keys; the server makes
the calls and streams the results.

## Preconditions

- Phase 3 closed (proxy is server-side).
- Phase 5 closed (Stage 3 is its own browser module already).

## Scope

### Routes

- `POST /api/v1/generate/completion` - OpenAI-shaped Chat
  Completions request. Provider field selects implementation:
  - OpenAI Chat Completions, OpenAI Responses API, and OpenAI
    legacy instruct.
  - OpenAI-compatible custom endpoints, OpenRouter, DeepSeek, and
    DeepInfra.
  - NanoGPT chat / responses / messages / legacy formats.
  - Mistral and Cohere.
  - Anthropic Messages, Anthropic legacy, and AWS Bedrock Claude.
  - Gemini / Google and Vertex AI Gemini (with OAuth refresh).
  - NovelAI text and NovelList.
  - Local / self-hosted: Ollama, Kobold, ooba
    (text-generation-webui), and llama.cpp-compatible endpoints.
  - Stable Horde text generation.
  - Echo as a local deterministic developer provider.
- `POST /api/v1/generate/horde` - Stable Horde text generation.
- `POST /api/v1/generate/translate` - DeepL, DeepLX, Google
  Translate free / HTML, Bergamot, and LLM translation. LLM-based
  translation reuses
  `/api/v1/generate/completion`.
- `POST /api/v1/generate/tts` - OpenAI, ElevenLabs, NovelAI,
  Hugging Face API Inference. Browser Web Speech, VoiceVox, Vits,
  GPT-SoVITS, and Fish Speech stay browser-local or LAN-local.
- `POST /api/v1/generate/image` - DALL-E, Stability, Imagen, fal,
  NovelAI, WaveSpeed, WebUI, kei, ComfyUI / legacy Comfy, and the
  OpenAI-compatible image route.
- `POST /api/v1/generate/count-tokens` - tokenizer counting for the
  current `src/ts/tokenizer.ts` set: tiktoken (`cl100k_base`,
  `o200k_base`), Mistral, NovelAI, Claude, Llama / Llama 3,
  NovelList, Gemma, Cohere, DeepSeek / DeepSeek V4, GLM4, and GLM5.
- `GET /api/v1/generate/encodings` - lists available tokenizers.
- `POST /api/v1/generate/triggers/run` - server-side
  `node:worker_threads` sandbox for `editInput`, `editRequest`,
  `editOutput` triggerscript runs. Deny `require`, `process`,
  `fetch`, timers, fs, net. Wall-clock timeout enforced by parent.

### Streaming contract

Each `POST /api/v1/generate/completion` returns SSE if
`stream: true`. The browser subscribes; the server forwards each
upstream chunk verbatim with a normalized envelope:

```
event: chunk
data: { "type": "token", "content": "..." }

event: chunk
data: { "type": "usage", "promptTokens": 1234, "completionTokens": 5 }

event: done
data: { "finishReason": "stop" }
```

Client disconnect aborts the upstream via `AbortController`.

### Browser changes

The Stage 3 dispatch/response extraction module from Phase 5 gains
two modes:

- Local (existing) - keeps the current direct-fetch path. Used
  when the server-backed mode flag is off; the final flag name is
  set when this phase lands.
- Server-backed - posts to `/api/v1/generate/completion` and
  iterates the SSE stream.

`requestChatData` (the function the dispatch module wraps) keeps
both modes side by side until Phase 9.

### Key handling

- Server reads provider API keys from the `auth` settings group
  (and translation keys from the `translation` group). The browser
  no longer needs the key in server-backed mode.
- Bootstrap optionally masks keys when `RISU_MASK_SERVER_KEYS=1`.
  Defaults to off until every provider the user relies on has a
  server-side path. The decision to flip the flag on is a
  per-deployment one; the roadmap does not flip it until Phase 9.

## Boundaries

- **Do not move prompt assembly.** This phase ships
  `/completion` that accepts the same OpenAI-shaped `messages[]`
  the browser already builds. Prompt assembly is Phase 7.
- **Do not move memory.** This phase ships completion +
  helpers; memory chunking / embeddings are Phase 8.
- **Do not skip a provider because it is rare.** Every provider
  the browser supports today either lands here or is explicitly
  marked "browser-local only" / "plugin-local only" (plugin
  providers, WebLLM, Hugging Face `hf:::` models, transformers.js
  image embedding, Web Speech, VoiceVox, Vits, GPT-SoVITS,
  Fish Speech) in the route's 501 response.
- **Do not redesign the trigger script language.** The server
  sandbox runs the same source the browser does, with a stricter
  globals set.

## Exit criteria

- Every LLM provider in `src/ts/model/modellist.ts` either has a
  server-side dispatch path or returns a documented `501` with a
  reason.
- `pnpm api:test` covers each provider's request shaping +
  response normalization (one happy path per provider, plus the
  shared error / abort / stream tests).
- The Phase 4 / 5 fixture set runs against both modes (local
  dispatch and server-backed dispatch) and produces identical
  observable output.
- `pnpm test`, `pnpm check`, `pnpm build`, `pnpm api:test` green.

## Reference

- `move-to-fastify`'s `server/fastify/src/generation.ts` is the
  worked example. The provider-by-provider commits between
  `648fe0fb` and `fe8179bd` show how each upstream's quirks were
  handled.
- `risuai-metatron`'s `chat_generation/providers.py` (7370 lines!)
  is the cautionary tale: keep `generate/router.ts` and each
  provider file small. Avoid building one big shared planner.
