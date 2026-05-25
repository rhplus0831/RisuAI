# Phase 9 Client Thinning - 9-2a-i Scalar Settings Commands

Date: 2026-05-25

9-2a-i is closed. It extends the 9-1 command foundation from the single
runtime harness field to grouped scalar settings commands and wires the
data-driven settings wrappers through the browser command helper in
Fastify mode.

## Landed

- Generalized `PATCH /api/v1/commands/settings/:group` for the scalar
  groups `providers`, `runtime`, `display`, `language`, `media`,
  `memory`, `advanced`, `sidebar`, and `account`.
- Added grouped allowlist validation, representative value-type checks,
  JSON-safe payload checks, and preserved the existing
  `settings.updated` event plus `baseRevision` / 409 contract.
- Kept provider-key masking out of scope. Provider commands currently
  update unmasked fields directly, as planned for 9-2a before 9-6.
- Added a generic browser `patchSettingsGroup` helper and bootstrap-backed
  command revision cache in `src/ts/server/commands.ts`.
- Routed data-driven settings writes through local draft state plus
  grouped commands in server-backed Fastify mode via
  `src/ts/setting/utils.ts`.
- Converted `SettingSegmented.svelte` away from direct `DBState.db`
  binding so segmented data-driven settings use the same command-aware
  write path as check, select, text, number, slider, color, and textarea
  wrappers.

## Covered

- Runtime harness compatibility through `/settings/runtime`.
- Display settings success and bootstrap visibility.
- Provider scalar settings success with unmasked keys.
- Unknown setting key validation with no revision bump.
- Unsupported settings group validation.
- Browser helper grouped path, auth header, body shape, conflict handling,
  error handling, unavailable behavior, and bootstrap revision caching.

## Still In 9-2a

- Manual scalar settings pages still contain direct `DBState.db` binds or
  assignments and need the next 9-2a continuation slice. Start with:
  `BotSettings.svelte`, `OtherBotSettings.svelte`,
  `OpenrouterSettings.svelte`, `OobaSettings.svelte`,
  `SeparateParametersSection.svelte`, `Model/AuxModelSelectors.svelte`,
  `Others/ProTools/EasyPanel.svelte`, first-run setup in
  `WelcomeRisu.svelte`, and miscellaneous scalar preference panels.
- Prompt template/items, bot presets, personas, translator presets, and
  loadouts remain deferred to 9-2b through 9-2f.
- Browser projection, event SSE, read-only `DBState.db`, storage gating,
  provider-key masking, and server `.risu` codec remain deferred.

## Verification

Passed:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Results:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 659 tests passed, 4 skipped.
- `pnpm api:test` - 1060 tests passed.
- `pnpm build` - passed with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Continue 9-2a with **9-2a-ii - Manual scalar settings pages**:

- Replace remaining manual server-backed scalar settings writes with
  local draft state plus `patchSettingsGroup`.
- Keep Tauri/local mutation paths intact.
- Keep provider-key masking deferred to 9-6.
- Update the server/client scalar group maps together when adding newly
  routed fields.
