# Next Steps

Date: 2026-05-23

Use this list to pick the next chunk of work. Phase 5 and the
`/completion` part of Phase 6 are closed; their details live in
[`sendchat-slicing.md`](sendchat-slicing.md) and the Phase 6
[Closeout](../phases/phase-6-server-generation.md#closeout).
Phase 7 is active with seventeen slices landed through 7-7e:
chat route scaffold, parser/static/plain leaves, history through
multimodal inlays, regex scripts, active-module helpers, and
lorebook activation/depth helpers. `assemble`, `templates`,
`tokens`, and `triggers` remain throwing stubs. Use
[`HANDOVER.md`](../../../HANDOVER.md) for the pickup runbook and
[`ROADMAP.md`](../../../ROADMAP.md) for the strategic order.

## Immediate

1. **Continue Phase 7 with slice 7-8a — server tokenizer.**
   The activation/depth lorebook work is at a clean handoff
   (`c0f3fb3a` landed 7-7e). 7-8a unblocks both 7-7d
   (lorebook budget filter) and 7-5e (history tokenizer
   accumulation + depth-prompt token preflight).

   Verified slice scope:
   - Stand up `server/fastify/src/prompt/tokens.ts` (currently a
     throwing stub) with the capped server surface:
     `encodingForModel(model)`, `tokenize(text, model)`,
     `tokenizeChat(chat, model, opts)`, and `tokenizeChats(...)`.
     Use `@dqbd/tiktoken` with `cl100k_base` / `o200k_base`,
     explicit model strings, and a small module-scope encoder cache.
   - Keep chat counting text-only: content tokens, per-message
     overhead, optional `name`, and optional `thoughts`.
   - Do not port the full browser tokenizer dispatcher, Svelte
     stores, plugin/custom tokenizers, remote/local provider
     tokenizers, or multimodal image-token math in 7-8a.
   - Isolated unit tests only: encoding selection, empty string,
     ASCII baseline, text chat overhead, `name`, `thoughts`, and
     `tokenizeChats` summing.

   If even the capped tiktoken import path gets blocked, defer to
   **7-9a — trigger sandbox** or **7-10a — template card parsing**
   instead; both are independently shippable parallel fronts.

   The decision on the three deferred providers (Ooba
   OAI-compatible, NovelAI text, NovelList) remains **D — wait
   for the server-side flatten**; memos in
   [`design/ooba-oai-compat.md`](../design/ooba-oai-compat.md) and
   [`design/novelai-novellist-stringlize.md`](../design/novelai-novellist-stringlize.md)
   explain why. Keep the 38 local sendChat snapshots, the
   12-fixture server-backed sweep, and the Fastify generation
   tests green. Last recorded baselines are `pnpm api:test`: 640
   and `pnpm test`: 601 + 4 skipped.

2. **Follow-up: hub-route session auth.** `ANY /api/v1/hub/*` is
   still gated by `requireAuth`, so password-protected deployments
   can 401 browser-loaded hub resources that cannot send
   `risu-auth` headers. The accepted Phase 3D-Broad decision was
   to ship this limitation and revisit either public hub proxying
   or session-cookie auth when needed.

## Landed Phase 6 Slices

| Slice | Commit     | Summary                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6-1   | `dd512203` | Added auth-gated `POST /api/v1/generate/completion`, the normalized `chunk` / `done` SSE envelope, and the echo provider.                                                                                                                                                                                                                                                                                                 |
| 6-2   | `d3d3f608` | Added the flag-gated client adapter for echo through `/api/v1/generate/completion`.                                                                                                                                                                                                                                                                                                                                       |
| 6-3   | `8f4209b3` | Added the dual-mode fixture harness and `echo-basic`.                                                                                                                                                                                                                                                                                                                                                                     |
| 6-4a  | `add21521` | Added the OpenAI Chat Completions dispatcher and route coverage.                                                                                                                                                                                                                                                                                                                                                          |
| 6-4b  | `8bd5158a` | Routed vanilla OpenAI from the client adapter and added `openai-basic`.                                                                                                                                                                                                                                                                                                                                                   |
| 6-4c  | `3b81f65c` | Added NanoGPT chat and OpenRouter variants on the OpenAI-compatible dispatcher.                                                                                                                                                                                                                                                                                                                                           |
| 6-5   | `0bbdbaa9` | Added Anthropic Messages end to end and `anthropic-basic`.                                                                                                                                                                                                                                                                                                                                                                |
| 6-6   | `926bba1c` | Added Mistral request shaping, streaming / buffered dispatch, tests, and `mistral-basic`.                                                                                                                                                                                                                                                                                                                                 |
| 6-7   | `f957dba8` | Added Cohere buffered dispatch, tests, and `cohere-basic`.                                                                                                                                                                                                                                                                                                                                                                |
| 6-8   | `6c9b39e8` | Routed DeepSeek / DeepInfra keyIdentifier models through the OpenAI-compatible dispatcher and added `deepseek-basic`.                                                                                                                                                                                                                                                                                                     |
| 6-9   | `cab433f3` | Added vanilla Google AI Gemini request shaping, streaming / buffered dispatch, tests, and `gemini-basic`.                                                                                                                                                                                                                                                                                                                 |
| 6-10  | `ca8fb5f9` | Added OpenAI legacy instruct and NanoGPT legacy over `/v1/completions` (buffered only).                                                                                                                                                                                                                                                                                                                                   |
| 6-11  | `e8bbbf61` | Routed Anthropic Legacy and NanoGPT Messages through the Anthropic-compatible dispatcher.                                                                                                                                                                                                                                                                                                                                 |
| 6-12  | `b1343d9e` | Added OpenAI Responses API and NanoGPT Responses (buffered only).                                                                                                                                                                                                                                                                                                                                                         |
| 6-13  | `76ec283c` | Routed Ollama Cloud through OpenAI / Responses / Anthropic dispatchers based on `db.ollamaRequestFormat`.                                                                                                                                                                                                                                                                                                                 |
| 6-14  | `f6b88f01` | Added Kobold and ooba legacy buffered dispatchers and tests.                                                                                                                                                                                                                                                                                                                                                              |
| 6-16  | `c919e683` | Added native Ollama `/api/chat` dispatcher with NDJSON streaming, adapter `db.ollamaURL` gate, and route + dispatcher tests.                                                                                                                                                                                                                                                                                              |
| 6-17  | `da7d05b8` | Routed `xcustom:::<id>` OAI-compat through the openai dispatcher with the `additionalParams` body/header overlay DSL ported server-side.                                                                                                                                                                                                                                                                                  |
| 6-18  | `425d8302` | Routed `reverse_proxy` OAI-compat through the openai dispatcher with URL autofill, `risu::` → `X-Proxy-Risu` header lift, server-side `oobaSystemHoist`, and `db.additionalParams` overlay.                                                                                                                                                                                                                               |
| 6-19  | `af7c15f7` | Ported the `additionalParams` overlay to the anthropic dispatcher; routed `reverse_proxy` + `xcustom:::id` under `LLMFormat.Anthropic` with URL autofill to `/v1/messages`.                                                                                                                                                                                                                                               |
| 6-20  | `7c5547be` | Added Vertex AI Gemini: RS256 JWT signed with Node `crypto`, in-process Bearer cache, `<region>-aiplatform.googleapis.com` URL with `global` carveout for Gemini 3 preview models.                                                                                                                                                                                                                                        |
| 6-21  | `704c1313` | Added AWS Bedrock Claude (buffered-only): pure-JS SigV4 helper, Anthropic Messages body with `anthropic_version: bedrock-2023-05-31`, `us.` / `global.` model prefix per claude-4.5+ heuristic.                                                                                                                                                                                                                           |
| 6-22  | `5e2975ec` | Added Stable Horde text dispatcher (buffered-only): 2 s poll loop on `/v2/generate/text/status/<id>` with a 5 min wall-clock timeout, fire-and-forget DELETE on abort. Client pre-flattens via `applyChatTemplate` and unstringlizes the result.                                                                                                                                                                          |
| 6-23  | `755bbe83` | Ported the `additionalParams` overlay to the mistral dispatcher via a `buildRequestInit` refactor; routed `reverse_proxy` + `xcustom:::id` under `LLMFormat.Mistral` with URL autofill to `/v1/chat/completions` (reuses the OAI-compat `resolveReverseProxyUrl` helper) and the `risu::` → `X-Proxy-Risu` header lift.                                                                                                   |
| 6-24  | `691daa0f` | Ported the `additionalParams` overlay to the cohere dispatcher via a `buildRequestInit` refactor; routed `reverse_proxy` + `xcustom:::id` under `LLMFormat.Cohere` with a dedicated `resolveReverseProxyCohereUrl` autofill helper for the `/v1/chat` wire path.                                                                                                                                                          |
| 6-25  | `9497a9fd` | Ported the `additionalParams` overlay to the openai-responses dispatcher via a `buildRequestInit` refactor; routed `reverse_proxy` + `xcustom:::id` under `LLMFormat.OpenAIResponseAPI` with a dedicated `resolveReverseProxyResponsesUrl` autofill helper for the `/v1/responses` wire path.                                                                                                                             |
| 6-26  | `7ae69fd8` | Ported the `additionalParams` overlay to the openai-legacy-instruct dispatcher via a `buildRequestInit` refactor; routed `reverse_proxy` + `xcustom:::id` under `LLMFormat.OpenAILegacyInstruct` with a dedicated `resolveReverseProxyLegacyInstructUrl` autofill helper for the `/v1/completions` wire path.                                                                                                             |
| 6-27  | `cb6d876c` | Extended the dual-mode fixture sweep with five fixtures for the newly-routed providers: `gemini-vertex-basic`, `bedrock-basic`, `horde-basic`, `mistral-reverse-proxy-basic`, and `anthropic-reverse-proxy-basic`. Added bedrock and horde branches to the server fetch stub; wired each fixture's upstream jsonl `result` + `model` through per-provider result setters so both sweeps assert against the same snapshot. |
| 6-28  | `398a3ae6` | Phase 6 closeout: refreshed `phases/phase-6-server-generation.md` with an explicit "Closeout" section enumerating what landed, what was deferred to Phase 7 (Ooba / NovelAI / NovelList), and what's deferred until a fixture demands it (Bedrock streaming, MultiGen, etc.). Refreshed HANDOVER.md for the next agent and flipped `next-steps.md` Immediate to point at Phase 7.                                         |

## Landed Phase 7 Slices

| Slice | Commit     | Summary                                                                                                |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------ |
| 7-1   | `3d2426c4` | Chat route scaffold, prompt SSE taxonomy, and prompt module stubs.                                     |
| 7-2a  | `9eed5093` | Parser DI seams for chat variables and `trigger_id`.                                                   |
| 7-2b  | `bb2c78b5` | Svelte-free `risuChatParser` extraction with SPA re-exports.                                           |
| 7-2c  | `7ed156e6` | Server parser adapter and real `expandVariables`.                                                      |
| 7-3   | `d0a2a7f3` | Static prompt sections.                                                                                |
| 7-4   | `051a5dcd` | Plain prompt sections.                                                                                 |
| 7-5a  | `c44e53fc` | Deterministic history walk.                                                                            |
| 7-6a  | `9a60380d` | Minimal preset/character regex script chain.                                                           |
| 7-5b  | `7ad226b9` | Per-message scripts, sendName, `<Thoughts>`, and memo/UUID backfill.                                   |
| 7-6b  | `8414d5c7` | Scripts `@@`-action prefixes.                                                                          |
| 7-6c  | `5aae492b` | `ableFlag` action DSL, outScript prep, and flag defaults.                                              |
| 7-6d  | `cb5675d8` | Module regex scripts through active-module helpers.                                                    |
| 7-5c  | `50a1770b` | History multimodal inlays, `{{asset_prompt::}}`, `AssetLookup`, and module assets.                     |
| 7-7a  | `c815e067` | Lorebook constant (always-on) entries + decorator scaffold + `inject_lore` rewrites.                   |
| 7-7b  | `25388d7d` | Lorebook keyword matching: `searchMatch`, child mirror, conditional-activation decorators, `matchLog`. |
| 7-7c  | `b11902ad` | Lorebook recursive activation: `while (matching)` loop, `recursivePrompt`, recursion decorators.       |
| 7-7e  | `c0f3fb3a` | Lorebook depth-prompt helpers: `getDepthPrompts`, `resolvePosition`, `applyDepthPrompts` splicer.      |

The detailed per-slice notes that used to live in this file were
folded into the current status shards:

- [`sendchat-slicing.md`](sendchat-slicing.md) for Phase 4/5
  fixture gates and extraction history.
- [`server.md`](server.md) for current Fastify routes and provider
  dispatchers.
- [`../coverage/providers.md`](../coverage/providers.md) for the
  provider test matrix.
- [`../coverage/sendchat-fixtures.md`](../coverage/sendchat-fixtures.md)
  for local and server-backed fixture inventory.

## Closed

Do not reopen these choices without adding a short rationale here
and updating the relevant phase doc:

- Tauri stays as-is. Do not add or modify Tauri-specific code in
  Phase 0-9.
- Hub proxy stays. The legacy `/hub-proxy/*` route was removed with
  Express; Fastify keeps `/api/v1/hub/*`.
- No whole-state PUT in the Fastify API.
- Only Hypa V3 survives. Do not re-introduce Supa, Hypa V2, or
  Hanurai.
- Fastify authenticated routes are ES256-only. Do not add a
  password-header acceptance path to `requireAuth` or individual
  routes. The WebSocket upgrade is the documented exception that
  accepts `risu-auth` through a query string.

## Verification before closing a slice

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Tauri build is verified manually at phase boundaries, not
per-slice.
