# Next Steps

Date: 2026-05-23

Use this list to pick the next chunk of work. Phase 5 closed on
2026-05-22 with all 28 extraction slices landed; the historical
slice record now lives in
[`sendchat-slicing.md`](sendchat-slicing.md). The `/completion`
part of Phase 6 closed on 2026-05-22 with 27 slices landed; see
the "Closeout" section in
[`../phases/phase-6-server-generation.md`](../phases/phase-6-server-generation.md)
for what landed, what was deferred to Phase 7, and what's
deferred until a fixture demands it. Phase 7 (prompt assembly)
is in progress as of 2026-05-23 — nine slices landed (7-1
scaffold; 7-2a/b/c canonical `risuChatParser` extracted
Svelte-free + wired into the server via `expandVariables`; 7-3
static prompt sections; 7-4 plain prompt sections; 7-5a minimal
history walk; 7-6a minimal regex script processor; 7-5b
per-message scripts + sendName + `<Thoughts>`). The remaining
assembly modules under `server/fastify/src/prompt/` (`assemble`,
`lorebook`, `templates`, `tokens`, `triggers`) are still stubs;
`history.ts` now covers the deterministic walk, per-message
scripts, the sendName wrapper, and `<Thoughts>` extraction
(remaining skip list in 7-5b), and `scripts.ts` is the regex-only
processor (skip list in 7-6a). The tiered roadmap for the rest of
Phase 7 lives in the
[Remaining roadmap](../phases/phase-7-prompt-assembly.md#remaining-roadmap)
section of the phase doc; [`HANDOVER.md`](../../../HANDOVER.md) is
the short pickup runbook.

## Immediate

1. **Continue Phase 7 with slice 7-6b — scripts special action
   prefixes.** `scripts.ts` currently only honors the plain regex
   branch. Port the four deterministic special-action prefixes
   that the SPA's `executeScript` recognizes
   (`src/ts/process/scripts.ts:218-325`):
   - `@@move_top` / `@@move_bottom` — extract matched text via
     `data.matchAll(reg)`, rewrite with the SPA's `$1` / `$&` /
     `$<n>` substitution helper, then re-prepend or append the
     extracted text to `data`.
   - `@@inject` — mutate the message at `chatID` in place
     (`currentChat.message[chatID].data = data`) and strip the
     matched text from `data`. Accepts an optional `chatID` like
     the SPA.
   - `@@repeat_back` — read the previous same-role message body,
     copy its first match to the current `data` (positions: bare,
     `end`, `start`, `end_nl`, `start_nl`).

   `@@emo` stays as a no-op on the server (browser-only
   emotion-image side effect; document the skip).

   Skip-list (defer to 7-6c/d/e): `ableFlag` `<order, actions>`
   DSL parsing, script-cache, module regex scripts,
   `runTrigger('display', …)` for `editdisplay` mode.

   Other Tier 1 candidates remain available: **7-5c** (multimodal
   inlays + `{{asset_prompt::}}`; the assets path benefits from a
   clearer request-body inlay payload interface that Tier 3 will
   shape — reasonable to wait) and **7-7a** (constant lorebook;
   the SPA orchestrator still doesn't slice cleanly without
   porting the decorator system first — revisit). The decision on
   the three deferred providers (Ooba OAI-compatible, NovelAI
   text, NovelList) remains **D — wait for the server-side
   flatten**; memos in
   [`design/ooba-oai-compat.md`](../design/ooba-oai-compat.md) and
   [`design/novelai-novellist-stringlize.md`](../design/novelai-novellist-stringlize.md)
   explain why. Keep the 38 local sendChat snapshots, the
   12-fixture server-backed sweep, and the Fastify generation
   tests green. Last recorded baselines are `pnpm api:test`: 529
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

| Slice | Commit     | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| 7-1   | `3d2426c4` | Scaffolded `POST /api/v1/generate/chat`: locked the 9-event SSE taxonomy in `server/fastify/src/prompt/sseEvents.ts`, stubbed seven assembly modules under `server/fastify/src/prompt/` (`assemble`, `lorebook`, `history`, `templates`, `tokens`, `variables`, `triggers`), wired auth + body validation + a `validate`→`error`→`done` SSE stream returning `phase-7 prompt assembly not yet implemented`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7-2a  | `9eed5093` | Introduced two DI seams so the parser internals stop importing Svelte directly: `src/ts/parser/chatVarBackend.ts` for `getChatVar`/`setChatVar`/`getGlobalChatVar`, and `getCurrentTriggerId` on `CBSRegisterArg` for the `{{trigger_id}}` callback. `cbs.ts` is now Svelte-free; the browser registers backends at `chatVar.svelte`'s module init. No behavior change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7-2b  | `bb2c78b5` | Lifted `risuChatParser` + helpers out of `parser.svelte.ts` into Svelte-free `src/ts/parser/risuChatParser.ts` + `risuChatParserHelpers.ts`. `parser.svelte.ts` re-exports for the 426 SPA call sites. `parserStateBackend.ts` carries the `DBState.db` / `selectedCharID` fallback for `tokenizeAccurate`. The 65-test parser oracle suite stays green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 7-2c  | `7ed156e6` | Replaced the throwing `expandVariables` stub with the real server adapter. `server/fastify/src/prompt/promptScope.ts` (single-user module-level scope), `cbsAdapter.ts` (24-field `CBSRegisterArg`), `promptVariablesBoot.ts` (one-time wiring). 17-test smoke suite covers the minimum parser surface: `{{user}}`/`{{char}}`/`{{bot}}`, `{{#when}}`, `{{#each}}`, `{{? expr}}`, `{{getvar}}`/`{{setvar}}` with `runVar` gating + dirty flag write-back surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 7-3   | `d0a2a7f3` | Ported the four small static-section assemblers from `src/ts/process/promptAssembly/`: `buildDescription` (with personality/scenario blocks + `descriptionPrefix` gated by `promptPreprocess`), `buildAuthorNote` (`chat.note` → `promptTemplate` authornote `defaultText` fallback), `buildPersona` (gated by `db.personaPrompt`), `buildCotInstruction` (gated by `chainOfThought` and `usingPromptTemplate && customChainOfThought`). All four normalize to `OpenAIChat[]` (Option B). Deferred: `buildInlayViewInstruction` (image-gen), `additionalInformations` (Phase 8 memory). 15-test suite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7-4   | `051a5dcd` | Ported `buildPlainPromptSections` into `server/fastify/src/prompt/plainSections.ts`. Returns `{main, jailbreak, globalNote}` consumed when the user is not on a structured promptTemplate. Honors `{{original}}` substitution in `currentChar.systemPrompt`/`replaceGlobalNote`, `db.jailbreakToggle` gating, and `db.additionalPrompt` gated by `promptPreprocess`. Includes the private `@@@?(user                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | assistant | system)\n`role-splitter that defaults untagged text to a single`system` message. 12-test suite. |
| 7-5a  | `c44e53fc` | Replaced the `history.ts` stub with the deterministic part of `buildHistoryWindow` + `exampleMessage` from `src/ts/process/`. Returns `{ messages: OpenAIChat[] }` (sync, no triggers/tokenizer). Covers examples block, `[Start a new chat]` marker gating (novelai prefix, `promptSettings.trimStartNewChat`), first-message selection (`fmIndex === -1 ? firstMessage : alternateGreetings[fmIndex]`), `makeMs` filter (`disabled === true` / `'allBefore'`), and `msg.role === 'user' ? 'user' : 'assistant'` mapping. All text flows through `expandVariables`. Defers scripts, `sendName`, `<Thoughts>`, multimodal, `{{asset_prompt::}}`, start trigger, tokenizer accumulation, and depthPrompts to 7-5b/c/d/e. 16-test suite (api:test 486 → 502).                                                                                                                                                                                                                                                                                                                                                                 |
| 7-6a  | `9a60380d` | Added `server/fastify/src/prompt/scripts.ts` with a sync `processScript(ctx, char, data, mode, cbsConditions?)`. Walks `db.presetRegex ?? []` then `char.customscript ?? []`, runs entries where `script.type === mode` as a plain `RegExp.replace`, then routes the result through `expandVariables` (matches the SPA's `risuChatParser(data.replace(reg, outScript), {chatID, cbsConditions})` pass at `scripts.ts:285,328`). Flag handling sanitizes to `[dgimsuvy]`, dedupes, defaults to `'u'` when empty; scripts with empty `in` are skipped; per-script errors are swallowed (mirrors `scripts.ts:372-376`). Defers special action prefixes (`@@emo`, `@@move_top`, `@@move_bottom`, `@@inject`, `@@repeat_back`), the `ableFlag` `<order, actions>` DSL, script-cache, `runLuaEditTrigger`, `runTrigger('display', …)`, `pluginV2` hooks, and module regex scripts to 7-6b/c/d/e. 14-test suite (api:test 502 → 516). Unblocks 7-5b.                                                                                                                                                                               |
| 7-5b  | `7ad226b9` | Per-message scripts + sendName wrapper + `<Thoughts>` extraction on the history walk. Each history message body now flows through `expandVariables` (chara + role) then `processScript('editprocess', {chatRole})`; first message body also runs through `processScript`. Optional `usingPromptTemplate` arg (defaults `false`) gates the sendName wrappers — first message gets `${currentChar.name}: ` + `attr: ['nameAdded']`, per-message gets `<{{char}}'s Message>\n{slot}\n</{{char}}'s Message>` resolved against the active currentChar (the SPA's `chara: msg.saying` override at `formatHistoryMessage.ts:140` is shadowed by `cbs.ts:184` reading currentChar from scope first; documented inline). `<Thoughts>` always stripped from content, captured to `chat.thoughts` when `maxThoughtTagDepth === -1 \|\| maxThoughtTagDepth - totalCount <= index`. `memo` defaults to `msg.chatId`; missing chatIds get backfilled with `randomUUID()`. 13 new tests (api:test 516 → 529). Defers multimodal inlays + `{{asset_prompt::}}` (7-5c), start trigger (7-5d), tokenizer accumulation + depth prompts (7-5e). |

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
