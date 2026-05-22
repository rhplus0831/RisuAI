# Phase 6 - Server-Side Generation

Date: 2026-05-22

## Goal

Move Stage 3 (provider dispatch + streaming) and helper providers
(translation, TTS, image, tokenizer) behind Fastify routes. Stable
Horde text rides the completion route as provider `horde`. End
state: the browser stops holding LLM API keys; the server makes the
calls and streams the results.

## Preconditions

- Phase 3 closed (proxy is server-side).
- Phase 5 closed (Stage 3 is its own browser module already).

## Landed So Far

As of 2026-05-22, Phase 6 has landed `POST
/api/v1/generate/completion`, the normalized SSE envelope, the
server-backed client adapter, and provider dispatch through
Phase 6-22 (`5e2975ec`), ending with Stable Horde text. The
dual-mode fixture sweep still covers the seven provider-parity
fixtures listed in
[`../coverage/sendchat-fixtures.md`](../coverage/sendchat-fixtures.md);
newer provider variants are covered by route, dispatcher, and
adapter tests. The rest of this document describes the full Phase
6 target scope and the remaining provider/helper work.

## Scope

### Routes

- `POST /api/v1/generate/completion` - OpenAI-shaped Chat
  Completions request. Provider field selects implementation:
  - Landed: echo; OpenAI Chat Completions; OpenRouter; NanoGPT
    chat; DeepSeek / DeepInfra via the OpenAI-compatible
    keyIdentifier path; Anthropic Messages / legacy / NanoGPT
    Messages; Mistral; Cohere; vanilla Google AI Gemini; OpenAI
    legacy instruct / NanoGPT legacy; OpenAI Responses / NanoGPT
    Responses; Ollama Cloud variants; Kobold; ooba legacy; native
    Ollama `/api/chat`; OAI-compatible `xcustom:::` and
    `reverse_proxy`; Anthropic-format `xcustom:::` and
    `reverse_proxy`; Vertex AI Gemini; AWS Bedrock Claude; and
    Stable Horde text.
  - Remaining: NovelAI text; NovelList; ooba OAI-compatible
    `/v1/completions`; llama.cpp-compatible endpoints; and
    `reverse_proxy` / `xcustom` variants whose `db.customAPIFormat`
    points at Mistral, Cohere, or another dispatcher that does not
    yet receive the additional-parameters overlay.
  - Stable Horde text lands as provider `horde` on this route; no
    separate `/api/v1/generate/horde` route exists in the current
    tree.
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

### Target streaming contract

Each streaming-capable `POST /api/v1/generate/completion` provider
returns SSE if `stream: true`. The browser subscribes; the server
forwards upstream chunks with a normalized envelope:

```
event: chunk
data: { "type": "token", "content": "..." }

event: chunk
data: { "type": "usage", "promptTokens": 1234, "completionTokens": 5 }

event: done
data: { "finishReason": "stop" }
```

Usage frames are optional. Streaming-capable landed providers emit
token chunks plus a final `done`; buffered-only providers currently
return a normal JSON result and reject `stream: true` with a 400.
Client disconnect aborts the upstream via `AbortController`.

### Browser changes

The Stage 3 dispatch/response extraction module from Phase 5 gains
two modes:

- Local (existing) - keeps the current direct-fetch path. Used when
  `db.useServerGeneration !== true` or the provider is not yet
  server-routable.
- Server-backed - posts to `/api/v1/generate/completion` and
  iterates the SSE stream.

`requestChatData` (the function the dispatch module wraps) keeps
both modes side by side until Phase 9.

### Key handling

- During the current Phase 6 slices, the client adapter still reads
  the existing DB key fields and sends only the selected provider's
  key in the `/generate/completion` options body. This preserves
  current settings behavior while provider coverage is incomplete.
- The final server-owned key path reads provider API keys from the
  `auth` settings group (and translation keys from the
  `translation` group). At that point the browser no longer needs
  the key in server-backed mode.
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
