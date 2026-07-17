# Domain Mutations and Editing Bridges

This area covers optimistic browser edits and rollback for settings, prompts and presets, characters,
chats and messages, personas, loadouts, modules, plugins, lorebooks, and script definitions. It also
covers debounced Svelte editing bridges, dirty-draft reconciliation, stable-target command adapters, and
the retained local projections used while durable mutations await replay.

The shared command queue, encrypted outbox, authoritative resource owners, and event reconciliation are
assessed in [Browser State Sync and Recovery](browser-state-sync-and-recovery.md). Provider/model record
semantics belong in [Providers, Models, and Media](providers-models-and-media.md); prompt execution belongs
in [Prompting, Generation, and Streaming](prompting-generation-and-streaming.md); runtime script semantics
belong in [Scripting, Parsing, and Automation](scripting-parsing-and-automation.md). Asset bytes and import/
export transport are assessed in [Assets, Import/Export, and Backups](assets-import-export-and-backups.md),
and plugin/MCP protocol behavior is assessed in
[Plugins, Modules, and MCP](plugins-modules-and-mcp.md). Rendered chat behavior is assessed in
[App Navigation and Chat](app-navigation-and-chat.md); settings/extension UI and character-content UI are
assessed in [Settings, Profiles, and Extensions](settings-profiles-and-extensions.md) and
[Character Content, Memory, and Catalogs](character-content-memory-and-catalogs.md). Shared controls,
alerts, and accessibility are assessed in
[Shared UI, Feedback, and Accessibility](shared-ui-feedback-and-accessibility.md).

## Assessment

The 30 primary files in this area contain 1,027 runtime-expanded cases. All 1,027 passed in the audit run
without skips or retries. Coverage is unusually deep around the failures that most often cause browser
data loss: index shifts during an await, owner switches, a second local edit overtaking the first,
authoritative projection replacement, retryable durable retention, terminal rollback, partial success in
a command sequence, and rollback that must touch only fields still equal to the failed attempt.

Assertion strength is high. Tests normally assert the immediate optimistic value, exact command payload,
durable ordering or result classification, and final rollback/retained state while checking that sibling
rows and newer edits survive. The main limitation is that many cases stop at resource state or mocked
command calls. Only part of the prompt bridge suite mounts real Svelte UI; most character, chat, persona,
loadout, module, lorebook, and script rollback behavior lacks a rendered-state assertion.

## Test groups

| Logical group                                                | Relevant test locations and included cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Behavior and regression importance                                                                                                                                                                                                | Effectiveness and value                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings writes and dirty drafts                             | `settingsBridge.svelte.test.ts` (47): onboarding and owner-aware prompt settlement; immediate no-op/mixed patches; error reporting; immediate-over-debounced cancellation; watcher-echo suppression; field-scoped rollback/rebase; Hypa V3 append/rename/delete/reinsert/selection cases; debounced coalescing; scalar and sparse-object absolute closures; intent-time epochs; retryable durable projection; lifecycle/teardown flush; authoritative baseline refresh; canonical ACK adoption; dirty reassert/catch-up/reseed. `settingsBridge.durable.test.ts` (5) covers caller-owned staging and total/partial revert closure after a remote dispatch marker.                                                                                                                                                                                                                                                                                                                             | Settings bridges run throughout the app and can silently overwrite a newer edit if their baseline or rollback is wrong. Sparse objects and Hypa rows are especially prone to broad replacement bugs.                              | **Strong state and payload assertions.** It verifies changed-key sparsity, runtime side effects, exact rollback, and no echo. Two tests inspect raw component source instead of behavior, and most cases mock the command/resource boundary.                                                                                                                                  |
| Prompt, legacy preset, and split-preset editing              | `storage/database.svelte.test.ts` (117): prompt-template ID detection; settings/model/Agent/accessibility normalization; seven targeted character-row merges; 80 legacy/split preset hydration, sparse save, local ACK, owner ordering, reference repair, select/reorder/copy/create/update/delete rollback cases; and 19 durable retained-projection cases. `promptTemplateBridge.svelte.test.ts` (80): item-level projection/restore, owner-switch guards, structural rollback, debounced row patches, durable predecessor/correction order, delete-vs-null, lifecycle flush, drag stable IDs, hydration failure/retry, selected-owner adoption, prompt-setting dirty merge, accessibility, and reconciliation.                                                                                                                                                                                                                                                                             | Protects prompt text and preset state, where an unloaded shell or owner switch can otherwise persist an empty template or write to the wrong preset.                                                                              | **Critical and broad.** The prompt bridge includes valuable mounted DOM tests for hydration error/retry, selection, drag, and accessibility. There is intentional overlap between legacy preset helpers and generic command adapters; this suite protects local mutation semantics. Several source-text wiring checks and exact epoch/clone assertions are refactor-coupled.  |
| Character rows, selection, folders, and character bridge     | `characterCommands.test.ts` (77): create payloads (2), create/delete rollback (14), selection rollback (4), order/folder helpers including durable reorder (23), Supa-memory scalar mutation (9 including the projection helper), row snapshots (6), scoped dispatch (2), sanitized kept-key diff (9), and soft/permanent delete behavior (8). `characters.changeChar.test.ts` (6) covers import navigation and shell selection freshness. `characterBridge.svelte.test.ts` (20) covers draft seed/reseed, dirty scalar/object/list merge, sanitized dispatch, shell suppression, rollback, in-flight generations, baseline refresh, and lifecycle flush. MCP `characters.setCharacterInfo.test.ts` (14) covers owner abort/replacement/deletion and optimistic character/lorebook/regex/Lua writes with narrow rollback.                                                                                                                                                                     | Stable character IDs must survive list reorder, deletion, selection changes, and delayed confirmation. Broad rollback would corrupt chat bodies or sibling characters.                                                            | **High-value, realistic concurrency coverage.** Payload stripping, stable-ID lookup, sibling preservation, timestamps, and exact field rollback are asserted. Clone/snapshot cases protect large-corpus cost but expose implementation details. MCP cases should also be indexed in the plugin/MCP document.                                                                  |
| Chats, messages, generation settings, and file-driven writes | `chatCommands.test.ts` (160): 69 projection-helper cases; selection snapshots (9); scoped chat/scriptstate snapshots (3/2); metadata-row rollback (5); message dispatch (10); scriptstate/note dispatch (9); factory/sequence rejection (5); scoped current-chat replacement (2); allowed metadata diff (4); message rollback matrix (22); metadata rollback matrix (10); durable chat/folder structures (10). `activeChatGenerationSettings.test.ts` (16) and `chatGenerationSettings.test.ts` (14) cover readiness, default toggles, sparse diffs/digests, stale references, pruning, and stable errors. `chatBridge.svelte.test.ts` (19) covers metadata/folder watcher baselines, coalescing, rollback suppression, flush, clone cost, and no-change short-circuit. `globalApi.changeChatTo.test.ts` (3), `process/files/multisend.test.ts` (8), and `util.persona.test.ts` (3) cover clone-free selection, file-to-chat persistence/cancellation, and active persona display precedence. | Protects the highest-frequency state transitions: selecting chats, editing metadata, appending/editing/deleting messages, importing transcripts, and saving chat-owned generation settings.                                       | **Critical and comprehensive at the state boundary.** Exact message IDs, placeholder safety, chunked >100-chat imports, accepted prefixes, retained tails, and newer-edit preservation are asserted. At 7,298 lines, `chatCommands.test.ts` repeats generic rollback harnesses and was the slowest audited file. Cross-link DOM chat tests for visible optimism and rollback. |
| Personas and loadouts                                        | `persona.test.ts` (43): 33 stable-ID preparation/debounced PATCH/selection/delete/reorder/dependency/absolute-correction cases, five collection rollback guards, and five dirty selected-profile reconciliation cases. `personaDisplayName.test.ts` (2) and `personaMutationCertificate.test.ts` (2) pin display/internal naming and compact certificate serialization. `loadout.test.ts` (46) covers canonical create, multi-facet serialized apply, retained/terminal steps, queue reservation, concurrent replanning, hydration, persona/preset/module/global-variable/Agent Preset facets, touch/favorite, refresh overlays, and create/delete rollback. `loadoutCanonical.test.ts` expands 13 exact/invalid server-shape cases.                                                                                                                                                                                                                                                          | Persona and loadout operations touch several resource owners at once. Partial rollback can corrupt the selected profile, references in chats/loadouts, preset selections, module links, or sidebar settings.                      | **Strong multi-resource regression value.** Cases assert stable IDs and field-level rollback across concurrent edits and partial success. A real browser-to-Fastify multi-step apply/rollback journey is missing. Model and Agent Preset record validity is assessed in the provider/model document.                                                                          |
| Modules, plugins, imports, and MCP adapters                  | `moduleCommands.test.ts` (37): 30 projection helpers, two chat-scoped toggle cases, and five snapshot-narrowing cases for global/character/chat links, defaults, multi-step rollback, durable order, create/update/delete/enable/reorder. `pluginCommands.test.ts` (31) covers arguments, enable/provider/create/update/delete/reorder, grouped settings, pending plugin-storage overlays, same-key serialization, and bulk replacement rollback. `process/modules.test.ts` (33) covers ordinary/MCP `.risum` import, asset/metadata validation, low-level confirmation, exact pre-staging, retained suffix/accepted prefix, character definition hydration, destructive refresh, and active module cache/integration. MCP module optimistic tests (14), read tests (8), and `stores.modulesEffect.svelte.test.ts` (3) cover immediate read visibility, narrow rollback, pagination/fields, and reactive dependency cost.                                                                     | Modules and plugins span collection records, enabled lists, character/chat references, assets, lorebooks, scripts, triggers, and custom storage. Sequencing errors can persist only half an import or resurrect a deleted record. | **Broad and strongly asserted.** Partial success, retained replay, reference cleanup, and storage overlays are realistic. `process/modules.test.ts` mixes import, mutation, and active-runtime cache concerns; split fixtures by behavior. Plugin/MCP protocol/security coverage belongs in its focused document.                                                             |
| Lorebooks and script/trigger definitions                     | `lorebookBridge.svelte.test.ts` (99): six dirty-entry merge cases; 12 no-data-loss hydration/watcher cases; one snapshot-purity case; 22 global modal mutations; 40 entry-draft/sparse/structural/rollback cases; and 18 scoped watcher/clone/id-validation cases. `lorebookBridge.test.ts` (22) covers scoped snapshots/dispatch and durable owner ordering. `scriptDefinitionBridge.svelte.test.ts` (71): purity (5), dirty merge (7), module projection (3), character drafts (11), compact mutations (17), module fences (2), watcher baselines (5), clone cost (3), debounced rollback (3), scoped rollback (9), and scoped detection (6). `scriptDefinitionMutations.test.ts` (14) classifies compact create/update/delete/reorder/replace shapes.                                                                                                                                                                                                                                      | Lorebook and script editors are vulnerable to catastrophic stub writes, wrong-owner updates, and broad rollback that removes unrelated entries or domains.                                                                        | **Among the most valuable data-loss suites.** They explicitly refuse unhydrated stubs, revalidate IDs at flush, preserve newer fields/siblings, and test durable owner dependencies. Several cases read Svelte/TypeScript source and assert substrings; those are brittle architecture checks, not runtime evidence. Runtime scripting semantics are covered separately.      |

## Included case matrices and boundaries

The largest files organize many individual tests under one `describe`; the following map makes their
coverage boundaries explicit without repeating one paragraph per assertion.

### Settings and prompt/preset matrices

- Immediate settings cases distinguish unchanged values, mixed changed/unchanged keys, undefined
  no-delete behavior, newer same-key edits, multi-key partial rollback, runtime-effect replay, and
  immediate writes merged with pending/debounced work.
- Sparse settings cases distinguish explicit deletion, total revert, partial revert, older in-flight
  failure, retained retry projection, successor restaging, successor becoming a no-op, and one-time error
  reporting. Hypa V3 rows separately cover append, edited append, rename, delete/reinsert, selection index
  rebase, duplicate avoidance, and selection-only generic rollback.
- Legacy/split preset parameter rows cover immediate edits after retained `model` and `prompt` creates;
  marked `model`/`prompt` predecessors with total/partial revert closures; retained legacy create/update/
  delete/reorder projections across targeted/full refresh; retained legacy/model/prompt selections; and
  terminal legacy/model/prompt reorder rebasing.
- Prompt item owner-switch cases separately cover create, delete, reorder, and enable at command
  construction and rollback. Drag cancellation separately covers missing source, missing target, and owner
  change. Prompt dirty merge distinguishes row text, clean sibling fields, catch-up clearing, owner reset,
  and settings patches that must survive row reset.

### Character and chat matrices

- Character create/delete cases distinguish create vs create-and-select, import without an optimistic
  row, permanent delete reinsertion, duplicate same-ID replacement, selection index compaction, and
  durable dependencies behind a retained profile patch or delete. Order cases cover root/folder moves,
  folder creation, rename/color/image reset/update, invalid drag/missing folder, stable folder ID, terminal
  rollback, retained replay, and newer folder metadata after an older failure.
- Character scalar/snapshot cases cover `supaMemory`, input translation, selected-character auto-enable,
  `trashTime`, timestamps, stable IDs after index shifts, added-field deletion, nested-array replacement,
  excluded fields, and no full-character-array clone.
- Chat structure cases distinguish chat/folder create, delete, fork/branch fork, combined folder/chat
  reorder, duplicate IDs, missing folder assignment, selection preservation, authoritative row arrival,
  and dependent edits to a failed optimistic ghost.
- Message cases cover append, update, delete, truncate, replace-tail, replace-all, placeholder-prefix
  append/tail, unsafe placeholder edit rejection, message-ID rollback, overlapping update/delete failures,
  field divergence, metadata preservation, >100-chat pre-staging, oversized transcript chunking, accepted
  chunk prefix, and unchunkable message rejection.
- Generation-settings cases cover first write vs existing settings, exact persist-before-send, queued edit,
  retained predecessor replay, remote dispatch marker, total correction, destructive refresh, sparse ACK
  overtaken by full write, same/disjoint field failures, and accepted predecessor plus failed successor.

### Persona, loadout, module, plugin, lorebook, and definition matrices

- Persona structural proofs cover create/delete/select/reorder. PATCH behavior distinguishes debounce/
  keepalive, owner selection/deletion dependencies, partial reverts, remote-marker absolute correction,
  authoritative projection races, direct vs trigger prompt saves, duplicate/missing IDs, and confirmation
  target changes. Dirty merge covers same-field later edits and selected-row-only `largePortrait`.
- Loadout server validation accepts the exact required shape, then rejects unknown keys, blank ID/name,
  non-finite `lastUsed`, non-boolean `favorite`, invalid/sparse character IDs, invalid module IDs/global
  values, invalid required preset fields, invalid optional Agent fields, and duplicate collection IDs.
- Module mutations separately exercise global record, enabled list, character link, chat link, sidebar
  defaults, script/trigger/lorebook split fields, create/delete dependencies, and same-record failure rebase.
  Plugin cases separately cover record, provider, argument, grouped settings, and storage map ownership.
- Lorebook scopes are global collection, global entry, character collection/entry, chat collection/entry,
  and module collection/entry. Structural matrices cover create/update/delete/reorder/replace; entry draft
  matrices cover sparse fields, deletion vs null, immediate correction, in-flight successor, projection
  epoch change, and stale rollback. Watchers separately test global/module/selected-character/all scopes and
  non-open chat local lore.
- Script definitions distinguish global, character, and module owners; regex scripts vs Lua triggers;
  create/update/delete/reorder vs full replace; dirty field merge; compact acknowledgement fencing; and
  rollback after newer same-definition or sibling-domain edits.

## Especially critical tests

- `chatCommands.test.ts` and `characterCommands.test.ts` are the main protection against broad rollback
  corrupting large character/chat collections after ordinary user edits.
- `lorebookBridge.svelte.test.ts` explicitly protects the no-data-loss invariant that an unloaded or
  re-stubbed character lorebook is never persisted as empty.
- `promptTemplateBridge.svelte.test.ts` prevents writes to an old selected owner and prevents unloaded
  templates from being created or saved as empty.
- `storage/database.svelte.test.ts` protects stable legacy preset hydration and retained split-preset
  projections across refresh and replay.
- `persona.test.ts` and `loadout.test.ts` protect cross-resource references and multi-step partial success.
- `process/modules.test.ts` protects accepted-prefix/retained-suffix module imports and refuses to report
  success before durable settlement.

## Attention and gaps

- `settingsBridge.svelte.test.ts`, `promptTemplateBridge.svelte.test.ts`,
  `lorebookBridge.svelte.test.ts`, and `scriptDefinitionBridge.svelte.test.ts` contain source-text tests
  using `readFileSync`, substring positions, and `toContain`. They enforce useful wiring policy but can
  fail on harmless refactors and can pass without proving runtime behavior.
- Large files repeat deferred promises, command receipts, projection epochs, and generic attempted-field/
  keyed-list rollback. `chatCommands.test.ts` is 7,298 lines; `storage/database.svelte.test.ts` is 4,928;
  lorebook/prompt/script bridge suites are each multi-thousand-line. The scenarios are mostly valuable,
  but shared harnesses would make failures easier to diagnose.
- “Phase”, “Lxx”, “Mxx”, “K4”, and “P1” titles expose migration history and internal clone goals more
  clearly than product behavior. Keep the codes as suffixes, not the primary description.
- Clone-count and exact snapshot-boundary assertions protect real large-corpus regressions but are
  intentionally coupled to implementation. Preserve a dedicated performance gate and also assert user
  outcomes.
- Most tests mock the transport and do not mount the consuming component. Cross-link chat, settings,
  sidebar, model, and plugin UI tests, and add DOM coverage where no visible-state test exists.
- Import and upload byte handling is deliberately not repeated here. Character card, Realm, backup,
  binary asset, and inlay details belong in the assets/saves document.

## Prioritized recommendations

1. Add mounted optimistic-then-rollback tests for one character field, one chat message edit/delete, one
   persona selection, one prompt item, one loadout apply, one module toggle, and one lorebook entry. Assert
   both the optimistic paint and the visible rollback or authoritative replacement.
2. Add a browser-to-Fastify integration for a multi-step loadout or module import: verify queue ordering,
   partial success, retained suffix, reload replay, resource reread, and final rendered state.
3. Replace component source-string assertions with mounted behavior. Move true forbidden-import or
   architecture rules into one named static gate.
4. Build shared parameterized contracts for latest-operation freshness and attempted-field/keyed-list
   rollback. Retain domain-specific ownership, stable-ID, payload, and projection cases.
5. Split the largest files by product behavior while reusing fixtures: chat structures/messages/settings;
   preset hydration/mutation/replay; lorebook draft/modal/watcher; script classifier/draft/watcher.
6. Cross-link model/Agent Preset validity, asset/import transport, plugin/MCP permissions, scripting
   execution, and rendered UI documents so this file does not imply end-to-end coverage it does not own.

## Primary inventory

Every primary file owned by this document is listed exactly once. Cross-cutting asset, model, provider,
plugin/MCP protocol, scripting runtime, and UI files are assessed in their focused documents.

| Location                                                                   |     Cases | Protected behavior                                 |
| -------------------------------------------------------------------------- | --------: | -------------------------------------------------- |
| `src/ts/activeChatGenerationSettings.test.ts`                              |        16 | Active-chat settings readiness and writes          |
| `src/ts/characterCommands.test.ts`                                         |        77 | Character mutations and rollback                   |
| `src/ts/characters.changeChar.test.ts`                                     |         6 | Stable shell/import selection                      |
| `src/ts/chatCommands.test.ts`                                              |       160 | Chat/folder/message/settings/scriptstate mutations |
| `src/ts/chatGenerationSettings.test.ts`                                    |        14 | Generation-settings contract                       |
| `src/ts/globalApi.changeChatTo.test.ts`                                    |         3 | Clone-free chat selection                          |
| `src/ts/loadout.test.ts`                                                   |        46 | Multi-facet loadout mutations                      |
| `src/ts/moduleCommands.test.ts`                                            |        37 | Module record/link/enable/order mutations          |
| `src/ts/persona.test.ts`                                                   |        43 | Persona bridge and structural mutations            |
| `src/ts/personaDisplayName.test.ts`                                        |         2 | Persona visible/internal naming                    |
| `src/ts/personaMutationCertificate.test.ts`                                |         2 | Persona compact certificate                        |
| `src/ts/pluginCommands.test.ts`                                            |        31 | Plugin/provider/settings/storage mutations         |
| `src/ts/process/files/multisend.test.ts`                                   |         8 | File-to-chat ingestion and persistence             |
| `src/ts/process/mcp/risuaccess/tests/characters.setCharacterInfo.test.ts`  |        14 | MCP character optimistic writers                   |
| `src/ts/process/mcp/risuaccess/tests/modules.optimisticProjection.test.ts` |        14 | MCP module optimistic writers                      |
| `src/ts/process/mcp/risuaccess/tests/modules.test.ts`                      |         8 | MCP module read adapters                           |
| `src/ts/process/modules.test.ts`                                           |        33 | Module import and retained definitions             |
| `src/ts/server/characterBridge.svelte.test.ts`                             |        20 | Character dirty-draft bridge                       |
| `src/ts/server/chatBridge.svelte.test.ts`                                  |        19 | Chat/folder metadata bridge                        |
| `src/ts/server/loadoutCanonical.test.ts`                                   |        13 | Canonical loadout validation                       |
| `src/ts/server/lorebookBridge.svelte.test.ts`                              |        99 | Lorebook drafts/modal/watcher                      |
| `src/ts/server/lorebookBridge.test.ts`                                     |        22 | Lorebook scoped dispatch/order                     |
| `src/ts/server/promptTemplateBridge.svelte.test.ts`                        |        80 | Prompt item/settings bridge                        |
| `src/ts/server/scriptDefinitionBridge.svelte.test.ts`                      |        71 | Script/trigger definition bridge                   |
| `src/ts/server/scriptDefinitionMutations.test.ts`                          |        14 | Definition mutation classifier                     |
| `src/ts/server/settingsBridge.durable.test.ts`                             |         5 | Durable settings marker order                      |
| `src/ts/server/settingsBridge.svelte.test.ts`                              |        47 | Settings coalescing and dirty drafts               |
| `src/ts/storage/database.svelte.test.ts`                                   |       117 | Normalization and preset mutations                 |
| `src/ts/stores.modulesEffect.svelte.test.ts`                               |         3 | Module reactive dependency cost                    |
| `src/ts/util.persona.test.ts`                                              |         3 | Active persona display precedence                  |
| **Total**                                                                  | **1,027** | **30 primary files**                               |
