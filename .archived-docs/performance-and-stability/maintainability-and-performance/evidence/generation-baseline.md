# Generation preparation baseline (F02/F09)

Source: `491cc18204bb12c66f92139cd0c2e1131eaf616a` (Phase 0 accepted).
Fixture/probe:
[`generationPreparationCosts.test.ts`](../../../../server/fastify/__tests__/generationPreparationCosts.test.ts).
This entry records structural work; it does not claim production latency or
close either finding. Phase 3 owns implementation and post-change comparison.

## Reproduction and measurement boundaries

```sh
pnpm test -- server/fastify/__tests__/generationPreparationCosts.test.ts
```

The probe writes sanitized counters and machine metadata to
`fast-bootstrap-results/maintainability/generation-costs.json`. It contains no
prompt text or credentials. The artifact is replaceable; the fixture and these
baseline tables are durable evidence. Runtime at baseline: Node v24.19.0, pnpm
11.23.0, Linux x86_64, 10 visible logical CPUs. Counter runs use one repetition
per case, fresh temporary SQLite stores, no application cache, and no network.
They ran while other work was active, so suite duration is not latency evidence.

For a separate isolated timing run, stop other builds/tests/workers, then run:

```sh
RISU_GENERATION_COST_TIMING=1 pnpm test -- server/fastify/__tests__/generationPreparationCosts.test.ts
```

Each fixture then performs one warmup and three measured repetitions of real
preflight and assembly with SQL/clone spies removed. Samples are milliseconds
from `performance.now()`, retained individually. Tokenizer/module code and SQLite
page caches are warm; each assembly reloads database records. Timing is opt-in;
there are no timing assertions. Preflight, assembly, provider wait, and durable
persistence are not combined: this preview fixture invokes no provider and
performs no generation persistence. The assembly seam is the live
`assemblePrompt` with the same `loadPersistedForAssembly` dependency used by the
route; route-level Hypa embedding prefetch, SSE, and dispatch are outside this
measurement.

SQL instrumentation wraps actual prepared statement `all`/`get` results. It
records query-call counts, returned rows, total returned JSON representation
bytes, and UTF-8 bytes of returned `*_json` columns per table. Rows repeated by
two queries count twice. These counters describe application read/parse scope,
not SQLite disk I/O or query-plan rows examined. Clone instrumentation measures
each actual `structuredClone` call and its input's JSON representation bytes;
this is a comparable work proxy, not allocated heap bytes. Standalone load and
effective-config phases are measured separately and must not be added to full
preflight/assembly totals, which already include that work.

## Deterministic fixtures

The selected character, persona, model/prompt preset, settings, and four-message
chat remain fixed. No modules are active. Each unrelated unit adds one character
with three chats and eight persisted messages per chat; one unused module,
model preset, prompt preset, and persona; and eight unrelated asset metadata
rows. Large body fields repeat the 28-character synthetic string in the fixture
80 times. Asset files are unnecessary because no fixture prompt references one.
All IDs and message times are fixed. Independent history cases grow only the
target transcript to 4, 40, and 160 rows.

The tests assert equal formatted prompt objects across unrelated-size cases,
successful preflight/assembly, preserved target input, a separately owned working
chat, and larger rendered output for larger target history. Baseline inefficient
counts are reported rather than asserted as desired behavior.

| Unrelated characters / chats / messages | Unused rows per collection | Asset rows | Loaded database bytes | Separate asset snapshot bytes | SQL rows per preflight / assembly | JSON-column bytes per preflight / assembly |
| --------------------------------------- | -------------------------- | ---------- | --------------------- | ----------------------------- | --------------------------------- | ------------------------------------------ |
| 0 / 0 / 0                               | 0                          | 0          | 2,790                 | 2                             | 10                                | 2,025                                      |
| 12 / 36 / 288                           | 12                         | 96         | 264,325               | 11,905                        | 214                               | 290,805                                    |
| 48 / 144 / 1,152                        | 48                         | 384        | 1,049,413             | 47,617                        | 826                               | 1,157,685                                  |

| Unrelated units | Preflight clones / bytes | Effective-config clones / bytes | Full assembly clones / bytes |
| --------------- | ------------------------ | ------------------------------- | ---------------------------- |
| 0               | 4 / 4,308                | 3 / 3,550                       | 17 / 5,368                   |
| 12              | 4 / 265,843              | 3 / 265,085                     | 17 / 266,903                 |
| 48              | 4 / 1,050,931            | 3 / 1,050,173                   | 17 / 1,051,991               |

Each preflight/load/assembly reads one settings row, all character/chat rows,
all model presets/prompt presets/personas, all asset metadata, and only four
message rows. Modules are returned twice: 0 / 24 / 96 rows, because
`hydrateAssemblyModuleBodies` reloads the collection. At the large point the
nonzero table counts are settings 1, characters 49, chats 145, modules 96,
model presets 49, prompt presets 49, personas 49, assets 384, messages 4.
Standalone repository load performs zero `structuredClone` calls.

| Target messages, unrelated units = 0 | Snapshot bytes | SQL rows | Preflight clone bytes | Effective-config clone bytes | Assembly clone bytes |
| ------------------------------------ | -------------- | -------- | --------------------- | ---------------------------- | -------------------- |
| 4                                    | 2,790          | 10       | 4,308                 | 3,550                        | 5,368                |
| 40                                   | 7,314          | 46       | 17,880                | 12,598                       | 27,988               |
| 160                                  | 22,554         | 166      | 63,600                | 43,078                       | 104,188              |

## Proposed numeric acceptance budgets before Phase 3

These derive from the measured small fixture and the intended exclusion of
unrelated work. They are structural budgets, not invented millisecond targets.

- For all three unrelated points: zero unrelated character/chat/collection body
  rows and zero asset metadata rows; ordinary assembly reads at most 10 total
  rows for this fixture, with exactly four target message rows. Snapshot size at
  most 2,790 bytes; clone input bytes at most 3,550 for effective config and
  5,368 for full assembly. Fixed selected inputs produce zero byte growth as
  unrelated corpus size grows.
- Preflight reads zero transcript rows (including the 160-message case), at most
  six selected configuration/owner rows for this fixture, and at most 4,308
  clone input bytes. Preflight cost has zero growth on the history axis.
- Effective config performs zero whole-aggregate clones. The existing three
  clone calls for effective config and 17 for assembly are upper bounds for the
  small fixture, subordinate to actual ownership/byte scope; changing clone
  mechanisms cannot satisfy the budget by hiding broad copying.
- At 160 target messages, ordinary assembly may retain the full target history
  required by CBS/Lua and durable effects; its measured 104,188 clone input bytes
  and 166 returned rows are upper bounds. Unrelated corpus growth must still add
  zero body/clone bytes. Broader scripted behavior must have its own named
  capability and separately measured fixture before invoking a broad loader.
- Keep exact prompt, provider/profile/credential selection, module/persona/agent
  precedence, and effect behavior in their existing focused functionality tests.
  This minimal empty-module fixture alone is not parity evidence for those cases.

## F09 boundary and type inventory

The production unrestricted entry is `FastifyDatabase = any` in
`server/fastify/src/prompt/serverTypes.ts`. The following consumer groups require
explicit views; a typed outer alias cannot close the participating inner fields.

| Boundary / consumers                                                                                                                                                                   | Fields that must remain explicit                                                                                                                                                                                    | Existing type/validation sources                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Readiness / effective configuration: `generationChat.ts`, `effectiveGenerationConfig.ts`                                                                                               | Character/chat IDs and indexes; `generationSettings`; selected persona, model/prompt/agent presets; agent/module references; sidebar toggles, jailbreak, stable selection IDs; `moduleIntergration` legacy spelling | `packages/shared-core/src/chatGenerationSettings.ts` (`ChatGenerationSettings`, readiness reference views); `presetSplit.ts`; `personaSelectionIdentity.ts`; `agentPresetRecords.ts`; `moduleIntegration.ts`; server `commands/personas.ts` (`PersonaRecord`) |
| Provider configuration: `chatDispatch.ts`, `tokenizerConfig.ts`, route `generation.ts`, `commands/modelProfiles.ts`, `ollamaCloudToolProxy.ts`                                         | `aiModel`, `subModel`, role/profile/credential bindings, provider options, request model, tokenizer, runtime sampler/stream/schema/tool fields, legacy sampler spellings (`PresensePenalty`, `seperateParameters`)  | `packages/shared-core/src/modelProfileRecords.ts`, `modelProfileResolver.ts` (`ResolvedModelProfile`), `modelTypes.ts`; server `prompt/promptMessage.ts`; settings normalization must validate extension values before use                                    |
| Assembly and post-generation: `assemble.ts`, `budgetFinalize.ts`, `staticSections.ts`, `templates.ts`, `scripts.ts`, `triggers.ts`, `triggerVars.ts`, `variables.ts`, `promptScope.ts` | Working and authoritative transcripts; variable maps/defaults; prompt order/template/slots, regex policy, selected character fields; model budget; mutation and restoration records                                 | Server `AssembleInput`, `AssembleDeps`, `AssembleResult`, `AssembleMutationPayload`; `triggerDescriptors.ts`; `boundedRegex.ts`; `packages/shared-core/src/promptSettings.ts`; browser model fields are historical field evidence, not a runtime import       |
| Modules/assets: `modules.ts`, `assetLookup.ts`, `promptAssets.ts`                                                                                                                      | Enabled/character/chat/persona/preset integration IDs, selected module lore/regex/triggers/assets, character emotion/additional assets and inlays                                                                   | Server `prompt/moduleDescriptors.ts` (`ServerModule`), `assetLookup.ts` (`ResolveStoredAsset` and checked inlay parsers), `promptMessage.ts` (`PromptMultimodal`)                                                                                             |
| Agents/memory: `agentPresetExecution.ts`, `memory.ts`, `lorebook.ts`, `memorySummarizeJobHandler.ts`, `memorySummaryModel.ts`                                                          | Agent definitions/preset steps/default ID, chosen owners and input scopes; lore settings and rows; Hypa/BardWiki settings, summary model selection and memory state                                                 | `packages/shared-core/src/agentPresetRecords.ts`; server memory repositories and `prompt/memoryAdapter.ts`; protocol BardWiki settings; `prompt/lorebook.ts` normalized activation records                                                                    |
| Script/display/translation adapters: `luaRuntime.ts`, `displaySourceService.ts`, `translation/rawMessageTranslation.ts`                                                                | Checked host-function arguments, mutable working chat/character/variables; provider/media settings for explicit Lua calls; selected display dependency inputs; translation/model views                              | `ServerLuaRuntimeContext`, script runtime policy, existing media/provider request contracts, translation settings resolvers; explicit conversion to shared CBS records                                                                                        |

All six unrestricted record index signatures in `serverTypes.ts` require closure:

| Record                     | Missing explicit fields / boundary work                                                                                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FastifyChat`              | Replace `generationSettings?: any` with `ChatGenerationSettings`; explicitly model scriptstate, modules, greeting index, Hypa data/truncation acknowledgement, alternates and participating metadata. Validate unknown imported extensions locally. |
| `FastifyMessage`           | Explicit disabled/comment/name/saying/other-user fields, translation, generation metadata and prompt info. Preserve message identity and optional data on authoritative/effect snapshots.                                                           |
| `FastifyCharacter`         | Explicit optional asset, nickname, module, variable, memory/lore/depth-prompt, script-access and script-model-override fields. `loreExt`/`extentions` require checked values; copying the browser's own `any` extensions would retain the hole.     |
| `FastifyLoreBook`          | Explicit ID, folder, activation/regex/version/cache fields and legacy `extentions` versus imported `extensions` handling, including agent-only and case-sensitivity flags.                                                                          |
| `FastifyCustomScript`      | Explicit optional `id`, `flag`, `ableFlag` and any source attribution consumed by compiled scripts; checked extension records only where imported data requires them.                                                                               |
| `FastifyMessagePresetInfo` | Concrete `promptName`, `{key,value}[]` toggles, and optional typed prompt rows. `packages/shared-core/src/promptInfoSnapshot.ts` already defines the first two fields.                                                                              |

The concrete legacy field catalog for these six records is
`src/ts/storage/database.svelte.ts` (`Chat`, `Message`, `character`, `loreBook`,
`customscript`, `MessagePresetInfo`). Extract participating neutral/server views;
do not import the Svelte database or copy its unrestricted extension types.
Additional consumers of these inner views include `history.ts`, `preflight.ts`,
`plainSections.ts`, `triggerDataEffects.ts`, and `luaPostGenerationTrace.ts`.

## Dynamic scripting access audit

- CBS enters through `variables.ts` → `promptScope.ts` → `cbsAdapter.ts` →
  shared `cbsRegistry.ts` / `risuChatParserCore.ts`. History callbacks inspect the
  current character/chat and may serialize complete message objects; current
  character asset/lore callbacks and selected model/persona callbacks require
  their declared owners. Full target history is a supported cost. The current
  adapter casts to `CbsDatabase`; `packages/shared-core/src/cbsContracts.ts` still
  has `any` index signatures on database, character, chat, message, lore and
  module views. Reusing that alias is not F09 closure. A server adapter must
  enumerate/validate its fields and preserve the selected character/chat indexes.
- Lua host functions in `luaRuntime.ts` use the supplied working chat for
  `getChat`, `getRecentChats`, `getFullChat`, setters and history lookups. Their
  `_id` argument is not a sibling-chat selector. Character getters/setters use
  the active working character; persona lookups use the selected persona.
  `getGlobalVar` accesses the named global variable map. `cbs` delegates to the
  same active CBS context. These audited calls do not establish a need to load
  every unrelated character/chat body.
- Explicit Lua LLM/image/embedding APIs require their provider/media settings,
  credentials, selected script owner overrides, and existing permissions,
  egress, execution/rate budgets. They cannot inherit an untyped unrestricted
  aggregate merely because the ordinary prompt does not use those fields.
  Dynamic `setFullChat` JSON and host function arguments remain checked-boundary
  work; mutable history must preserve durable effect/rollback semantics.
- Regex and declarative V2 triggers combine global, selected prompt, character,
  and active module scripts. V2 data effects change target history/local lore and
  selected character fields. Agent inputs can request target history and chosen
  lore/agent outputs. Measure any newly discovered broader selector as a named
  exception; neither source review nor the plain fixture proves all scripts safe
  to receive empty sibling shells.

F09 acceptance is structural/type-based: zero unrestricted production entry
aliases; zero unrestricted index signatures in these six participating views;
zero `any` generation-settings fields; strict compilation rejects misspelled
known fields. Any retained dynamic adapter needs named validation and explicit
scope, with unresolved unchecked consumers kept open in status.

## Isolated timing baseline and comparison targets

The opt-in timing invocation passed two tests after all baseline authors stopped
CPU-intensive tools. [Raw counters and samples](generation-costs-before.json)
retain all repetitions. Production still matches `491cc1820`; the worktree adds
only probes and evidence. No provider/network wait or persistence is included.

| Axis | Dimension | Median preflight ms | Median assembly ms |
| --- | --- | --- | --- |
| Unrelated units | 0 | 0.407 | 2.382 |
| Unrelated units | 12 | 1.066 | 2.812 |
| Unrelated units | 48 | 2.915 | 5.084 |
| Target history | 4 | 0.281 | 1.418 |
| Target history | 40 | 0.519 | 6.032 |
| Target history | 160 | 0.770 | 14.256 |

The repeated four-message small case exposes warmup/noise, so these are local
comparisons, not production latency claims. In addition to strict work budgets,
Phase 3 targets large-unrelated median preflight/assembly no greater than the
current intermediate medians (1.066/2.812 ms); the small-unrelated median must
remain within its measured sample envelope (preflight at most 0.453 ms,
assembly at most 2.409 ms). The history-only case retains required history cost;
preflight must become history-independent. A noisy comparison requires matched
remeasurement, not silently raised budgets or weakened deterministic counters.
