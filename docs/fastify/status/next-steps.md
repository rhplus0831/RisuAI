# Next Steps

Date: 2026-05-22

Use this list to pick the next chunk of work. Phase 5 closed on
2026-05-22 with all 28 extraction slices landed; the historical
slice record now lives in
[`sendchat-slicing.md`](sendchat-slicing.md). The `/completion`
part of Phase 6 closed on 2026-05-22 with 27 slices landed; see
the "Closeout" section in
[`../phases/phase-6-server-generation.md`](../phases/phase-6-server-generation.md)
for what landed, what was deferred to Phase 7, and what's
deferred until a fixture demands it. Phase 7 (prompt assembly)
is in progress as of 2026-05-23 — six slices landed (7-1
scaffold; 7-2a/b/c canonical `risuChatParser` extracted
Svelte-free + wired into the server via `expandVariables`; 7-3
static prompt sections; 7-4 plain prompt sections). The remaining
assembly modules under `server/fastify/src/prompt/` (`assemble`,
`lorebook`, `history`, `templates`, `tokens`, `triggers`) are
still stubs. The tiered roadmap for the rest of Phase 7 lives in
[`HANDOVER.md`](../../../HANDOVER.md) and the
[Remaining roadmap](../phases/phase-7-prompt-assembly.md#remaining-roadmap)
section of the phase doc.

## Immediate

1. **Continue Phase 7 with slice 7-5a — minimal history walk.**
   With `variables.ts`, `staticSections.ts`, and `plainSections.ts`
   real, the next leaf to land is the deterministic part of
   `buildHistoryWindow`: examples block + `[Start a new chat]`
   marker (gated by `aiModel.startsWith('novelai')` +
   `trimStartNewChat`) + first message from
   `firstMessage`/`alternateGreetings[fmIndex]` + `makeMs` filter
   (`disabled === true` / `'allBefore'`) + per-message role
   mapping. **Skip** script processing, sendName wrapper,
   thoughts extraction, multimodal, start trigger, tokenizer
   accumulation, and depthPrompts — each lands as a separate
   7-5b/c/d/e sub-slice (or in Tier 2 prerequisites; see the
   roadmap). Also port `exampleMessage` (small helper from
   `src/ts/process/exampleMessages.ts`). Target: ~150 LOC, ~12
   tests, api:test rising from 486 to ~498. The decision on the
   three deferred providers (Ooba OAI-compatible, NovelAI text,
   NovelList) remains **D — wait for the server-side flatten**;
   memos in
   [`design/ooba-oai-compat.md`](../design/ooba-oai-compat.md) and
   [`design/novelai-novellist-stringlize.md`](../design/novelai-novellist-stringlize.md)
   explain why. Keep the 38 local sendChat snapshots, the
   12-fixture server-backed sweep, and the Fastify generation
   tests green (`pnpm api:test`: 486, `pnpm test`: 601 + 4 skipped)
   while Phase 7 lands.

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

| Slice | Commit    | Summary                                                                                                                                                                                                                                                                                                                                                                                              |
| ----- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7-1   | `3d2426c4` | Scaffolded `POST /api/v1/generate/chat`: locked the 9-event SSE taxonomy in `server/fastify/src/prompt/sseEvents.ts`, stubbed seven assembly modules under `server/fastify/src/prompt/` (`assemble`, `lorebook`, `history`, `templates`, `tokens`, `variables`, `triggers`), wired auth + body validation + a `validate`→`error`→`done` SSE stream returning `phase-7 prompt assembly not yet implemented`. |
| 7-2a  | `9eed5093` | Introduced two DI seams so the parser internals stop importing Svelte directly: `src/ts/parser/chatVarBackend.ts` for `getChatVar`/`setChatVar`/`getGlobalChatVar`, and `getCurrentTriggerId` on `CBSRegisterArg` for the `{{trigger_id}}` callback. `cbs.ts` is now Svelte-free; the browser registers backends at `chatVar.svelte`'s module init. No behavior change. |
| 7-2b  | `bb2c78b5` | Lifted `risuChatParser` + helpers out of `parser.svelte.ts` into Svelte-free `src/ts/parser/risuChatParser.ts` + `risuChatParserHelpers.ts`. `parser.svelte.ts` re-exports for the 426 SPA call sites. `parserStateBackend.ts` carries the `DBState.db` / `selectedCharID` fallback for `tokenizeAccurate`. The 65-test parser oracle suite stays green. |
| 7-2c  | `7ed156e6` | Replaced the throwing `expandVariables` stub with the real server adapter. `server/fastify/src/prompt/promptScope.ts` (single-user module-level scope), `cbsAdapter.ts` (24-field `CBSRegisterArg`), `promptVariablesBoot.ts` (one-time wiring). 17-test smoke suite covers PARSER.md's "Minimum Server Slice": `{{user}}`/`{{char}}`/`{{bot}}`, `{{#when}}`, `{{#each}}`, `{{? expr}}`, `{{getvar}}`/`{{setvar}}` with `runVar` gating + dirty flag write-back surface. |
| 7-3   | `d0a2a7f3` | Ported the four small static-section assemblers from `src/ts/process/promptAssembly/`: `buildDescription` (with personality/scenario blocks + `descriptionPrefix` gated by `promptPreprocess`), `buildAuthorNote` (`chat.note` → `promptTemplate` authornote `defaultText` fallback), `buildPersona` (gated by `db.personaPrompt`), `buildCotInstruction` (gated by `chainOfThought` and `usingPromptTemplate && customChainOfThought`). All four normalize to `OpenAIChat[]` (Option B). Deferred: `buildInlayViewInstruction` (image-gen), `additionalInformations` (Phase 8 memory). 15-test suite. |
| 7-4   | `051a5dcd` | Ported `buildPlainPromptSections` into `server/fastify/src/prompt/plainSections.ts`. Returns `{main, jailbreak, globalNote}` consumed when the user is not on a structured promptTemplate. Honors `{{original}}` substitution in `currentChar.systemPrompt`/`replaceGlobalNote`, `db.jailbreakToggle` gating, and `db.additionalPrompt` gated by `promptPreprocess`. Includes the private `@@@?(user|assistant|system)\n` role-splitter that defaults untagged text to a single `system` message. 12-test suite. |

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
