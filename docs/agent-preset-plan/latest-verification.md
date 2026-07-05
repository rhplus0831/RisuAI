# Latest Verification

Date: 2026-07-05

Verification level: Phase 1 focused resolver/planner implementation tests.

## What Was Checked

- Read `STRUCTURE.md`, the Agent Preset workstream README, status, plan,
  latest verification, phase index, Phase 0, and Phase 1 files before
  implementation.
- Added shared pure Agent Preset resolver/planner/status helpers in
  `src/ts/agentPresetResolver.ts`.
- Checked absent, missing, disabled, ready, invalid, and model-not-ready
  selected Agent Preset resolution states.
- Checked stable dependency levels, same-phase planning, named output registry,
  max concurrency, estimated call counts, final-output modifier metadata, and
  cross-phase dependency rejection.
- Checked model readiness mapping for inherit-main, selected profile ready,
  selected profile missing, selected profile incomplete, and selected profile
  unsupported.
- Checked deterministic prepared-input scope planning and per-step max-input
  bounds.
- Confirmed Agent Preset planner does not collect inputs or run provider calls.

## Result

- Phase 1 implementation is complete.
- `resolveAgentPresetForChat()` now exposes UI/generation-ready selection
  states without changing live generation behavior.
- `planAgentPreset()` now produces before-main/after-main DAG plans, stable
  dependency levels, prepared-input descriptors, named outputs, final modifier
  metadata, and per-step model readiness.
- Context Agent remains live for legacy `{{agent}}` and `{{slot::agent}}`
  behavior until later cleanup phases.

## Commands Run

- `pnpm exec prettier --write docs/agent-preset-plan/status.md docs/agent-preset-plan/latest-verification.md src/ts/agentPresetResolver.ts src/ts/agentPresetResolver.test.ts`
- `pnpm exec vitest run src/ts/agentPresetResolver.test.ts src/ts/agentPresetRecords.test.ts src/ts/model/modelProfileResolver.test.ts`
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
