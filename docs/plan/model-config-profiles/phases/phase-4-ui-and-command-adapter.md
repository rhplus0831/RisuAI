# Phase 4: UI & Command Adapter

Status: not started.

Goal: adapt the settings UI and commands to the profile mental model while
persisted writes still target existing settings fields.

## Scope

- Extract the current role edit surface into reusable role/profile editor
  components.
- Let `ModelRoleList.svelte` display resolved profile summaries and edit role
  model/options through the compatibility adapter.
- Move or mirror provider-specific panels from `BotSettings.svelte` into the
  editor where appropriate, without hiding global controls still required by
  legacy fields.
- Preserve server-backed draft behavior in `settingsBridge.svelte.ts` and
  `routes/commands.ts`.
- Update model preset and prompt preset UI to use the effective composition
  contract from Phase 3.
- Update language strings under `src/lang`.

## Anchors

- `src/lib/Setting/Pages/Model/ModelRoleList.svelte`
- `src/lib/Setting/Pages/BotSettings.svelte`
- `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte`
- `src/lib/Setting/Pages/PromptSettings.svelte`
- `src/lib/UI/ModelList.svelte`
- `src/lib/UI/ModelGrid.svelte`
- `src/ts/server/settingsBridge.svelte.ts`
- `server/fastify/src/routes/commands.ts`
- `src/ts/presetSplit.ts`
- `src/ts/loadout.ts`
- `src/lang/*`

## UI Contract

- The first model settings screen should show roles and their resolved model
  configuration summary.
- Editing a role should make the selected model and its associated options feel
  like one configuration unit, even though writes still map to flat fields.
- Editing a model/provider selection should reveal only relevant provider and
  runtime options.
- Users should be able to configure separate main and auxiliary Custom API
  settings through the UI path once the underlying compatibility adapter can
  express them.
- Existing model presets should remain understandable during compatibility.

## Exit Criteria

- Role editor no longer depends solely on global provider panels for
  role-adjacent options.
- `BotSettings.svelte` no longer uses "any effective role model uses provider X"
  as the only way to decide which provider options can be edited.
- Settings commands validate the fields the adapted UI writes.
- New UI strings are localized.

## Validation

```bash
pnpm exec vitest run src/lib/Setting/Pages/Model/ModelRoleList.svelte.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts src/lib/Setting/Pages/CustomGUISettingMenu.svelte.test.ts src/ts/server/settingsBridge.svelte.test.ts src/ts/loadout.test.ts src/lang/index.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```

Add browser smoke with `pnpm dev:agent` if the phase changes the live
role/profile editing workflow.

## Risks

- Moving provider panels too early can hide settings that old flat consumers
  still require. Keep compatibility visibility until runtime adoption is done.
- Profile editing can become visually dense. Prefer contextual provider panels
  over placing every possible option in one drawer.
