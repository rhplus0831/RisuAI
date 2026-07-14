# Phase 6: Persisted Profiles

Status: complete.

Goal: introduce durable reusable model profile records and role bindings only
after the derived resolver, dispatch, presets, UI adapter, and auxiliary paths
are proven.

## Completed Slices

- `fea509ef6` `feat: scaffold durable model profiles`
- `b7e21fdac` `feat: resolve durable model profile bindings`
- `a16e5b9f4` `feat: preserve model profiles in presets`
- `559553b21` `feat: support profile request models`
- `b42a3cb14` `feat: support profile provider options`
- `534b1918f` `feat: support profile api keys`
- `9235e5850` `feat: support profile runtime options`
- `a7cee559f` `feat: support profile fallback refs`
- `64acf9ab2` `feat: support inherited model profile roles`

## Scope

- Added TypeScript types and validators for durable model profiles, role
  bindings, provider option blocks, runtime option blocks, and fallback profile
  references.
- Added defaults and normalization on both client and server.
- Added settings command validation for profile arrays/maps and role bindings.
- Added provider secret masking and masked-placeholder resolution for
  profile-local `apiKey` values using stable profile ids.
- Preserved durable fields through import/export, bootstrap/projection, selected
  chat generation settings, loadout, and split-preset paths.
- Added read-through compatibility from old flat fields and legacy preset files.
- Kept copied `data` folder and old `.risu` shapes readable during the
  compatibility period.

## Anchors

- `src/ts/storage/database.svelte.ts`
- `server/fastify/src/databaseDefaults.ts`
- `server/fastify/src/routes/commands.ts`
- `src/ts/server/commands.ts`
- `server/fastify/src/providerSecrets.ts`
- `server/fastify/src/routes/bootstrap.ts`
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/commands/presets.ts`
- `src/ts/presetSplit.ts`
- `server/fastify/src/commands/splitPresets.ts`
- `src/ts/loadout.ts`

## Target Shape

The durable implementation supports:

- `modelProfiles`: stable-id collection of profile records with names, selected
  model ids, provider options, runtime options, and fallback profile refs.
- `modelRoleProfiles`: canonical role bindings with legacy, profile, and
  supported inherit modes.
- Profile-local selected/request model data, provider options/endpoints,
  local API key values, and runtime options that directly affect a request.
- Compatibility fallbacks that let the resolver use legacy flat fields when
  durable profile records or bindings are absent.

## Exit Criteria

- Complete. New fields are defaulted and normalized in client and server
  defaults.
- Complete. Settings commands accept and validate new fields.
- Complete. Secret masking handles nested profile API keys with stable profile
  identity.
- Complete. Split preset and loadout code can preserve and apply profile fields.
- Complete. The resolver prefers durable profile records when present and falls
  back to legacy flat fields when absent.
- Complete. Existing flat-field import and legacy preset tests still pass.
- Caveat: durable profile authoring UI is not part of this phase. Current role
  settings show resolved profile summaries and edit legacy flat compatibility
  fields.

## Validation

```bash
pnpm exec vitest run src/ts/storage/database.svelte.test.ts src/ts/server/commands.test.ts src/ts/presetSplit.test.ts src/ts/loadout.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/generation.chat.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Final Phase 7 validation broadened this matrix and passed. See
[`../latest-verification.md`](../latest-verification.md).

## Risks

- Stable profile ids are required for correct profile-local API key masking.
- Settings patch validation should keep using targeted validators for
  request-affecting provider/runtime fields.
- Flat fields remain active compatibility fallbacks. Removing them too
  aggressively can break legacy imports, copied `data` folders, static fallback
  model ids, or settings surfaces that have not moved to durable profile
  authoring.
