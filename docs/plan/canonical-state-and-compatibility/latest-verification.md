# Canonical State And Compatibility Retirement Latest Verification

Date: 2026-08-31

## Candidate

- Implementation commits: `c85b523c8`, `28d0bbd0a`, `bfa1b048e`,
  `29775b825`, `c0b8776b3`, `0b134b24d`, `f986cf1ff`, `c7ab6beaf`,
  `07576969c`, `d8275c5e9`, `3cff93cd6`, `fd0764744`, `c24cdd16d`,
  `e663269de`, `f610c11a1`, `6006b08cb`, `c389535d3`, `cc3a469cf`,
  `1853a3fd3`, `841d0b65e`, and `6020f6009`; character/chat dependency release
  `7cb62afa8`
- Migration predecessor: `47146eb759a8369ad407e872ce5897604a2ae7f4`
- Phase 1 predecessor: `1e758cd22`
- Opening anchor: `c0df82d5240a29a33efa5995e08cc970e0147573`
- Workstream 1 convention release: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 2 normal-consumer checkpoint for selected model-preset
  composition, browser prompt shape, durable-profile tokenizer/output budgeting
  and image capability, canonical custom-sidebar model authoring, Fastify
  server-intent completion projection, browser request sampling,
  provider-specific thinking overrides, and effective prompt/generation model
  identity, translation cache/source-language identity, settings metadata,
  HypaV3 budgeting, and display-source model context, closing the ordinary
  flat model/runtime access gate and releasing the model-owner cursor.

## Consumer-Cutover Proof

- Legacy model/provider and role-specific preset selections reset durable role
  bindings only on the effective clone used by generation, memory, and browser
  prompt assembly. Persisted top-level bindings and inline credentials are not
  copied or mutated.
- Canonical preset owner-field presence disables compatibility even when stale
  flat fields coexist; parameter-only and empty rows do not activate it.
- The compatibility baseline records the named
  `applyLegacyModelPresetCompatibilitySelection` seam. It is explicitly held
  until Phase 5 can repair inline credential ownership without copying secrets.
- Durable profile runtime tokenizer selection remains highest precedence;
  profile-local custom-API provider configuration now precedes global runtime
  defaults, preventing schema-v34 defaults from masking selected profiles.
- Browser history formatting, image capability, continue markers, system
  coalescing, chat-token overhead, maximum context, tokenizer family,
  credentials, and cache identity now derive from one resolved `chatMain`
  profile even when flat fields conflict.
- Fastify and browser budgeting share the tokenizer-selection precedence helper;
  the duplicate Fastify record-type dependency is gone.
- Local prompt assembly uses the selected profile's response-token budget for
  both initial reservation and final request fitting even when flat
  `maxResponse` conflicts.
- The custom sidebar routes its model control to the canonical global
  model-preset picker and contains no server-backed flat `aiModel` draft.
- OpenAI inlay request shaping and multimodal token accounting use the selected
  profile's model capability flags. The aggregate `aiModel` lookup remains only
  as an explicit fallback for callers without a model context.
- Fastify server-intent completion applies the shared durable runtime projection
  before its explicit stream, max-token, temperature, and character-name
  overrides. Conflicting flat top-p and penalty fields no longer reach dispatch.
- Ordinary OpenAI, Anthropic, Gemini, Mistral, Cohere, Ooba, and plugin request
  parameter builders receive the resolved profile runtime options. Those values
  outrank conflicting flat samplers, while explicit separate-parameter settings
  retain their compatibility precedence.
- Anthropic adaptive thinking, DeepSeek thinking/tool-round reasoning, and the
  legacy plugin fallback source their post-parameter values from the resolved
  runtime profile. Flat behavior remains only for callers with no model context.
- Browser and Fastify CBS hosts inject role-aware model contexts, so main/aux
  model variables, request-model metadata, prefill support, and context limits
  cannot observe stale flat selections.
- V3 plugin chat-send loop protection checks the resolved `chatMain` model, and
  default generation labels use resolved selected/wire/provider options while
  explicit provider-reported and legacy formatting stays compatible.
- LLM translation cache identity no longer includes stale flat `aiModel`; the
  resolved translate profile remains authoritative. Non-LLM cache identity and
  NovelList source-language selection share one effective translate-role
  provider check, with legacy `subModel` fallback retained.
- Seed-control visibility uses resolved model metadata rather than the flat
  aggregate selection.
- Both HypaV3 implementations reserve the resolved `chatMain` response budget;
  explicit legacy selections retain the flat fallback.
- The Hypa settings capacity ratio and its reactive dependency key use the
  resolved `chatMain` context/response budgets even when flat fields conflict.
- Lorebook activation no longer accepts or threads an unused model mirror.
- Display-source Lua and trigger stages receive one resolved `chatMain` model
  through an existing Fastify prompt-model boundary.

## Commands And Results

- Focused preset composition, generation chat, memory summarization, split
  presets, model resolver, tokenizer, send-context, tokenizer-config, and
  server-preview files passed 25, 181, 19, 13, 50, 5, 23, 58, and 38 tests.
- Prompt build-history, history-format, final-render, assembly, and ownership
  files passed 11, 16, 24, 2, and 2 tests; the model-runtime ownership file
  passed 2.
- Conflicting prompt response-budget fixtures passed 2 assembly and 2 ownership
  tests, the generation fixture owner passed 39, and the sidebar owner passed 2.
- Inlay behavior, OpenAI profile request shaping, tokenizer, and prompt-model
  ownership files passed 36, 16, 5, and 3 tests.
- The server-intent completion owner passed all 96 tests with conflicting
  profile/flat sampling values.
- Browser request role routing, parameter ownership, OpenAI, Anthropic, and
  Google provider files passed 19, 1, 16, 5, and 11 tests.
- The provider-thinking checkpoint passed 7 Anthropic, 18 OpenAI, 2 closed
  parameter-ownership, and 19 role-routing tests.
- Effective model identity passed 1 direct CBS, 19 CBS string, 135 assembly, 68
  V3 plugin, 3 generation-label, and 3 closed ownership tests.
- Translation cache/locale identity passed 26 cache and 4 closed model-runtime
  ownership tests.
- The Phase 2 closure checkpoint passed the closed-world flat-access gate (1
  test), model-consumer ownership gate (10 tests), scripting budget lane (30
  tests), server-backed send-chat lane (33 tests), and raw translation/cache
  lane (33 tests) at `6020f6009`. Prettier and `git diff --check` also passed;
  no broad suite was required for this focused closure record.
- Seed metadata passed 4 behavior and 5 closed ownership tests. HypaV3 budget
  ownership passed 2 behavior and 6 closed ownership tests.
- Hypa settings capacity passed all 19 focused UI tests and 6 closed
  model-runtime ownership tests.
- Lorebook mirror removal passed 1 ownership, 79 lorebook, 25 Agent execution,
  135 assembly, and 52 Lua runtime tests.
- Display-source identity passed 1 ownership and 3 route/service tests.
- Character/chat import ownership passed all 5 legacy import tests, including
  missing/duplicate chat-id transcript and Hypa preservation across a second
  boot. The message store passed all 28 split/rejoin, row-owner, empty
  transcript, import fallback, and cleanup tests.
- `pnpm check`, shared-core/client declarations, Fastify, browser-smoke, and
  root typechecks passed.
- Architecture inventory passed at the current 158 cross-runtime edges after
  interleaved Workstream 1 server-input migrations, 20 compatibility
  surfaces/42 probes, 9,888 client references/326 groups, and 56 owner-gap rows.
- Focused Prettier and `git diff --check` passed.

## Verdict

The Phase 2 normal-consumer release passes through `6020f6009`. Selected legacy
preset ownership is request-local; prompt shape, tokenizer, and output budgeting
and image capability use the selected durable profile; sidebar authoring uses
canonical presets; server-intent completion projects durable runtime fields;
ordinary provider request samplers and provider-specific thinking overrides use
resolved runtime options; prompt-visible identity, plugin recursion protection,
default generation labels, translation cache/locale identity, settings
metadata, HypaV3 response reservation/capacity display, and display-source
identity use the effective profile. The unused lorebook model mirror is gone.
The closed-world flat-access gate leaves only explicitly classified
static/import/export/compatibility boundaries, including the named
older-server response-budget fallback. The model-owner cursor is released to
Workstream 3. Prompt Phase 3 is now the execution cursor.
Character, chat, transcript, and Hypa SQLite rows are released as the singular
normal persisted owners at `7cb62afa8`. Embedded copies are retained only for
pre-extraction import/recovery, while orphan and damaged-state cleanup remains a
Phase 5/6 hold.
