# Phase 0: Contract And Schema

Status: not started.

Goal: expand the durable profile data contract so provider-first UI and runtime
defaults can be represented without impersonating legacy flat fields.

## Scope

- Add top-level `providerId` to `ModelProfileRecord`.
- Accept missing `providerId` for compatibility/imported profiles.
- Add first-class provider option fields:
  - `extraHeaders`
  - `additionalParams`
  - `vertex.projectId`
  - `vertex.region`
  - `vertex.clientEmail`
  - `vertex.privateKey`
  - `customApi.tokenizer`
  - `customApi.flags`
- Add raw model fallback rows:
  - `{ mode: 'profile', profileId }`
  - `{ mode: 'model', modelId }`
- Add `modelRuntimeDefaults` using the same runtime option schema as profile
  `runtimeOptions`.
- Add client/server database typing, normalization, defaults, and preset/loadout
  preservation for `modelRuntimeDefaults`.
- Add profile-local secret masking for `providerOptions.vertex.privateKey`.
- Preserve whole-array settings patch compatibility for `modelProfiles` and
  `modelRoleProfiles`.

## Out Of Scope

- Visible UI changes.
- Provider-first resolver semantics.
- Row-oriented commands.
- Conversion algorithm.
- Generation guardrails.

## Anchors

- `src/ts/model/modelProfileRecords.ts`
- `src/ts/model/modelProfileRecords.test.ts`
- `src/ts/storage/database.svelte.ts`
- `src/ts/storage/database.svelte.test.ts`
- `server/fastify/src/databaseDefaults.ts`
- `server/fastify/__tests__/databaseDefaults.test.ts`
- `server/fastify/src/providerSecrets.ts`
- `server/fastify/__tests__/providerSecrets.test.ts`
- `src/ts/presetSplit.ts`
- `server/fastify/src/commands/splitPresets.ts`
- `src/ts/loadout.ts`

## Exit Criteria

- `modelProfiles` strict readers validate the new fields.
- Normalizers preserve compatible new fields and drop malformed values safely.
- `modelRuntimeDefaults` is present in client/server database shapes and
  preserved through relevant settings/preset/loadout paths.
- Vertex private keys are masked and restored by stable profile id.
- Focused schema/default/masking tests pass.

## Validation

```bash
pnpm exec vitest run src/ts/model/modelProfileRecords.test.ts src/ts/storage/database.svelte.test.ts src/ts/loadout.test.ts src/ts/presetSplit.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/databaseDefaults.test.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/splitPresets.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```

## Risks

- Adding `providerId` too strictly can break old/imported profiles. Keep it
  required for editor-authored rows but optional for compatibility rows.
- Runtime-default preservation touches many import/preset/loadout paths.
- Nested secret masking must preserve array row identity by profile `id`.

