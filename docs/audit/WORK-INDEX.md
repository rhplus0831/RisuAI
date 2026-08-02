# Message-generation parity work-priority index

Generated 2026-08-02 from the six-agent parity review of the Fastify
message-generation flow against the original client implementation at fork
point `71c476e9c` (evidence in [docs/](docs/README.md)). The review recorded
**57 findings** plus ~30 confirmed-intentional divergences; they consolidate
into **53 work items**: 3 in the active tiers, 2 deferred, and 48 resolved.
Work status was last updated 2026-08-02: ST-1/ST-2 are resolved as accepted
divergences, and the maintainer approved dispositions for every remaining
`Needs decision` item plus the blanket implementation policy (see the
maintenance rules) — all 3 remaining active items are `Needs design`. Tier 0 landed in `99a346377`; the
Tier 1 CBS/assembly batch in `0c5ba0ac8`; the Gemini cluster in `db638a29c`.
All items were classified on 2026-08-02 against `fbf750b24`;
findings are point-in-time evidence and must be re-verified against current
code before work begins.

Status values: `Ready` — implementable directly from the finding (the
original behavior is the specification); `Needs design` — requires a design
pass, new server infrastructure, or a client/server protocol change first;
`Needs decision` — the divergence is acknowledged somewhere (source comment,
disputed classification) or has product/security implications, so a
maintainer must decide parity-vs-keep before implementation; `Deferred` —
valid work intentionally held outside the active execution order;
`Resolved` — implemented with regression coverage.

## Maintenance rules

- Before starting an item, re-verify its finding's file:line evidence against
  current code and set the item's Status accordingly.
- When an item is completed, **move its row to the "Completed items" section**
  with Status `Resolved` and fill the Resolution column (commit hash +
  regression test).
- When an item is deferred, **move its row to the "Deferred items" section**
  with a reason and a revisit condition. Do not delete rows.
- A `Needs decision` item whose decision is "keep current behavior" also
  moves to Completed with Status `Resolved` and a resolution of
  "accepted divergence" — then pin it with a test and record it in the area
  document's intentional section.
- **Blanket implementation policy (maintainer-approved 2026-08-02):** parity
  with the baseline wins by default; where the baseline behavior is
  demonstrably accidental and the current behavior is saner, keep current,
  pin it with a regression test, and record it in the area document's
  intentional section. Escalate to the maintainer only when evidence no
  longer matches current code in a way that changes the fix, or a new
  product/security question appears.

## Priority rules

| Tier | Meaning |
| --- | --- |
| Tier 0 | Persisted-output corruption: wrong text or lost data is durably saved to the chat. Small fixes that precede all other work. |
| Tier 1 | Mainstream generation correctness: silently wrong prompt content or provider behavior in common configurations (default settings, major providers, Hypa V3 memory). |
| Tier 2 | Feature-scoped gaps: a specific supported feature (scripting family, thinking mode, TTS, proxy option) behaves differently or silently no-ops. |
| Tier 3 | Legacy/niche surfaces and disputed edge cases: local/legacy transports and rare script edge cases. |
| Tier 4 | Metadata/telemetry only: persisted metadata differs but message content and behavior match. |

## Tier 0 — Persisted-output corruption

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |
| Sequence IGP after the terminal derived text | [OR-1](docs/orchestration-postgen.md) | Needs design | The IGP suffix is computed on raw streamed text and races the server terminal patch — either the `editoutput` transform or the IGP suffix can be durably lost. | Browser-side ordering fix: IGP must consume the terminal `finalText`. Touches `orchestrateResponse.ts`/`serverBackedSendChat.ts` command sequencing. |

## Tier 1 — Mainstream generation correctness

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |

## Tier 2 — Feature-scoped gaps

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |
| Durable Lua character/local-lore writes | [ST-3](docs/scripts-triggers-lua.md) | Needs design | `setName`, `setCharacterFirstMessage`, `setBackgroundEmbedding`, `upsertLocalLoreBook` mutate only the request snapshot and are lost. | Extend the assembly mutation payload to carry character-field and local-lore changes through persistence. |
| Gemini response modalities and returned assets | [PR-5](docs/provider-adapters.md) | Needs design | Image/audio-output Gemini models lose their generated media (or fail with "no text content"). | Request `responseModalities`, disable streaming for those models, persist `inlineData` as inlay assets server-side. |

## Tier 3 — Legacy/niche surfaces and disputed edge cases

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |

## Tier 4 — Metadata/telemetry only

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |

## Completed items

Move finished rows here with Status `Resolved`; record the commit hash and
the regression test in the Resolution column. `Needs decision` items resolved
as "keep current behavior" also land here (resolution: accepted divergence +
pinning test + area-doc intentional entry).

| Work item | Findings | Status | Impact | Resolution |
| --- | --- | --- | --- | --- |
| Re-expand stable cards after the start trigger | [PA-2](docs/prompt-assembly.md) | Resolved | Start-trigger state changes never reached the final prompt. | Fixed in `b193042e0`: speculative preflight writes (snapshot + rollback), conservative cache invalidation on trigger results/history injection/scriptstate drift, and final render replaying the preflight write set exactly once or re-expanding post-trigger. Preview stays read-only. |
| Persist `@@inject` history mutations | [ST-4](docs/scripts-triggers-lua.md) | Resolved | Inject rewrites were request-local and lost. | Fixed in `b193042e0`: identity-keyed `replace_by_id` mutations through the atomic pre-dispatch assembly transaction (client patch contract mirrored additively); plain regex transforms stay prompt-local; preview does not persist. |
| Resolve OpenRouter `risu/free` | [PR-6](docs/provider-adapters.md) | Resolved | The sentinel went to OpenRouter literally → invalid-model error. | Fixed in `6e1df13b9`: dispatch-time resolution via a fixed catalog operation (15s timeout, credential-scoped 45-min TTL cache, stale-on-refresh-failure, baseline free-filter + largest-context/catalog-order selection). Metadata carries the resolved model — deliberate improvement; the baseline retained the sentinel label. |
| Strong-ban logit-bias parity | [PR-21](docs/provider-adapters.md) | Resolved | -101 banned all variant tokens; ordinary bias was clamped. | Fixed in `6e1df13b9`: baseline six-variant construction with the exact punctuation set, first non-punctuation token only; clamping removed (baseline forwarded stored values unchanged — parity wins over the documented wire range, tested). |
| Retire character additional-information retrieval | [PA-1](docs/prompt-assembly.md) | Resolved | The `additionalText` field was editable but never reached the prompt. | Retired per 2026-08-02 decision in `ec124302c`: editor replaced by a read-only unsupported notice when imported data exists (data preserved), prompt omission pinned, boundary documented. |
| Surface and pin the V2 unsupported-effect no-ops | [ST-1](docs/scripts-triggers-lua.md), [ST-2](docs/scripts-triggers-lua.md) | Resolved | Unsupported V2 effects fell through silently. | Fixed in `ec124302c`: shared unsupported-effect catalog; one SSE warning per effect type per generation from assembly and output triggers; V2 editor annotates unsupported effects; boundary documented and no-ops pinned. |
| Legacy model labels and stage timings in `generationInfo` | [OR-9](docs/orchestration-postgen.md) | Resolved | Provider-prefixed labels were lost; stage timings persisted as zero. | Fixed in `ec124302c`: baseline-format display labels persisted; stage 2 measures server-owned prefetch/memory-bridge work. Stage 4 (browser-owned) remains zero in server persistence by documented design — `updateMessage` rejects `generationInfo` and no telemetry-only mutation was added; pinned. |
| Preserve the headroom clamp in `outputTokens` metadata | [PA-5](docs/prompt-assembly.md) | Resolved | Clamped value was overwritten with `maxResponse`. | Fixed in `ec124302c`: clamp preserved through BOTH overwrite sites (the finding missed the per-attempt dispatch context); pinned test updated to the parity behavior. |
| Align the retry-count clamp with the UI | [OR-5](docs/orchestration-postgen.md) | Resolved | Server clamped to 10 while the UI allows 20. | Fixed in `ec124302c`: clamp raised to 20; 21-total-attempts regression pinned. |
| Ooba legacy stop strings, cleanup, truncation, and args | [PR-19](docs/provider-adapters.md), [PR-8](docs/provider-adapters.md) | Resolved | Missing default stops/cleanup/truncation; configured Ooba args dropped. | Fixed in `d589297af`. Evidence corrections: baseline `truncation_length` was `maxTokens ?? maxResponse` (not the output-token claim as written), and `getStopStrings(false)` is a fixed 51-entry set (user/human/input/inst/instruction case-variants, markers, `username:`) that does NOT read the active character. Non-null Ooba args overlay in baseline object-key order before additionalParams. |
| Horde cleanup uses the active character | [PR-20](docs/provider-adapters.md) | Resolved | Cleanup searched `characters[0]` instead of the active character. | Fixed in `d589297af`: effective generation character supplied by inline and durable dispatch; regression proves the active second character's turn is trimmed. |
| Sunset non-ChatML instruct templates on legacy transports | [PR-18](docs/provider-adapters.md), [PR-7](docs/provider-adapters.md) | Resolved | Non-ChatML templates were silently degraded; `useInstructPrompt` was dead but enabled. | Sunset per 2026-08-02 decision in `d589297af`: current Kobold/Ooba/Horde output pinned with accepted-divergence notes; the OpenRouter toggle is disabled with a localized unsupported note; the degraded boundary is documented in `docs/structure/providers-and-models.md`. |
| Module visibility in CBS | [HC-4](docs/history-cbs-variables.md) | Resolved | CBS saw zero modules. | Fixed in `29c7cb114`: active modules (enabled + chat + character + `moduleIntergration`, database order, id-deduplicated — the integration source was missing from the finding) wired into the adapter; `moduleenabled`/`moduleassetlist`/module-lore regressions added. |
| `sendName` group-template semantics | [HC-2](docs/history-cbs-variables.md) | Resolved | `groupTemplate`/`groupOtherBotRole` were ignored; roles kept. | Fixed in `29c7cb114`: custom template honored (full CBS expansion + first-`{{slot}}` replacement) and every wrapped row gets `groupOtherBotRole` (default `user`); the dropped schema fields restored with defaults and preset-split coverage. One pinned test updated (it selected the wrapped row by the old role). |
| Repeated mixed chat-card systemization | [PA-4](docs/prompt-assembly.md) | Resolved | Baseline shared-mutation made later chat cards see earlier systemization. | Accepted divergence per 2026-08-02 decision, pinned in `29c7cb114`: two-card mixed-role regression asserts independent clone behavior. |
| Missing prompt-asset bytes policy | [HC-8](docs/history-cbs-variables.md) | Resolved | Baseline failed generation on missing asset bytes; server silently dropped. | Accepted divergence (keep drop) per 2026-08-02 decision, hardened and pinned in `29c7cb114`: the drop now emits an SSE warning naming the asset, its reference, and whether metadata or bytes were missing. |
| Bypass input hooks for "say nothing" sends | [OR-2](docs/orchestration-postgen.md) | Resolved | Synthetic `*says nothing*` rows ran the input trigger and `editinput`. | Fixed in `954a97ab6`: validated `syntheticSayNothing` request flag set only by the exact UI sentinel path; assembly skips input trigger + editinput, later stages unchanged. |
| Speak processed text and all choices in buffered TTS | [OR-8](docs/orchestration-postgen.md) | Resolved | TTS spoke raw pre-editoutput text and only the primary choice. | Fixed in `954a97ab6`: TTS events built after post-generation from derived primary + alternates in choice order; browser inlay processing precedes speech; SSE schema unchanged (multiple side_effect frames). |
| Restore `noRetry` failure classification | [OR-4](docs/orchestration-postgen.md) | Resolved | Non-retryable failures burned the full retry/fallback budget. | Fixed in `954a97ab6`: `nonRetryable` on provider failure frames at the three baseline sites (Kobold non-OK HTTP, Horde impossible, Horde empty completion — full baseline inventory audited); route surfaces them after one attempt. |
| Request-trigger accumulation across retries | [OR-3](docs/orchestration-postgen.md) | Resolved | Baseline accumulated request-trigger rewrites on same-model retries. | Accepted divergence per 2026-08-02 decision, pinned in `954a97ab6`: each retry receives fresh singly-transformed rows; accepted-divergence comment references baseline `request.ts:222`. |
| Buffered Continue two-pass `editoutput` | [OR-6](docs/orchestration-postgen.md) | Resolved | Baseline double-fired editoutput per buffered Continue. | Accepted divergence per 2026-08-02 decision, pinned in `954a97ab6`: counting-hook regression proves exactly one invocation; comment references baseline `index.svelte.ts:1631`. |
| Small V2 condition/effect parity fixes | [ST-5](docs/scripts-triggers-lua.md), [ST-6](docs/scripts-triggers-lua.md) | Resolved | `∉` never passed; `v2ExtractRegex` was allowlisted yet no-opped. | Fixed in `3713304e4`: `∉` with the baseline invalid-JSON-passes rule; `v2ExtractRegex` with `$n`/`$&`/`$$` expansion, no low-level requirement, bounded-regex screening. |
| Lua `getPersonaDescription` | [ST-7](docs/scripts-triggers-lua.md) | Resolved | Always returned an empty string. | Fixed in `3713304e4`: returns the CBS-expanded effective persona prompt. |
| Non-interactive Lua API stubs | [ST-8](docs/scripts-triggers-lua.md) | Resolved | `loadLoreBooks`/`similarity`/`generateImage`/image getters/multimodal `LLM` returned empty or errored. | Implemented per the 2026-08-02 triage in `3713304e4`: loadLoreBooks (baseline `{data, role}[]` shape, assistant→char), similarity (embedding dot-product ranking, nil on failure/timeout), generateImage (server image engine, persisted inlay, baseline failure string; native MIME kept vs baseline PNG normalization; browser-only WebUI/Comfy providers take the failure path). Multimodal `LLM` + image getters raise explicit unsupported errors. |
| Regex-script edge parity | [ST-9](docs/scripts-triggers-lua.md), [ST-10](docs/scripts-triggers-lua.md) | Resolved | Unmatched `$1` and `NaN` order tokens diverged. | In `3713304e4`: ST-9 keeps literal `$1` pinned as the accepted divergence; ST-10 restores parity — malformed order tokens preserve stable relative order (A-before-B scenario pinned). |
| Bedrock Claude thinking | [PR-16](docs/provider-adapters.md) | Resolved | Extended thinking was silently absent on Bedrock. | Fixed in `ca5ec77ed`: budget/adaptive mapping, baseline temperature-1/top-p/top-k rules, thinking + redacted_thinking envelopes; also restored budget-thinking capability rows the resolver had lost. |
| Native Ollama thinking | [PR-17](docs/provider-adapters.md) | Resolved | `ollamaThinkingMode` was dead; `message.thinking` was dropped. | Fixed in `ca5ec77ed`: mode maps to `think`; both parsers merge thinking via the shared envelope (frame granularity differs from the cumulative baseline; assembled output matches). |
| DeepSeek `<think>` normalization | [PR-11](docs/provider-adapters.md) | Resolved | Literal `<think>` tags persisted. | Fixed in `ca5ec77ed`: buffered + streaming extraction into the thoughts envelope incl. split-tag streams; structured reasoning fields stay preferred. |
| Restore stream mode after `additionalParams` | [PR-9](docs/provider-adapters.md) | Resolved | A `stream` override in custom params desynced wire format from parser. | Fixed in `ca5ec77ed`: dispatch-selected `stream` reapplied after param merge in OpenAI/Anthropic/Mistral; Gemini strips body-level `stream` (URL-selected). Responses/Legacy-Instruct have no body stream mode. |
| Preserve exact custom URLs with query strings | [PR-10](docs/provider-adapters.md) | Resolved | Query-string URLs got the path appended inside the query. | Fixed in `ca5ec77ed`: autofill-off URLs used exactly; autofill made query-aware (accepted improvement over the baseline non-query-aware autofill). One resolver test updated (it pinned the fixed stripping). |
| Anthropic image order and cache-point placement | [PR-14](docs/provider-adapters.md) | Resolved | Multi-image order/cache boundary differed from baseline. | Accepted divergence per 2026-08-02 decision, pinned in `ca5ec77ed`: natural `[A, B, text]` order and final-part cache point asserted in `providerMessages.test.ts` with the accepted-divergence note. |
| Clip summarized history with the planner start index | [LM-2](docs/lorebook-memory.md) | Resolved | Prompts carried both a Hypa V3 summary and the full messages it summarizes. | Fixed in `a3765724c`: history handed to the memory window/provider is clipped at the stored compatible-summary boundary (deliberately NOT the planner's forward-looking `startIndex`, which can include scheduled-but-unsummarized chunks) with matching token accounting; scripts still see full history, mirroring the baseline order. Regressions in `assemble.test.ts`. |
| Supply live similar-memory query vectors | [LM-1](docs/lorebook-memory.md) | Resolved | Similarity-weighted Hypa V3 selected no memory in production. | Fixed in `a3765724c`: the route prefetches query vectors before assembly (baseline query window: enabled transcript, regenerate truncation/send append, last `queryChatCount` rows, blank filtering) via the shared embedding adapter under the memory-provider deadline; abort/timeout/failure degrade to empty vectors with prompt-memory diagnostics; work is skipped unless Hypa V3 + positive similarity allocation + compatible embedded summaries. Route-level success/failure/timeout regressions in `generation.chat.test.ts`. |
| Empty `@@exclude_keys_all` suppression | [LM-3](docs/lorebook-memory.md) | Resolved | A bare decorator activated the entry where the original suppressed it. | Fixed in `a3765724c`: empty all-key queries count as matched in both sync and async matchers. Regressions in `lorebook.test.ts`. |
| Gemini: send safety-setting overrides | [PR-1](docs/provider-adapters.md) | Resolved | Provider-default safety blocking was active; role-play content could return `SAFETY` with no text. | Fixed in `db638a29c`: baseline `BLOCK_NONE` category set with `geminiBlockOff` `OFF` variant and `noCivilIntegrity` omission. Regressions in `gemini.test.ts`. |
| Gemini: forward JSON-schema controls | [PR-2](docs/provider-adapters.md) | Resolved | JSON-schema mode was a no-op on Gemini. | Fixed in `db638a29c`: `response_mime_type`/`response_schema` emitted from effective/per-request schema with recursive `$schema`/`additionalProperties` stripping. Wire tests in `gemini.test.ts`/`chatDispatchProfileOptions.test.ts`. |
| Gemini: map Gemini 3 thinking levels and omit zero top-k | [PR-3](docs/provider-adapters.md) | Resolved | Gemini 3 requests carried `thinkingBudget` and `topK: 0`. | Fixed in `db638a29c`: fork-point budget→level thresholds (Flash 4096→MEDIUM/16384→HIGH; Pro 8192→HIGH), numeric budget dropped on Gemini 3, `topK` omitted at zero. Boundary tests included. |
| Gemini: honor reverse-proxy transport options | [PR-4](docs/provider-adapters.md) | Resolved | Custom URL/headers/params were ignored; proxied deployments failed auth/routing. | Fixed in `db638a29c`: base URL/extra headers/additional params flow through dispatch (defaults → extra headers → overrides); GoogleCloud proxy/xcustom profiles pass the server-routability gate; Gemini URLs skip OpenAI autofill. Broader than the finding: capability gate + resolver also fixed. Fetch-boundary regression added. |
| Default-variable fallback in the server chat-var backend | [HC-1](docs/history-cbs-variables.md), [LM-4](docs/lorebook-memory.md) | Resolved | `{{getvar}}` returned `"null"` where the original returned character/template defaults; prompts and triggers disagreed; sticky lorebook activation broke. | Fixed in `0c5ba0ac8`: shared `chatVarDefaults.ts` resolver (browser `parseKeyValue`, character-first precedence) now feeds prompt CBS, triggers, and both lorebook sticky readers; `addvar` starts from defaults. Regressions in `promptVariables/triggers/lorebook` suites. |
| Second CBS pass over history messages | [HC-3](docs/history-cbs-variables.md) | Resolved | One level of CBS indirection stayed literal in the provider prompt. | Fixed in `0c5ba0ac8`: whole-text CBS reparse before regex scripts at the baseline position, `runVar: false`, fixed-point short-circuit. Regressions incl. the nested `$outer -> $inner -> {{user}}` chain. |
| Greedy `<Thoughts>` stripping parity | [HC-6](docs/history-cbs-variables.md) | Resolved | Text between multiple thought blocks leaked into visible history. | Fixed in `0c5ba0ac8`: greedy first-open-to-last-close match restored for both visible removal and the recorded capture. |
| Count multimodal tokens in context budgeting | [PA-3](docs/prompt-assembly.md) | Resolved | Vision chats near the limit could dispatch over-budget requests. | Fixed in `0c5ba0ac8`: baseline `tokenizeMultiModal` charges ported (87-token low-quality, tile math otherwise, zero-dimension fallback); prefix-memo keys include multimodal dimensions/billing settings. |
| Real model metadata in CBS | [HC-5](docs/history-cbs-variables.md) | Resolved | `{{metadata::model*}}` always reported `Placeholder Model`. | Fixed in `0c5ba0ac8`: the effective resolved profile/request model feeds the CBS adapter (short name, name, internal ID, format, provider, tokenizer); stale comment removed. |
| Handle Anthropic in-stream `error` frames | [PR-13](docs/provider-adapters.md) | Resolved | An overload error after partial text persisted the fragment as a completed response. | Fixed in `99a346377`: in-stream `type: "error"` payloads (and `event: error`) become provider failure frames preserving message/code; pre-token errors retry through the existing policy, post-token errors restore with no persistence; proxy-compatible `delta.type: "text"` accepted. Regressions in `anthropic.test.ts` and `generation.chat.test.ts`. |
| Stop treating Continue-displaced rows as reroll candidates | [OR-7](docs/orchestration-postgen.md) | Resolved | After continue → reload → regenerate, swiping back could restore the pre-continue text. | Fixed in `99a346377`: continue mode never preserves reroll candidates — the buffer is cleared and the displaced pre-continue row is excluded; a later regenerate captures the fully extended row. Regression: continue → hydrate → regenerate in `generation.chat.test.ts`. |
| Detect cumulative stream fragments | [PR-12](docs/provider-adapters.md) | Resolved | Cumulative proxy deltas produced duplicated streamed/persisted text. | Fixed in `99a346377`: a strictly-longer delta that starts with the full accumulation is treated as cumulative and only the new suffix is emitted (strict `>` keeps legitimately repeated equal-length tokens intact — saner-than-baseline edge kept per blanket policy). Regression in `openai.test.ts`. |
| Implement V2 persistent data effects | [ST-1](docs/scripts-triggers-lua.md) | Resolved | Character/persona/author-note getters+setters and lorebook effects silently no-op; getter-dependent triggers send `null` into prompts. | Accepted divergence (maintainer decision, 2026-08-02): support cost is disproportionate to current ecosystem usage — bot authors have moved to Lua, the committed server scripting surface. Recorded in the area document's intentional section; the user-facing notice and pinning regression are tracked as the Tier 2 item "Surface and pin the V2 unsupported-effect no-ops". |
| Implement or reject V2 command/privileged effects | [ST-2](docs/scripts-triggers-lua.md) | Resolved | `command`, auxiliary-LLM, similarity, image-generation, and alert effects silently no-op. | Accepted divergence (same 2026-08-02 decision): the arms stay no-op. The baseline never gated `command`/`v2Command` behind `lowLevelAccess`, so declining the port also declines re-introducing ungated command execution. Same follow-up item covers the notice and pinning coverage. |

## Deferred items

Valid work intentionally outside the active execution order. Revisit only on
explicit reprioritization; re-verify evidence against then-current code first.

| Work item | Findings | Status | Impact | Deferral reason / revisit condition |
| --- | --- | --- | --- | --- |
| Browser-context CBS (`{{screenwidth}}`, browser language, user-local time) | [HC-7](docs/history-cbs-variables.md) | Deferred | Server-side CBS resolves times in server locale and leaves viewport/browser-language directives literal. | Needs a client-context propagation protocol for marginal prompt value. Revisit if users report timezone-sensitive cards breaking, or bundle with the next client/server frame-contract change. |
| Anthropic `output-128k` beta header | [PR-15](docs/provider-adapters.md) | Deferred | `max_tokens > 8192` requests no longer carry the beta header the baseline sent. | The beta's 2026 applicability is unverified; check the current Anthropic API first — the fix may be to delete the finding, not add the header. |

## Suggested execution order

Tier position ranks user impact; execution order additionally weighs cost,
risk, and shared code.

1. **Tier 0 first.** Three of four are small, and all four stop durable
   corruption of persisted chat text. The IGP resequencing is the only one
   needing design; do not let it block the other three.
2. **Tier 1 `Ready` batch.** The chat-var default fallback (HC-1) is the
   single highest-leverage small fix — one backend touches prompts, lorebook
   stickiness, and `addvar` math. The four Gemini `Ready` items share one
   adapter and should land as one pass with one test sweep. LM-2
   (history clipping) follows; then HC-3/HC-6/PA-3/HC-5.
3. **Tier 1 design items** (LM-1 query vectors, PA-2 stable-card
   re-expansion) start their design while the `Ready` batch lands.
4. **Tier 2 by subsystem, not by row order:** the provider batch
   (PR-16/17/11/14/9/10) shares adapter test scaffolding; the scripting batch
   (ST-5/6/7, then ST-3/ST-4 design) shares the trigger/Lua harness; the
   orchestration batch (OR-2/8/4) is independent. All decision clusters
   were settled by the 2026-08-02 maintainer approval; per-row decision
   notes record each disposition.
5. **Tier 3** rides spare capacity; the instruct-template engine decision
   (support vs sunset legacy transports) should be made before any effort is
   spent on PR-18.
6. **Tier 4 last**, or opportunistically alongside touched files.

## Relationship to prior documents

The evidence base is [docs/](docs/README.md) (six area documents with stable
finding IDs, verification state, and per-area intentional-divergence
records). The previous `docs/audit/` workstream (data-loss remediation,
closed 2026-07-23) is archived under `.archived-docs/`; this index is a new,
independent workstream and shares no tier scale with it. Confirmed
intentional divergences carry no work items here — they are recorded only in
the area documents, and re-audits should not re-report them.
