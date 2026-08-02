# Message-generation parity work-priority index

Generated 2026-08-02 from the six-agent parity review of the Fastify
message-generation flow against the original client implementation at fork
point `71c476e9c` (evidence in [docs/](docs/README.md)). The review recorded
**57 findings** plus ~30 confirmed-intentional divergences; they consolidate
into **53 work items**: 49 in the active tiers, 2 deferred, and 2 resolved.
Work status was last updated 2026-08-02: ST-1/ST-2 are resolved as accepted
divergences, and the maintainer approved dispositions for every remaining
`Needs decision` item plus the blanket implementation policy (see the
maintenance rules) — active items are now `Ready` (41) or `Needs design` (8)
only, cleared for autonomous execution.
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
| Handle Anthropic in-stream `error` frames | [PR-13](docs/provider-adapters.md) | Ready | An overload error after partial text persists the fragment as a completed response instead of failing/retrying. | Add the `error`-event branch and the proxy-compatible `delta.type: "text"` acceptance; wire into the existing pre-token retry policy. |
| Sequence IGP after the terminal derived text | [OR-1](docs/orchestration-postgen.md) | Needs design | The IGP suffix is computed on raw streamed text and races the server terminal patch — either the `editoutput` transform or the IGP suffix can be durably lost. | Browser-side ordering fix: IGP must consume the terminal `finalText`. Touches `orchestrateResponse.ts`/`serverBackedSendChat.ts` command sequencing. |
| Stop treating Continue-displaced rows as reroll candidates | [OR-7](docs/orchestration-postgen.md) | Ready | After continue → reload → regenerate, swiping back can restore the pre-continue text, losing the continuation. | `messageStore.ts` already documents send/continue as the reroll boundary; enforce it for the displaced-row path. |
| Detect cumulative stream fragments | [PR-12](docs/provider-adapters.md) | Ready | Proxies that emit cumulative deltas produce duplicated streamed and persisted text (`HelHello`). | Port the original replace-if-prefix accumulation check. |

## Tier 1 — Mainstream generation correctness

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |
| Default-variable fallback in the server chat-var backend | [HC-1](docs/history-cbs-variables.md), [LM-4](docs/lorebook-memory.md) | Ready | `{{getvar}}` in any prompt surface returns `"null"` where the original returned character/template defaults; prompts and triggers currently disagree about the same variable; also breaks sticky lorebook activation. | One shared fix in `promptScope.ts`/`variables.ts` mirroring `chatVar.svelte.ts`; align with the trigger engine's existing default handling. |
| Clip summarized history with the planner start index | [LM-2](docs/lorebook-memory.md) | Ready | Prompts carry both a Hypa V3 summary and the full messages it summarizes — duplicated context and wasted budget. | Apply `plan.startIndex` to `historyMessages` in assembly; verify interaction with generic non-memory trimming and the memory window token math. |
| Supply live similar-memory query vectors | [LM-1](docs/lorebook-memory.md) | Needs design | Similarity-weighted Hypa V3 configurations silently inject no memory in production. | Requires embedding recent chat text at generation time (cost/latency policy, embedding-provider resolution, failure handling); ranking service and tests already accept vectors. |
| Gemini: send safety-setting overrides | [PR-1](docs/provider-adapters.md) | Ready | Provider-default safety blocking is active; role-play content can return `SAFETY` with no text. | Port the category list including the `geminiBlockOff` `OFF` variant. |
| Gemini: forward JSON-schema controls | [PR-2](docs/provider-adapters.md) | Ready | JSON-schema mode is a no-op on Gemini; extraction receives prose. | Emit `response_mime_type`/`response_schema` from the retained `jsonSchemaEnabled`/`jsonSchema` config. |
| Gemini: map Gemini 3 thinking levels and omit zero top-k | [PR-3](docs/provider-adapters.md) | Ready | Gemini 3 requests carry `thinkingBudget` (rejected/ignored) and `topK: 0`. | Port the Flash/Pro `thinkingLevel` mapping and the zero-top-k omission. |
| Gemini: honor reverse-proxy transport options | [PR-4](docs/provider-adapters.md) | Ready | Custom URL, extra headers, and additional params are ignored; proxied deployments fail auth/routing. | Pass `providerOptions.baseUrl`/`extraHeaders`/`additionalParams` through dispatch into the existing `resolveGeminiRequest()` support. |
| Second CBS pass over history messages | [HC-3](docs/history-cbs-variables.md) | Ready | One level of CBS indirection (variable containing `{{user}}` etc.) stays literal in the provider prompt. | Mirror the original `processScriptFull` re-parse in `processScriptAsync`; watch for double-execution of state-changing CBS (original semantics are the spec). |
| Greedy `<Thoughts>` stripping parity | [HC-6](docs/history-cbs-variables.md) | Ready | Text between multiple thought blocks leaks into visible history where the original stripped it. | One-regex change plus thought-record expectations. |
| Re-expand stable cards after the start trigger | [PA-2](docs/prompt-assembly.md) | Needs design | Start-trigger state changes never reach the final prompt (cached pre-trigger expansions are reused). | Invalidate/re-render the stable-card cache when the start trigger mutates state; weigh against the caching design that motivated preflight expansion. |
| Count multimodal tokens in context budgeting | [PA-3](docs/prompt-assembly.md) | Ready | Vision chats near the limit can dispatch over-budget requests. | Port `tokenizeMultiModal` charges into `tokens.ts`/`budgetFinalize.ts`. |
| Real model metadata in CBS | [HC-5](docs/history-cbs-variables.md) | Ready | `{{metadata::model*}}` always reports `Placeholder Model`. | Inject the effective model info into the CBS adapter; the adapter comment claiming the path is unused is wrong. |

## Tier 2 — Feature-scoped gaps

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |
| Retire character additional-information retrieval | [PA-1](docs/prompt-assembly.md) | Ready | The `additionalText` field is editable in the UI but never reaches the prompt; the original similarity-searched and appended up to three blocks. | Decision 2026-08-02: remove, not port. Hide the UI field, add an unsupported notice (strings via `src/lang`), document, and record as an accepted divergence with pinning coverage. |
| Surface and pin the V2 unsupported-effect no-ops | [ST-1](docs/scripts-triggers-lua.md), [ST-2](docs/scripts-triggers-lua.md) | Ready | Decision 2026-08-02: the effects stay no-op (see Completed items). Users currently get a silent fall-through — a card's trigger appears to run but doesn't, and getter-dependent triggers inject the literal string `null`. | Add a user-facing unsupported notice (trigger editor and/or runtime trigger diagnostic; new strings go in `src/lang`), record the boundary in `docs/structure/`, and pin the no-op arms with a regression test so the fall-through becomes a documented contract. |
| Durable Lua character/local-lore writes | [ST-3](docs/scripts-triggers-lua.md) | Needs design | `setName`, `setCharacterFirstMessage`, `setBackgroundEmbedding`, `upsertLocalLoreBook` mutate only the request snapshot and are lost. | Extend the assembly mutation payload to carry character-field and local-lore changes through persistence. |
| Small V2 condition/effect parity fixes | [ST-5](docs/scripts-triggers-lua.md), [ST-6](docs/scripts-triggers-lua.md) | Ready | `∉` never passes; `v2ExtractRegex` is allowlisted yet no-ops (variables become `null`). | Two bounded dispatcher additions with original semantics as spec. |
| Lua `getPersonaDescription` | [ST-7](docs/scripts-triggers-lua.md) | Ready | Always returns `''`; persona-dependent scripts break. | Expand the active persona prompt against the current character, as the original did. |
| Non-interactive Lua API stubs | [ST-8](docs/scripts-triggers-lua.md) | Ready | `loadLoreBooks`, `similarity`, `generateImage`, image getters, multimodal `LLM` return empty/errors. | Decision 2026-08-02: implement `loadLoreBooks` (server lorebook engine), `similarity` (existing embedding contract), and `generateImage` (via `imageGeneration.ts`); multimodal `LLM` and the image getters reject loudly as unsupported instead of returning empty. |
| Persist `@@inject` history mutations | [ST-4](docs/scripts-triggers-lua.md) | Needs design | The original durably rewrote the stored message; Fastify's rewrite is request-local. | Route the inject write through an assembly message mutation (`submitTranscriptChanged`); mind the lorebook identity-dirty and transcript-persistence rules. |
| Module visibility in CBS | [HC-4](docs/history-cbs-variables.md) | Ready | `{{moduleenabled}}`/`{{moduleassetlist}}`/module lore in `{{lorebook}}` see zero modules despite server assembly knowing the active set. | Decision 2026-08-02: parity — wire the existing active-module helpers into the CBS adapter. |
| `sendName` group-template semantics | [HC-2](docs/history-cbs-variables.md) | Ready | Custom `groupTemplate` and `groupOtherBotRole` role rewriting are ignored; assistant rows keep their role. | Decision 2026-08-02: parity — honor `groupTemplate` and `groupOtherBotRole` (presets can depend on the wrapper and role behavior), then pin. |
| Bypass input hooks for "say nothing" sends | [OR-2](docs/orchestration-postgen.md) | Ready | Synthetic `*says nothing*` rows now run the input trigger and `editinput`, mutating state the original left untouched. | Flag the synthetic send so assembly skips both stages. |
| Speak processed text and all choices in buffered TTS | [OR-8](docs/orchestration-postgen.md) | Ready | TTS speaks raw pre-`editoutput` text and only the primary multi-gen choice. | Build the TTS side effect from derived final text after post-generation; iterate choices. |
| Restore `noRetry` failure classification | [OR-4](docs/orchestration-postgen.md) | Ready | Auth errors and impossible Horde jobs burn the full retry budget and may cascade into fallbacks. | Add a non-retryable marker to provider failure frames; set it where the original did (Kobold HTTP, Horde impossible/empty). |
| Bedrock Claude thinking | [PR-16](docs/provider-adapters.md) | Ready | Extended thinking is silently absent on Bedrock; thinking blocks are discarded. | Port thinking request fields (incl. forced temperature/top-p/top-k rules) and `thinking`/`redacted_thinking` parsing. |
| Native Ollama thinking | [PR-17](docs/provider-adapters.md) | Ready | `ollamaThinkingMode` is a dead option; `message.thinking` is dropped. | Pass `think` and merge thinking into the shared envelope in both parsers. |
| DeepSeek `<think>` normalization | [PR-11](docs/provider-adapters.md) | Ready | Literal `<think>` tags persist instead of the `<Thoughts>` envelope. | Port the `deepSeekThinkingOutput` extraction for buffered and streaming paths. |
| Anthropic image order and cache-point placement | [PR-14](docs/provider-adapters.md) | Ready | Multi-image rows arrive in the opposite order vs the original and the cache boundary moved. | Decision 2026-08-02 (blanket policy): the baseline's reversed order was accidental — keep the current natural order and cache placement, pin with a regression, and record as an accepted divergence. |
| Restore stream mode after `additionalParams` | [PR-9](docs/provider-adapters.md) | Ready | A `stream` override in custom params desyncs wire format from parser → hard failure. | Reapply the dispatch-selected `stream` after merging custom params. |
| Preserve exact custom URLs with query strings | [PR-10](docs/provider-adapters.md) | Ready | Autofill-disabled URLs with query strings get the path appended inside the query. | Parse-aware endpoint construction. |
| Resolve OpenRouter `risu/free` | [PR-6](docs/provider-adapters.md) | Needs design | "Free Auto" sends a literal `risu/free` model ID → invalid-model error. | Needs a server-side OpenRouter catalog fetch (cache/TTL/failure policy) mirroring `model/openrouter.ts`. |
| Gemini response modalities and returned assets | [PR-5](docs/provider-adapters.md) | Needs design | Image/audio-output Gemini models lose their generated media (or fail with "no text content"). | Request `responseModalities`, disable streaming for those models, persist `inlineData` as inlay assets server-side. |
| Strong-ban logit-bias parity | [PR-21](docs/provider-adapters.md) | Needs design | `-101` bans component tokens of variants (over-suppression); ordinary bias values are clamped where the original passed them through. | Port the original punctuation-variant first-token algorithm; decide whether the clamp is a deliberate guard. |

## Tier 3 — Legacy/niche surfaces and disputed edge cases

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |
| Sunset non-ChatML instruct templates on legacy transports | [PR-18](docs/provider-adapters.md), [PR-7](docs/provider-adapters.md) | Ready | Kobold/Ooba-legacy/Horde send `##` headings or `role:` labels instead of Llama/Gemma/Mistral/Vicuna/Alpaca/custom-Jinja control tokens; OpenRouter `useInstructPrompt` is dead. | Decision 2026-08-02: sunset, not port. Document legacy transports as degraded (ChatML only), surface the limitation to users (disable or annotate the dead `useInstructPrompt` toggle), pin current output, and record as an accepted divergence. |
| Ooba legacy stop strings, cleanup, truncation, and args | [PR-19](docs/provider-adapters.md), [PR-8](docs/provider-adapters.md) | Ready | Missing default `stopping_strings`, no `unstringlizeChat`, `truncation_length` = maxContext, and configured Ooba args silently dropped — simulated extra turns get persisted. | Bounded adapter fixes; the Ooba settings page is still live so configured args must reach the body. |
| Horde cleanup uses the active character | [PR-20](docs/provider-adapters.md) | Ready | Response trimming searches the wrong character name and persists simulated turns. | Use the effective character passed through dispatch, not `characters[0]`. |
| Regex-script edge parity | [ST-9](docs/scripts-triggers-lua.md), [ST-10](docs/scripts-triggers-lua.md) | Ready | Unmatched `$1` in move directives and `NaN` `order` tokens change output/order vs baseline. | Decision 2026-08-02 (blanket policy): ST-9 keeps the saner literal `$1` (pin + record as accepted divergence); ST-10 restores parity — malformed `order` tokens must not reorder scripts. |
| Empty `@@exclude_keys_all` suppression | [LM-3](docs/lorebook-memory.md) | Ready | A bare decorator activates the entry where the original suppressed it. | One-line initialization parity in the all-key matcher. |
| Repeated mixed chat-card systemization | [PA-4](docs/prompt-assembly.md) | Ready | Two chat cards over one range with mixed systemization produce different roles vs the baseline's shared-mutation behavior. | Decision 2026-08-02: keep the current clone behavior (baseline shared-mutation was accidental); pin with a regression and record as an accepted divergence. |
| Missing prompt-asset bytes policy | [HC-8](docs/history-cbs-variables.md) | Ready | Stale asset references silently drop the image where the original failed generation. | Decision 2026-08-02: keep silent-drop (better UX than failing generation), add a diagnostic warning so the drop is observable, pin, and record as an accepted divergence. |
| Request-trigger accumulation across retries | [OR-3](docs/orchestration-postgen.md) | Ready | Same-model retries re-apply the request trigger to fresh rows instead of accumulating. | Decision 2026-08-02: keep the current per-retry reset (baseline accumulation was accidental); pin the row-reset explicitly and record as an accepted divergence. |
| Buffered Continue two-pass `editoutput` | [OR-6](docs/orchestration-postgen.md) | Ready | Stateful edit hooks fire once per buffered Continue instead of twice. | Decision 2026-08-02: keep single-pass (baseline double-fire was accidental); pin with a regression and record as an accepted divergence. |

## Tier 4 — Metadata/telemetry only

| Work item | Findings | Status | Impact | Risk / dependencies |
| --- | --- | --- | --- | --- |
| Legacy model labels and stage timings in `generationInfo` | [OR-9](docs/orchestration-postgen.md) | Ready | Exported metadata loses provider-prefixed model labels; `stageTiming.stage2/stage4` persist as zero. | Either persist the legacy display label and post-stage-4 timings, or document the new shape. |
| Preserve the headroom clamp in `outputTokens` metadata | [PA-5](docs/prompt-assembly.md) | Ready | Persisted `outputTokens` reports `maxResponse` instead of the assembly-clamped value. | Keep the clamped value through provider-profile selection. |
| Align the retry-count clamp with the UI | [OR-5](docs/orchestration-postgen.md) | Ready | UI accepts 20 retries; the server clamps to 10 silently. | Decision 2026-08-02: parity — raise the server clamp to the UI's 20. |

## Completed items

Move finished rows here with Status `Resolved`; record the commit hash and
the regression test in the Resolution column. `Needs decision` items resolved
as "keep current behavior" also land here (resolution: accepted divergence +
pinning test + area-doc intentional entry).

| Work item | Findings | Status | Impact | Resolution |
| --- | --- | --- | --- | --- |
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
