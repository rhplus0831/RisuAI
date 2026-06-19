# Latest Verification

Date: 2026-06-20

This file records the final validation proof for the model config profiles
workstream.

## Latest Run

- Runtime/code change under test: Phase 6 durable model profiles plus Phase 7
  closeout documentation. Phase 6 landed in these committed slices:
  - `fea509ef6` `feat: scaffold durable model profiles`: added durable profile
    record and role-binding shape, defaults, and normalization.
  - `b7e21fdac` `feat: resolve durable model profile bindings`: taught the
    resolver to prefer durable role/profile bindings and fall back to legacy
    flat fields.
  - `a16e5b9f4` `feat: preserve model profiles in presets`: preserved durable
    profile fields through preset, split-preset, and loadout paths.
  - `559553b21` `feat: support profile request models`: allowed profiles to own
    request/wire model ids separately from selected model ids.
  - `b42a3cb14` `feat: support profile provider options`: moved provider
    option resolution into profile-owned data where present.
  - `534b1918f` `feat: support profile api keys`: added profile-local `apiKey`
    support and masking by stable profile id.
  - `9235e5850` `feat: support profile runtime options`: resolved
    request-affecting runtime settings from profiles.
  - `a7cee559f` `feat: support profile fallback refs`: added fallback profile
    references alongside legacy static fallback model ids.
  - `64acf9ab2` `feat: support inherited model profile roles`: added inherit
    mode for roles that inherit from another profile role.
- Final docs closeout: Phase 6 and Phase 7 are marked complete/closed in the
  plan docs. Structure docs now describe durable profile records, resolver
  behavior, settings validation/defaults, masking, preset/loadout preservation,
  fallback profile refs, inherit mode, and compatibility fallbacks.

## Final Matrix Passed

- `pnpm exec vitest run src/ts/model/modelProfileRecords.test.ts src/ts/model/modelProfileResolver.test.ts src/ts/model/modelProfileUiState.test.ts src/ts/model/modelRoles.test.ts`
  - Result: passed, 4 files / 65 tests.
- `pnpm exec vitest run src/ts/storage/database.svelte.test.ts src/ts/server/commands.test.ts src/ts/presetSplit.test.ts src/ts/loadout.test.ts src/lib/Setting/Pages/Model/ModelRoleList.svelte.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts src/lang/index.test.ts`
  - Result: passed, 7 files / 123 tests.
- `pnpm exec vitest run src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts src/ts/process/request/tests/serverCompletion.test.ts src/ts/process/request/tests/serverChat.test.ts src/ts/process/request/tests/openaiProfileOptions.test.ts src/ts/process/request/tests/anthropicProfileOptions.test.ts src/ts/process/request/tests/ollamaProfileOptions.test.ts src/ts/process/request/tests/koboldProfileOptions.test.ts src/ts/process/request/tests/cohereHordeOobaLegacyProfileOptions.test.ts`
  - Result: passed, 9 files / 119 tests.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/databaseDefaults.test.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/splitPresets.test.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/chatDispatchProfileOptions.test.ts server/fastify/__tests__/memorySummaryModel.test.ts server/fastify/__tests__/memoryEmbeddingModel.test.ts`
  - Result: passed, 9 files / 360 tests.
- `pnpm smoke:fastify-browser`
  - Result: passed, 5 browser smoke tests. The build emitted existing CSS,
    externalized-module, dynamic-import, chunk-size, and Svelte warnings, but
    the command exited 0. This smoke validates Fastify browser boot, projection,
    command refresh, and basic visible settings flows. It does not prove durable
    profile creation/editing through a visible profile authoring UI.
- `pnpm exec tsc -p tsconfig.client-lib.json`
  - Result: passed.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`
  - Result: passed after the client declaration build completed, matching the
    required TypeScript workflow.

## Caveats

- Durable profile authoring UI is not implemented. Current role settings UI
  shows resolved profile summaries and edits legacy flat compatibility fields.
  Durable profile records can be created or updated through settings commands,
  import, preset, and loadout paths, but not through a full visible profile
  editor yet.
- Flat fields remain active compatibility sources and fallbacks for legacy
  imports, copied data, static model bypasses, and settings surfaces that have
  not moved to profile authoring.
- Static and legacy fallback model ids still use flat settings and the
  `staticModel` path. Durable fallback profile refs are supported separately.
- Memory summaries use memory-role profile resolution, but memory embeddings
  remain outside chat profiles on Hypa/Voyage/custom embedding fields.
- Repo-wide `pnpm check` remains outside this closeout proof. Do not record it
  as passing unless it is rerun and verified separately.
