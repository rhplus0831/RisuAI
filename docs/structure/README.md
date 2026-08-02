# Structure Documentation Index

Last audited: 2026-08-02.

Read [`STRUCTURE.md`](../../STRUCTURE.md) for repository boundaries and stable
invariants. Then open only the document that owns the behavior you are changing.
These notes describe current code; completed workstreams and dated reports live
under [`.archived-docs/`](../../.archived-docs/README.md).

## Ownership

| Document                                                             | Owns                                                                                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`backend.md`](backend.md)                                           | Fastify composition, security hooks, route families, workers, Web Push, generation jobs, translation registries, and request-history routing                         |
| [`data-and-events.md`](data-and-events.md)                           | SQLite stores, revisions, lineage, active writer, revisioned and operational writes, command events, atomic chat reset, and command-event SSE |
| [`server-resources-and-bridges.md`](server-resources-and-bridges.md) | Browser root resources, prompt-template hydration, Mood Light projection, translation recovery, durable replay, invalidation, caches, drafts, and bridges |
| [`assets-and-saves.md`](assets-and-saves.md)                         | Content-addressed assets, inlay catalog, `.risu` formats, CharX and chat/dataset exchange, post-export chat reset, Realm conversion, and backup/restore |
| [`plugins-and-mcp.md`](plugins-and-mcp.md)                           | V3 plugin host, permissions, storage/network boundaries, modules, MCP transports, OAuth, and lifecycle boundaries                            |
| [`providers-and-models.md`](providers-and-models.md)                 | Profiles, credentials, capabilities, runtime options, prompt assembly/CBS, history slots, Agents/Agent Presets, translation, request history, and dispatch |
| [`testing-and-operations.md`](testing-and-operations.md)             | pnpm scripts, test lanes, local dev, environment, CI, tracing, deployment, and TypeScript                                                     |
| [`domain-glossary.md`](domain-glossary.md)                           | Shared record names, mutation terms, runtime boundaries, cross-layer ownership, and no-port vocabulary                                       |
| [`generated-and-legacy.md`](generated-and-legacy.md)                 | Generated, vendored, ignored, compatibility-only, retired, and deliberately absent surfaces                                                   |
| [`src/docs/README.md`](../../src/docs/README.md)                     | Current Svelte UI and browser-runtime guides, including floating-composer and Mood Light coordination                                           |

## Adjacent Current Guides

| Guide                                                                                | Use                                                                                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [`docs/tests/README.md`](../tests/README.md)                                          | Find product-flow, domain, server, browser, and visible-state tests without searching the full test tree                  |
| [`docs/data-driven-ui.md`](../data-driven-ui.md)                                      | Trace server-backed, session-local, and asynchronous state into current UI consumers                                     |
| [`server/fastify/__tests__/README.md`](../../server/fastify/__tests__/README.md)       | Navigate the flat Fastify test directory by feature area                                                                 |

[`frontend.md`](frontend.md) remains only as a compatibility pointer for older
archive links; it owns no current guidance.

## Cross-Cutting Changes

| If you change...                       | Also inspect...                                                                                                                                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route/auth/writer/stream policy        | `server/fastify/src/app.ts`, `server/fastify/src/routeManifest.ts`, `server/fastify/src/routeRateLimits.ts`, `server/fastify/__tests__/routeProtection.test.ts`, and [`backend.md`](backend.md)                                                        |
| A revisioned command                   | `src/ts/server/commands.ts`, `src/ts/server/pendingMutationOutbox.ts`, `src/ts/server/resourceInvalidation.ts`, `server/fastify/src/commandMutationReceipts.ts`, command events/local effects, and [Data And Events](data-and-events.md)                 |
| A generic persisted setting            | `SETTINGS_GROUP_KEYS` in `server/fastify/src/routes/commands.ts`, `SERVER_SETTINGS_GROUP_BY_KEY` in `src/ts/server/settingsGroups.ts`, `server/fastify/src/databaseDefaults.ts`, `src/ts/storage/database.svelte.ts`, `server/fastify/__tests__/settingsGroupParity.test.ts`, the setting UI, and `src/lang/` |
| Mood Light visibility or membership    | `src/ts/moodLightMode.ts`, `src/ts/moodLightMembership.ts`, `src/ts/server/settingsGroups.ts`, `server/fastify/src/databaseDefaults.ts`, `server/fastify/src/routes/commands.ts`, `src/App.svelte`, `src/ts/router.ts`, `src/ts/server/selectedCharacterRefresh.ts`, `src/lib/SideBars/Sidebar.svelte`, `src/lib/SideBars/MoodLightManageModal.svelte`, `src/lib/Others/GridCatalog.svelte`, `src/lib/Others/AlertComp.svelte`, `src/lib/Mobile/MobileCharacters.svelte`, `src/ts/moodLightMembership.test.ts`, `src/ts/moodLightMode.test.ts`, and `server/fastify/__tests__/commands.test.ts` |
| Agents or Agent Presets                | `src/ts/agents.ts`, `src/ts/agentPresetRecords.ts`, `src/ts/agentPresetResolver.ts`, `src/ts/agentPresetReferences.ts`, `src/ts/agentLorebookInputs.ts`, `src/ts/moduleIntegration.ts`, `src/ts/server/commands.ts`, `src/ts/server/pendingMutationOutbox.ts`, `server/fastify/src/commands/agentPresets.ts`, `server/fastify/src/prompt/agentPresetExecution.ts`, `server/fastify/src/prompt/assemble.ts`, `src/lib/Setting/Pages/AgentPresetSettings.svelte`, `src/ts/agentPresetRecords.test.ts`, `src/ts/agentPresetResolver.test.ts`, `server/fastify/__tests__/agentPresetExecution.test.ts`, and `server/fastify/__tests__/assemble.test.ts` |
| Provider, credential, profile, or runtime option | `src/ts/model/modellist.ts`, `src/ts/process/request/providerCapability.ts`, `src/ts/model/providerCredentialRecords.ts`, `src/ts/model/modelProfileRecords.ts`, `src/ts/model/modelProfileResolver.ts`, `src/ts/server/providerOperationsProtocol.ts`, `server/fastify/src/providerOperations.ts`, `server/fastify/src/providerSecrets.ts`, `server/fastify/src/prompt/chatDispatch.ts`, `server/fastify/src/generation/stripCoT.ts`, `src/lib/Setting/Pages/Model/`, `server/fastify/src/databaseDefaults.ts`, `server/fastify/src/routes/commands.ts`, `src/lang/`, `src/ts/model/neuralwatt.test.ts`, `server/fastify/__tests__/providerOperations.test.ts`, `server/fastify/__tests__/chatDispatchProfileOptions.test.ts`, `server/fastify/__tests__/stripCoTFrames.test.ts`, and [`providers-and-models.md`](providers-and-models.md) |
| LLM request history                    | `server/fastify/src/requestHistory.ts`, `server/fastify/src/routes/requestHistory.ts`, `server/fastify/src/generation/apiMetadata.ts`, provider/translation/memory call sites, `requestHistoryLimit`, `src/ts/server/requestHistory.ts`, `src/lib/Setting/Pages/RequestHistorySettings.svelte`, and their tests |
| Prompt preset/template ownership       | `prompt_presets.data_json`, `prompt_templates`, `server/fastify/src/commands/splitPresets.ts`, `src/ts/server/promptTemplateHydration.ts`, `src/ts/server/promptTemplateBridge.svelte.ts`, `server/fastify/src/prompt/effectiveGenerationConfig.ts`, `server/fastify/src/prompt/assemble.ts`, `src/lib/Setting/botpreset.svelte`, `src/lib/Setting/Pages/PromptSettings.svelte`, `src/ts/storage/database.svelte.ts`, `server/fastify/src/risuSave/`, `src/lib/Setting/pickerGenerationSettings.test.ts`, and `src/ts/server/promptTemplateBridge.svelte.test.ts` |
| An asset or inlay-catalog field        | `server/fastify/src/risuSave/assetReferences.ts`, asset metadata/GC/backup ownership, catalog commands/events, the full-refresh resource set, and the inlay explorer UI                                                                            |
| Translation behavior                   | `src/ts/translator/pipeline.ts`, `src/ts/translator/historySlots.ts`, `src/ts/process/inputHooks.ts`, `src/ts/setting/languageSettingsData.svelte.ts`, `server/fastify/src/databaseDefaults.ts`, `server/fastify/src/routes/commands.ts`, `server/fastify/src/translation/rawMessageTranslation.ts`, `server/fastify/src/translation/generationCompletionTranslation.ts`, `server/fastify/src/messageTranslationJobs.ts`, `server/fastify/src/greetingTranslationJobs.ts`, `src/ts/server/messageTranslationJobs.ts`, `src/ts/server/greetingTranslations.svelte.ts`, `src/ts/process/serverGeneratedMessageTranslation.ts`, `src/ts/process/inputHooks.test.ts`, `server/fastify/__tests__/rawMessageTranslation.test.ts`, `server/fastify/__tests__/greetingTranslationStore.test.ts`, and [`providers-and-models.md`](providers-and-models.md) |
| A module/plugin/MCP behavior           | Import validation, command restrictions, runtime transport, device-local permissions, OAuth egress, update/icon safety, lifecycle cleanup, and [`plugins-and-mcp.md`](plugins-and-mcp.md)                                                           |
| An import/export or restore format     | `src/ts/characterCards.ts`, `src/ts/process/processzip.ts`, `src/ts/characters.ts`, `src/ts/storage/backup.ts`, `server/fastify/src/risuSave/`, `server/fastify/src/routes/save.ts`, `server/fastify/src/routes/backups.ts`, lineage/revision effects, asset reporting, bounded decoding, greeting/request-history/Mood Light policy, safety snapshots, fixtures, and [`assets-and-saves.md`](assets-and-saves.md) |
| Chat export or all-chat reset          | `src/ts/characters.ts`, `src/ts/chatCommands.ts`, `src/lib/SideBars/SideChatList.svelte`, `server/fastify/src/routes/commands.ts`, `server/fastify/src/commands/events.ts`, `src/ts/server/pendingMutationOutbox.ts`, `src/ts/server/resourceInvalidation.ts`, `src/ts/characters.exportChat.test.ts`, `src/ts/chatCommands.test.ts`, and `server/fastify/__tests__/commands.test.ts` |
| Web Push                               | VAPID/subscription storage, public-key and authenticated subscription route policy, startup service, client retry/navigation coordinator, `public/service-worker.js`, notification settings, and push tests                                           |
| User-visible behavior                  | [`src/docs/svelte-ui.md`](../../src/docs/svelte-ui.md), matching DOM/browser tests, [`docs/data-driven-ui.md`](../data-driven-ui.md) when data-backed, and language keys                                                                          |

## Maintenance Rules

- Keep stable orientation in `STRUCTURE.md`; keep implementation detail in the
  nearest focused document.
- Prefer literal source paths and name the test, route-policy entry, or protocol
  constant that makes a claim durable. Do not copy endpoint inventories that can
  be derived from `app.printRoutes()` and `routeManifest.ts`.
- Link to the canonical owner instead of repeating a contract across documents.
- Keep active investigations under `docs/` only while they remain active. Move
  completed audits, plans, reviews, and closeout reports into the matching
  `.archived-docs/` topic and update its index.
- Update an audit date only after checking the document against current code.
