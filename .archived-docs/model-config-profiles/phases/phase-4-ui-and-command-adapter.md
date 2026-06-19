# Phase 4: UI & Command Adapter

Status: complete.

Goal: adapt the settings UI and commands to the profile mental model while
persisted writes still target existing settings fields.

## Completed Slices

- `ModelRoleList.svelte` now displays resolved model profile summaries from
  flat drafts plus `DBState`, with language/test coverage.
- `BotSettings.svelte` provider visibility now consumes
  `modelProfileUiState` resolved profiles, so visibility follows the resolved
  profile UI state rather than only scanning effective role model ids.
- Split-preset command create/patch/apply paths now normalize `modelRoles`,
  `seperateModels`, `fallbackModels`, and `seperateParameters` for model and
  prompt preset flows.
- The model role editor drawer is extracted into `ModelRoleEditor`, keeping the
  role editor surface reusable for later profile-facing work.

## Deferrals

- Provider panels remain global/flat for compatibility. Moving or mirroring
  provider-specific panels further is deferred until Phase 5/6 boundaries are
  safer.
- UI writes still target existing flat settings fields. Durable
  `modelProfiles` and `profileBindings` storage is intentionally deferred until
  Phase 6.
- Custom model catalog, secret masking, memory, translation, scripts, MCP,
  playground, fallback, and tool surfaces move to Phase 5 hardening.

## Scope

- Extract the current role edit surface into reusable role/profile editor
  components.
- Let `ModelRoleList.svelte` display resolved profile summaries and edit role
  model/options through the compatibility adapter.
- Move or mirror provider-specific panels from `BotSettings.svelte` only where
  safe, without hiding global controls still required by legacy fields.
- Preserve server-backed draft behavior in `settingsBridge.svelte.ts` and
  `routes/commands.ts`.
- Update model preset and prompt preset UI/commands to respect the effective
  composition contract from Phase 3.
- Update language strings under `src/lang`.

## Anchors

- `src/lib/Setting/Pages/Model/ModelRoleList.svelte`
- `src/lib/Setting/Pages/Model/ModelRoleEditor.svelte`
- `src/lib/Setting/Pages/BotSettings.svelte`
- `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte`
- `src/lib/Setting/Pages/PromptSettings.svelte`
- `src/lib/UI/ModelList.svelte`
- `src/lib/UI/ModelGrid.svelte`
- `src/ts/model/modelProfileUiState.ts`
- `src/ts/server/settingsBridge.svelte.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/commands/splitPresets.ts`
- `src/ts/presetSplit.ts`
- `src/ts/loadout.ts`
- `src/lang/*`

## UI Contract

- The first model settings screen should show roles and their resolved model
  configuration summary.
- Editing a role should make the selected model and its associated options feel
  like one configuration unit, even though writes still map to flat fields.
- Editing a model/provider selection should reveal relevant provider and
  runtime options through compatibility visibility.
- Existing model presets should remain understandable during compatibility.

## Exit Criteria

- Resolved profile summaries appear on the role settings surface.
- `BotSettings.svelte` visibility is backed by resolved profile UI state.
- Settings commands normalize the split role fields the adapted UI and preset
  paths write.
- New UI strings are localized.

## Validation

Phase 4 proof is recorded in
[`../latest-verification.md`](../latest-verification.md).

Relevant focused commands for future regressions:

```bash
pnpm exec vitest run src/lib/Setting/Pages/Model/ModelRoleList.svelte.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts src/ts/model/modelProfileUiState.test.ts src/lang/index.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/splitPresets.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```

Use `pnpm dev:agent` browser smoke when changing the live role/provider editing
workflow, and stop it before finishing.

## Risks

- Moving provider panels too early can hide settings that old flat consumers
  still require. Keep compatibility visibility until Phase 5/6 provides a safe
  move or mirror path.
- Profile editing can become visually dense. Prefer contextual provider panels
  over placing every possible option in one drawer.
