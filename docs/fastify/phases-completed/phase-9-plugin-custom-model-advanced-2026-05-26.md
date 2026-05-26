# Phase 9 Slice 9F - Plugin, Custom Model, Advanced Editors

Date: 2026-05-26

## Scope

Closed the 9F client-thinning slice for plugin settings, custom model
editing, advanced custom setting editors, and plugin command bridges.

## Landed

- `PluginSettings.svelte` no longer relies on raw `DBState.db.plugins`
  argument mutation watchers. Plugin argument edits, enable toggles, and
  delete flows now perform trusted optimistic writes and dispatch plugin
  commands directly.
- Plugin import/update and plugin database/storage bridge writes now wrap
  optimistic projection updates with `withTrustedServerProjectionWrite`.
- Plugin database bridge classification now routes `customModels`,
  `banCharacterset`, `allowAllExtentionFiles`,
  `auxModelUnderModelSettings`, and `pluginDevelopMode` through grouped
  settings commands instead of plugin storage.
- `CustomModelsSettings.svelte` now edits a local
  `createServerBackedSettingDraft('customModels')` draft instead of
  mutating the Fastify projection.
- `BanCharacterSetSettings.svelte` now edits a local
  `createServerBackedSettingDraft('banCharacterset')` draft instead of
  mutating the Fastify projection.
- Client command grouping now includes `allowAllExtentionFiles` and
  `auxModelUnderModelSettings`, matching the Fastify command allowlist.

## Verification

```bash
pnpm exec vitest run src/ts/server/commands.test.ts src/ts/plugins/plugins.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts
pnpm exec svelte-check --tsconfig ./tsconfig.json
```

## Historical Next Pickup

At this slice closeout, Phase 9 Slice 9G was next: character core
profile, media, and basic option editors.
