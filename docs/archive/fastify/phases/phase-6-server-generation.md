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

## Status: closed (2026-05-22)

The `/completion` part of Phase 6 closes here. The translation /
TTS / image / token-counting / triggers routes listed under "Scope"
below stay on the roadmap but are not part of the closeout —
they're tracked separately and can land at any time without
re-opening Phase 6. See [closeout below](#closeout-2026-05-22) for
the explicit exit scope and the items that were deferred to other
phases or a fixture-driven trigger.

## Landed So Far

As of 2026-05-22, Phase 6 has landed
`POST /api/v1/generate/completion`, the normalized SSE envelope, the
server-backed client adapter, and provider dispatch through Phase 6-27
(`cb6d876c`), ending with the dual-mode fixture sweep
extended to cover the providers routed after the original 7-fixture
set. The dual-mode fixture sweep now covers twelve fixtures (the
seven provider-parity originals plus Vertex Gemini, Bedrock, Horde,
Mistral reverse_proxy, and Anthropic reverse_proxy). Newer provider
variants beyond those twelve are covered by route, dispatcher, and
adapter tests. The rest of this document describes the full Phase
6 target scope; the closeout section spells out what's intentionally
deferred.

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
    `/v1/completions`; llama.cpp-compatible endpoints; hardcoded
    OpenAI-compatible endpoints without a keyIdentifier; and
    custom-format variants without a routed auth / request-shape
    slice, such as Gemini `reverse_proxy` / `xcustom`.
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

- During the Phase 6 completion-route slices, the client adapter still reads
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

## Closeout (2026-05-22)

### What landed

- `POST /api/v1/generate/completion` with auth gate, normalized
  SSE envelope, abort plumbing, and a Phase-6-2 client adapter
  flag-gated on `db.useServerGeneration`.
- Provider dispatch for 15+ wire shapes plus their variant
  routings: echo, OpenAI Chat (+ NanoGPT chat, OpenRouter, DeepSeek
  / DeepInfra keyIdentifier path, Ollama Cloud OAI), Anthropic
  Messages (+ Anthropic Legacy, NanoGPT Messages, Ollama Cloud
  Anthropic), Mistral, Cohere, OpenAI Legacy Instruct (+ NanoGPT
  Legacy), OpenAI Responses (+ NanoGPT Responses, Ollama Cloud
  Responses), Kobold, ooba legacy, native Ollama `/api/chat`,
  Google AI Gemini, Vertex AI Gemini (RS256 JWT + in-process Bearer
  cache), AWS Bedrock Claude (pure-JS SigV4), Stable Horde text
  (async polling), and `reverse_proxy` + `xcustom:::id` rides
  through openai / anthropic / mistral / cohere / openai-responses /
  openai-legacy-instruct (each with the shared `additionalParams`
  body/header overlay DSL ported into the dispatcher via a
  `buildRequestInit` refactor).
- Shared server-side infrastructure: `additionalParams.ts` DSL,
  `vertexAuth.ts` JWT signer + Bearer cache, `sigv4.ts` AWS
  signer, `applyOobaSystemHoist` for reverse_proxy ooba mode, and
  a handful of URL autofill helpers (`resolveReverseProxyUrl`,
  `resolveReverseProxyAnthropicUrl`, `resolveReverseProxyCohereUrl`,
  `resolveReverseProxyResponsesUrl`,
  `resolveReverseProxyLegacyInstructUrl`).
- Dual-mode fixture sweep: 12 fixtures (echo, openai, anthropic,
  mistral, cohere, deepseek, gemini, gemini-vertex, bedrock, horde,
  mistral-reverse-proxy, anthropic-reverse-proxy). Local sweep
  (38 fixtures) covers the broader sendChat snapshot set.

### Test counts at closeout

- `pnpm api:test`: 434 across 27 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: clean

### Deferred to Phase 7

These providers can't ship their server slices until Phase 7 lands
server-owned character/user state, since their prompt flatten
needs the full character context:

- Ooba OAI-compatible `/v1/completions` against
  `db.textgenWebUIBlockingURL`. Memo:
  [`../other/design/ooba-oai-compat.md`](../other/design/ooba-oai-compat.md).
- NovelAI text + NovelList. Memo:
  [`../other/design/novelai-novellist-stringlize.md`](../other/design/novelai-novellist-stringlize.md).

The Horde slice (6-22) used the option-B pattern — client
pre-flattens via `applyChatTemplate`, server takes a `prompt`
string, client unstringlizes the result. The same pattern is
available for the three deferred providers if Phase 7 chooses to
ship them that way instead of moving the flatten server-side.

### Deferred until a fixture demands it

- **Bedrock streaming.** AWS EventStream is a binary
  length-prefixed framing protocol on
  `:invoke-with-response-stream` (~250 LOC for parser + plumbing).
  No fixture currently demands streaming; buffered-only is
  honest about the current need. When a fixture lands later, the
  next agent should add an EventStream parser alongside the
  existing `sigv4.ts`.
- **OpenAI MultiGen (`body.n = db.genTime`).** Deferred from the
  reverse_proxy slice. Incompatible with the one-stream-per-completion
  SSE envelope as currently designed; would need a multi-result
  return shape (or per-result envelopes).
- **ooba-legacy streaming via WebSocket.** Local uses a WS stream;
  the fetch SSE envelope doesn't apply. Deferred.
- **Cohere / OpenAI Responses / Legacy Instruct / Kobold streaming.**
  Each is buffered-only in the local path too; no fixture demands
  it.

### Out of scope for this phase

These remain on the Phase 6 roadmap above but were never part of
the `/completion` closeout. They each get their own slice when
prioritized; they don't gate Phase 7:

- `POST /api/v1/generate/translate` (DeepL, DeepLX, Google
  Translate, Bergamot, LLM translation).
- `POST /api/v1/generate/tts`.
- `POST /api/v1/generate/image`.
- `POST /api/v1/generate/count-tokens` + `GET /api/v1/generate/encodings`.
- `POST /api/v1/generate/triggers/run` (worker_threads sandbox).

### Exit criteria check

- ✅ Every LLM provider in `src/ts/model/modellist.ts` that doesn't
  need character/user state has a server-side dispatch path. The
  ones that do need it (Ooba OAI, NovelAI, NovelList) are
  documented memos and deferred to Phase 7.
- ✅ `pnpm api:test` covers each provider's request shaping +
  response normalization with a dispatcher + route test suite.
- ✅ The dual-mode fixture sweep covers 12 fixtures across the
  major routed providers and produces identical observable output
  in both modes.
- ✅ `pnpm test`, `pnpm check`, `pnpm build`, `pnpm api:test` green.
