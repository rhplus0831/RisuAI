# Phase 2: Preset Composition

Status: not started.

Goal: centralize the effective model settings merge order so profiles, legacy
fields, model presets, and prompt presets cannot apply in different orders on
client and server paths.

## Scope

- Extract or formalize one effective generation settings composition path:
  base database, selected model preset, selected prompt preset overrides, and
  prompt "Others" overrides.
- Make client preflight and server chat assembly use the same composition
  contract before resolving profiles.
- Preserve legacy bot presets and split preset behavior.
- Preserve `doNotChangeSeperateModels`, `doNotChangeFallbackModels`, model
  preset request-model fields, prompt preset parameter overrides, and loadout
  application semantics.
- Add tests that prove preset composition before Phase 3 dispatch migration,
  Phase 4 UI changes, and Phase 6 durable profile storage.

## Anchors

- `server/fastify/src/prompt/effectiveGenerationConfig.ts`
- `src/ts/storage/database.svelte.ts`
- `src/ts/presetSplit.ts`
- `server/fastify/src/commands/splitPresets.ts`
- `server/fastify/src/routes/generation.ts`
- `src/ts/process/request/serverPromptAssembly.ts`
- `src/ts/loadout.ts`
- `src/ts/server/settingsBridge.svelte.ts`

## Composition Contract

- Model preset values apply after the base database.
- Prompt preset model/runtime overrides apply after the selected model preset.
- Prompt "Others" overrides keep their existing precedence.
- Role and fallback override fields must have deterministic behavior when both
  legacy fields and future profile bindings are present.
- The resolver should receive already-composed effective settings unless Phase 0
  records a stronger reason to compose inside the resolver.

## Exit Criteria

- Browser preflight and server prompt assembly share one documented composition
  order.
- Existing split model/prompt preset tests cover role, fallback, provider, and
  runtime option composition.
- Later profile storage can plug into the same composition path without
  rewriting dispatch code again.

## Validation

```bash
pnpm exec vitest run src/ts/presetSplit.test.ts src/ts/loadout.test.ts src/ts/server/settingsBridge.svelte.test.ts src/ts/process/request/tests/serverChat.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/commands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Risks

- If preset composition remains duplicated, a profile can resolve differently in
  browser preflight and Fastify dispatch.
- Prompt preset parameter overrides must still beat model presets where that is
  current behavior.
