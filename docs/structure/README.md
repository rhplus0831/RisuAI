# Structure Documentation Index

Last audited: 2026-07-27.

Read [`STRUCTURE.md`](../../STRUCTURE.md) for repository boundaries and stable
invariants. Then open only the document that owns the behavior you are changing.
These notes describe current code; completed workstreams and dated reports live
under [`.archived-docs/`](../../.archived-docs/README.md).

## Ownership

| Document                                                             | Owns                                                                                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`backend.md`](backend.md)                                           | Fastify composition, security hooks, route families, workers, Web Push, generation jobs, translation registries, and request-history routing   |
| [`data-and-events.md`](data-and-events.md)                           | SQLite stores, revisions, lineage, active writer, operational writes, command events, and command-event SSE                                   |
| [`server-resources-and-bridges.md`](server-resources-and-bridges.md) | Browser root resources, hydration, greeting translations, durable mutation replay, invalidation, caches, recovery drafts, and data bridges    |
| [`assets-and-saves.md`](assets-and-saves.md)                         | Content-addressed assets, inlay catalog, `.risu` formats, import/export, Realm conversion, and backup/restore                                 |
| [`plugins-and-mcp.md`](plugins-and-mcp.md)                           | V3 plugin host, permissions, storage/network boundaries, modules, MCP transports, OAuth, and lifecycle boundaries                            |
| [`providers-and-models.md`](providers-and-models.md)                 | Profiles, shared credentials, capabilities, prompt assembly, Agents/Agent Presets, translation, request history, tools, and provider dispatch |
| [`testing-and-operations.md`](testing-and-operations.md)             | pnpm scripts, test lanes, local dev, environment, CI, tracing, deployment, and TypeScript                                                     |
| [`domain-glossary.md`](domain-glossary.md)                           | Shared record names, mutation terms, runtime boundaries, cross-layer ownership, and no-port vocabulary                                       |
| [`generated-and-legacy.md`](generated-and-legacy.md)                 | Generated, vendored, ignored, compatibility-only, retired, and deliberately absent surfaces                                                   |
| [`src/docs/README.md`](../../src/docs/README.md)                     | Current Svelte UI and browser-runtime guides                                                                                                    |

## Adjacent Current Guides

| Guide                                                    | Use                                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`docs/tests/README.md`](../tests/README.md)             | Find product-flow, domain, server, browser, and visible-state tests without searching the full test tree |
| [`docs/data-driven-ui.md`](../data-driven-ui.md)         | Trace server-backed collections and settings into current UI consumers                                  |
| [`server/fastify/__tests__/README.md`](../../server/fastify/__tests__/README.md) | Navigate the flat Fastify test directory by feature area                                  |

[`frontend.md`](frontend.md) remains only as a compatibility pointer for older
archive links; it owns no current guidance.

## Cross-Cutting Changes

| If you change...                       | Also inspect...                                                                                                                                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route/auth/writer/stream policy        | `server/fastify/src/app.ts`, `server/fastify/src/routeManifest.ts`, `server/fastify/src/routeRateLimits.ts`, `server/fastify/__tests__/routeProtection.test.ts`, and [`backend.md`](backend.md)                                                        |
| A revisioned command                   | `src/ts/server/commands.ts`, `src/ts/server/pendingMutationOutbox.ts`, `src/ts/server/resourceInvalidation.ts`, `server/fastify/src/commandMutationReceipts.ts`, command events/local effects, and [Data And Events](data-and-events.md)                 |
| A generic persisted setting            | `SETTINGS_GROUP_KEYS` in `server/fastify/src/routes/commands.ts`, `SERVER_SETTINGS_GROUP_BY_KEY` in `src/ts/server/settingsGroups.ts`, defaults, `server/fastify/__tests__/settingsGroupParity.test.ts`, the setting UI, and `src/lang/`                 |
| Agents or Agent Presets                | `src/ts/agents.ts`, `src/ts/agentPresetRecords.ts`, `src/ts/agentPresetResolver.ts`, `src/ts/agentLorebookInputs.ts`, browser command/outbox keys, `server/fastify/src/commands/agentPresets.ts`, `server/fastify/src/prompt/agentPresetExecution.ts`, UI, and provider/resource tests |
| Provider credentials or profile fields | `src/ts/model/providerCredentialRecords.ts`, `src/ts/model/modelProfileRecords.ts`, `src/ts/model/modelProfileResolver.ts`, profile/credential command handlers, masking, `src/lib/Setting/Pages/Model/ProviderCredentialList.svelte`, profile UI, settings defaults/groups, imports, and provider tests |
| LLM request history                    | `server/fastify/src/requestHistory.ts`, `server/fastify/src/routes/requestHistory.ts`, `server/fastify/src/generation/apiMetadata.ts`, provider/translation/memory call sites, `requestHistoryLimit`, `src/ts/server/requestHistory.ts`, `src/lib/Setting/Pages/RequestHistorySettings.svelte`, and their tests |
| Prompt preset/template ownership       | `prompt_presets.data_json`, `prompt_templates`, split-preset commands, resource hydration/cache, `effectiveGenerationConfig.ts`, server assembly, archive/selection UI, imports/exports, and prompt-preset tests                                     |
| An asset or inlay-catalog field        | `server/fastify/src/risuSave/assetReferences.ts`, asset metadata/GC/backup ownership, catalog commands/events, the full-refresh resource set, and the inlay explorer UI                                                                            |
| Translation behavior                   | Translator normalization/pipeline, settings ownership, message and greeting stores/jobs, generated-message follow-up, recovery projections, `providers-and-models.md`, and translation tests                                                      |
| A module/plugin/MCP behavior           | Import validation, command restrictions, runtime transport, device-local permissions, OAuth egress, update/icon safety, lifecycle cleanup, and [`plugins-and-mcp.md`](plugins-and-mcp.md)                                                           |
| An import/export or restore format     | Lineage/revision effects, asset reporting, bounded decoding, greeting/request-history policy, safety snapshots, fixtures, and [`assets-and-saves.md`](assets-and-saves.md)                                                                        |
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
