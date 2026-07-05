# Latest Verification

Date: 2026-07-05

Verification level: Phase 0 focused implementation tests.

## What Was Checked

- Read `STRUCTURE.md`, the Agent Preset workstream README, status, plan,
  latest verification, phase index, and Phase 0 file before implementation.
- Added shared Agent Preset record normalization and validation coverage.
- Checked database default/normalization paths on both server and client.
- Checked legacy bot preset create/patch/save-current/apply behavior for Agent
  Preset fields.
- Checked chat generation settings readiness and command validation for absent,
  empty, valid, non-string, and unknown Agent Preset selections.
- Checked loadout snapshot and active-chat apply behavior for Agent Preset
  id/name.
- Confirmed Context Agent runtime/UI paths were not edited in Phase 0.

## Result

- Phase 0 implementation is complete.
- `agentPresets: []` is the default empty durable state.
- Missing or stale `agentPresetDefaultId` is cleared during normalization.
- `ChatGenerationSettings.agentPresetId` and loadout Agent Preset id/name
  fields are carried through typed client/server command surfaces.
- Fastify generation assembly now checks stale Agent Preset selections when the
  preset collection is available.
- Context Agent remains live for legacy `{{agent}}` and `{{slot::agent}}`
  behavior until later cleanup phases.

## Commands Run

- `pnpm exec prettier --write docs/agent-preset-plan/status.md docs/agent-preset-plan/latest-verification.md src/ts/agentPresetRecords.ts src/ts/agentPresetRecords.test.ts src/ts/chatGenerationSettings.ts src/ts/chatGenerationSettings.test.ts src/ts/activeChatGenerationSettings.ts src/ts/activeChatGenerationSettings.test.ts src/ts/loadout.ts src/ts/loadout.test.ts src/ts/server/commands.ts src/ts/server/commands.test.ts src/ts/storage/database.svelte.ts src/ts/storage/database.svelte.test.ts server/fastify/src/databaseDefaults.ts server/fastify/__tests__/databaseDefaults.test.ts server/fastify/src/chatGenerationSettingsStorage.ts server/fastify/src/commands/chats.ts server/fastify/src/commands/loadouts.ts server/fastify/src/commands/presets.ts server/fastify/src/routes/commands.ts server/fastify/src/prompt/effectiveGenerationConfig.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/risuSaveCodec.test.ts server/fastify/__tests__/assemble.test.ts`
- `pnpm exec vitest run src/ts/agentPresetRecords.test.ts src/ts/chatGenerationSettings.test.ts src/ts/activeChatGenerationSettings.test.ts src/ts/loadout.test.ts src/ts/server/commands.test.ts src/ts/storage/database.svelte.test.ts`
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/databaseDefaults.test.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/risuSaveCodec.test.ts server/fastify/__tests__/assemble.test.ts`
- `pnpm exec tsc -b tsconfig.client-lib.json server/fastify/tsconfig.json`
- `git diff --check`

## Required Verification When Implementation Starts

Each phase should update `status.md` and this file with focused proof. The
expected closeout matrix is:

- focused schema/normalizer tests
- resolver/planner tests
- command and projection tests
- frontend UI tests for Settings and chat selection
- prompt assembly tests for `{{agent::name}}`
- regression tests proving `{{agent}}` and `{{slot::agent}}` do not trigger the
  new Agent Preset path
- after-main ordering tests around `editOutput` and `onOutput`
- timeout, optional failure, required failure, and JSON parse failure tests
- client TypeScript checks
- strict Fastify TypeScript checks
- `git diff --check`
- Prettier before commit
- browser smoke with `pnpm dev:agent`, followed by stopping the dev server
