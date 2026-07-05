# Latest Verification

Date: 2026-07-05

Verification level: Phase 2 focused command/projection/client-wrapper tests.

## What Was Checked

- Read `STRUCTURE.md`, the Agent Preset workstream README, status, plan,
  latest verification, phase index, Phase 0, Phase 1, Phase 2, and relevant
  backend/projection structure notes before implementation.
- Added settings-backed Agent Preset command helpers in
  `server/fastify/src/commands/agentPresets.ts`.
- Added authenticated, active-writer-protected command routes for Agent Preset
  create/update/duplicate/delete/reorder/default and step
  create/update/duplicate/delete/reorder.
- Added command-event catalog entries plus `agentPreset` and
  `agentPresetDeleted` targeted projection resources.
- Added browser command wrappers in `src/ts/server/commands.ts` and a small
  command-backed local helper module in `src/ts/agentPresets.ts`.
- Checked create/update/default/reorder projection behavior, step validation,
  duplicate preset/step id remapping, delete cleanup across defaults/chats/
  loadouts, and the explicit no-migration rule for Context Agent fields.
- Re-ran existing Agent Preset record/resolver tests to guard Phase 0/1
  invariants.

## Result

- Phase 2 implementation is complete.
- Agent Presets can be mutated through command-backed APIs and refreshed through
  targeted projection resources.
- Chat and loadout Agent Preset references survive normal commands and are
  cleared atomically when their selected Agent Preset is deleted.
- Browser code has typed command wrappers and local rollback-aware helper
  functions ready for the Settings/chat-selection UI shell.
- Context Agent remains live for legacy `{{agent}}` and `{{slot::agent}}`
  behavior until later cleanup phases, and no Context Agent fields are converted
  into Agent Presets.

## Commands Run

- `pnpm exec prettier --write docs/agent-preset-plan/status.md docs/agent-preset-plan/latest-verification.md server/fastify/src/commands/agentPresets.ts server/fastify/src/commands/events.ts server/fastify/src/routes/commands.ts server/fastify/src/routes/projection.ts src/ts/server/commands.ts src/ts/agentPresets.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/projection.test.ts src/ts/server/commands.test.ts`
- `pnpm exec tsc -b tsconfig.client-lib.json server/fastify/tsconfig.json --pretty false`
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/projection.test.ts`
- `pnpm exec vitest run src/ts/server/commands.test.ts src/ts/agentPresetRecords.test.ts src/ts/agentPresetResolver.test.ts`
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
