# Phase 9 Client Thinning - 9-5d-i

Date: 2026-05-26

## Scope

Settings residual command sweep. This sub-slice covered server-backed web
writes to keys already mapped by `SERVER_SETTINGS_GROUP_BY_KEY` and kept
dedicated resource families on their existing command bridges.

## Landed

- Added residual settings watchers for manual provider/runtime/display/
  media/advanced pages and custom components, including `NAIsettings`,
  `ainconfig`, `localStopStrings`, `modelTools`, `customModels`,
  `banCharacterset`, `colorScheme`, `customTextTheme`, `useLegacyGUI`,
  `hideApiKey`, and `showUnrecommended`.
- Left prompt template/items, personas, translator presets, plugin
  provider selection, modules, import/export, storage, and asset byte
  paths under their dedicated command or later-slice ownership.
- Added focused command-helper coverage proving residual manual settings
  still group through the existing settings command endpoints.

## Verification

```bash
pnpm exec vitest run src/ts/server/commands.test.ts
pnpm check
```

Results:

- `src/ts/server/commands.test.ts` - 35 tests passed.
- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.

## Handoff

Continue with **9-5d-ii - 9-2 resource UI tails**. Focus on prompt
templates/items, personas, translator presets, and loadouts. Treat
remaining direct assignments in those areas as optimistic local updates
only when they are followed by the existing resource command plus
rollback; otherwise route them through the existing 9-2 command helpers.
