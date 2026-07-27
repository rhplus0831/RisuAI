# Fastify Test Map

This directory is the Node/Vitest lane for the Fastify backend. Run it with:

```sh
pnpm test:server
```

`pnpm api:test` is kept as a compatibility alias.

## Current Buckets

The folder is intentionally still flat so existing relative imports stay stable,
but files should be read and split by these ownership buckets:

| Bucket | Typical files |
| --- | --- |
| Commands and persistence mutations | `commands.test.ts`, `command*.test.ts`, `targetedMutationPaths.test.ts`, `messageStore.test.ts`, `repositoryWriterKit.test.ts`, `splitPresets.test.ts`, `greetingTranslationStore.test.ts` |
| Generation and prompt assembly | `generation.*.test.ts`, `assemble.test.ts`, `agentPresetExecution.test.ts`, `preflight.test.ts`, `budgetFinalize.test.ts`, `generationBodyCap.test.ts`, `history.test.ts`, `templates.test.ts`, `scripts.test.ts`, `triggers.test.ts`, `luaRuntime.test.ts`, `plainSections.test.ts`, `staticSections.test.ts` |
| Memory | `memory*.test.ts`, `promptMemoryAdapter.test.ts` |
| Providers and provider transport | `openai*.test.ts`, `anthropic.test.ts`, `bedrock.test.ts`, `cohere.test.ts`, `gemini.test.ts`, `horde.test.ts`, `kobold.test.ts`, `mistral.test.ts`, `ollama.test.ts`, `oobaLegacy.test.ts`, `provider*.test.ts`, `sigv4.test.ts`, `vertexAuth.test.ts`, `chatDispatchProfileOptions.test.ts`, `modelProfileResolver.server.test.ts` |
| Jobs, streams, limits, and observability | `durableGeneration.test.ts`, `stream*.test.ts`, `requestAbort.test.ts`, `payloadBudgets.test.ts`, `requestTrace.test.ts`, `requestHistory.test.ts`, `requestHistoryRoutes.test.ts`, `generationTraceSidecar.test.ts`, `terminalFrameAssertions.test.ts`, `serverLoadCostHarness.test.ts` |
| Assets, saves, imports, backups | `assets.test.ts`, `asset*.test.ts`, `risuSave*.test.ts`, `realmImport.test.ts`, `backups.test.ts` |
| Platform, routes, database, auth | `auth.test.ts`, `bootstrap.test.ts`, `config.test.ts`, `databaseDefaults.test.ts`, `databaseInitialization.test.ts`, `db.test.ts`, `missingDatabaseGuard.test.ts`, `events.test.ts`, `index.test.ts`, `legacyStorage.test.ts`, `resourceReads.test.ts`, `proxy.test.ts`, `hub.test.ts`, `pushNotifications.test.ts`, `static.test.ts`, `routeProtection.test.ts` |

## Cleanup Rule

Prefer splitting a hotspot file before adding another large `describe` block.
Good split targets are files with many unrelated command families or provider
families. Keep shared harness code in `helpers/` when at least two test files use
it.

Avoid broad directory moves unless you are prepared to update relative imports
from `../src/*` and `./helpers/*` throughout the moved files.
