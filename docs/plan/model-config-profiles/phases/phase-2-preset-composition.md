# Phase 2: Preset Composition

Status: complete.

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

## Implemented Slice

- Added shared pure composition helpers in `src/ts/presetSplit.ts`:
  - `composeEffectivePresetSettings({ base, modelPreset, promptPreset, scope })`
  - `applyEffectivePresetComposition(target, { modelPreset, promptPreset, scope })`
- Supported two scopes:
  - `full-generation`: base database, selected model preset, prompt text fields
    and regex aliases, prompt parameter overrides when
    `overrideModelParameters === true`, and Prompt Others overrides.
  - `model-runtime`: base database, selected model preset, prompt model
    parameter overrides when enabled, and Prompt Others overrides, while
    excluding prompt text and regex fields.
- Replaced the duplicate browser server-prompt preflight model-runtime merge in
  `src/ts/process/request/serverPromptAssembly.ts`.
- Replaced Fastify effective-generation model/prompt preset application in
  `server/fastify/src/prompt/effectiveGenerationConfig.ts` while preserving the
  existing `moduleIntergration`, `presetRegex`, persona, and sidebar behavior.
- Added focused pure composition tests for precedence, disabled/enabled prompt
  parameter overrides, Prompt Others role/separate/fallback precedence, regex
  alias handling, model-runtime exclusions, and clone isolation.

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
  order: passed.
- Existing split model/prompt preset tests cover role, fallback, provider, and
  runtime option composition: passed through the new focused
  `src/ts/presetSplit.test.ts` coverage plus retained server assembly and
  generation chat coverage.
- Later profile storage can plug into the same composition path without
  rewriting dispatch code again: passed for the current flat-settings
  compatibility path.

## Validation

```bash
pnpm exec vitest run src/ts/presetSplit.test.ts src/ts/loadout.test.ts src/ts/server/settingsBridge.svelte.test.ts src/ts/process/request/tests/serverChat.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/commands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Latest Phase 2 run:

```bash
pnpm exec vitest run src/ts/presetSplit.test.ts src/ts/process/request/tests/serverPromptAssembly.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/generation.chat.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Results:

- Focused preset composition and browser server-prompt preflight tests: passed,
  2 files / 35 tests.
- Fastify assemble and generation chat tests: passed, 2 files / 183 tests.
- Client-lib TypeScript: passed.
- Server strict TypeScript: passed.

## Risks

- If preset composition remains duplicated, a profile can resolve differently in
  browser preflight and Fastify dispatch.
- Prompt preset parameter overrides must still beat model presets where that is
  current behavior.
