# Phase 7: Verification & Cleanup

Status: complete.

Goal: close the model config profiles workstream with focused regression,
browser smoke, documentation updates, compatibility cleanup, and TypeScript
proof.

## Scope

- Ran focused resolver, settings, masking, preset, generation, memory,
  auxiliary, and UI tests added during phases 0-6.
- Ran the Fastify provider and generation route test matrix.
- Ran Fastify browser smoke for boot, projection, command refresh, and basic
  visible settings flows.
- Audited remaining legacy flat field usage and documented why compatibility
  branches remain.
- Updated docs under `docs/structure/` and `src/docs/` to describe durable
  profiles.
- Updated `latest-verification.md`, `status.md`, and `SOLVE-NOTE.md`.

## Anchors

- `rg "aiModel|subModel|modelRoles|forceReplaceUrl|proxyKey|customProxyRequestModel|openrouterRequestModel|nanogptRequestModel|ollama" src server/fastify`
- `docs/structure/providers-and-models.md`
- `src/docs/svelte-ui.md`
- `src/docs/client-runtime.md`
- `server/fastify/__tests__`
- `src/ts/process/__fixtures__`
- `docs/plan/model-config-profiles/latest-verification.md`
- `docs/plan/model-config-profiles/status.md`

## Suggested Final Matrix

Final matrix:

```bash
pnpm exec vitest run src/ts/model/modelProfileRecords.test.ts src/ts/model/modelProfileResolver.test.ts src/ts/model/modelProfileUiState.test.ts src/ts/model/modelRoles.test.ts
pnpm exec vitest run src/ts/storage/database.svelte.test.ts src/ts/server/commands.test.ts src/ts/presetSplit.test.ts src/ts/loadout.test.ts src/lib/Setting/Pages/Model/ModelRoleList.svelte.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts src/lang/index.test.ts
pnpm exec vitest run src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts src/ts/process/request/tests/serverCompletion.test.ts src/ts/process/request/tests/serverChat.test.ts src/ts/process/request/tests/openaiProfileOptions.test.ts src/ts/process/request/tests/anthropicProfileOptions.test.ts src/ts/process/request/tests/ollamaProfileOptions.test.ts src/ts/process/request/tests/koboldProfileOptions.test.ts src/ts/process/request/tests/cohereHordeOobaLegacyProfileOptions.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/databaseDefaults.test.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/splitPresets.test.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/chatDispatchProfileOptions.test.ts server/fastify/__tests__/memorySummaryModel.test.ts server/fastify/__tests__/memoryEmbeddingModel.test.ts
pnpm smoke:fastify-browser
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Exact pass summaries are recorded in
[`../latest-verification.md`](../latest-verification.md).

## Exit Criteria

- Complete. Final matrix passed.
- Complete. Active runtime dispatch uses durable profile context when present
  and falls back to flat fields for compatibility.
- Complete. Remaining flat fields have documented compatibility purposes.
- Complete. Structure docs explain the new profile data flow.
- Complete. `status.md` marks phases 0-7 complete.
- Complete. `latest-verification.md` records exact command output summary.
- Caveat: browser smoke does not prove durable profile creation/editing through
  a visible authoring UI. Durable profile records can be created or updated
  through settings commands, import, preset, and loadout paths, but the full
  profile editor is deferred.

## Risks

- Provider tests may need stable fake transports for profile-specific endpoints
  and keys to avoid network dependency.
- Browser smoke validates Fastify browser boot/basic settings flows, not the
  deferred durable profile authoring UI.
- Removing flat fields too aggressively can break imported legacy presets,
  copied `data` folders, static/legacy fallback model ids, or settings surfaces
  that still edit compatibility fields.
