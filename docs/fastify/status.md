# Migration Status

Date: 2026-05-25

This is the live Fastify migration handoff: current pickup state,
blockers, and links to the detailed runbook.

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

Completed phase detail and old landed-slice logs live in
[`phases-completed/`](phases-completed/).

## Current Snapshot

- Active phase: Phase 8, Hypa V3 memory.
- Last landed slice: 8-8, live chunk-planning hook.
- Current gap: Phase 8 needs closeout verification and handoff cleanup
  before Phase 9 client thinning starts.
- Next default pickup: 8-9, Phase 8 closeout.
- Last recorded full baselines after 8-8: `pnpm check` clean,
  `pnpm test` 652 tests plus 4 skipped, `pnpm api:test` 1050 tests, and
  `pnpm build` passing with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.
- Focused verification after 8-8:
  `pnpm exec vitest run server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/memoryChunkPlanner.test.ts --config server/fastify/vitest.config.ts`
  passed with 50 tests. Full verification also passed.

## Start Here

- [`status/next-steps.md`](status/next-steps.md) - exact next slice and
  verification commands.
- [`phases/phase-8-memory.md`](phases/phase-8-memory.md) - active Phase
  8 scope, boundaries, and slice plan.
- [`status/server.md`](status/server.md) - current Fastify route surface.
- [`status/sendchat.md`](status/sendchat.md) - current `sendChat`
  boundary and fixture guardrails.
- [`coverage/providers.md`](coverage/providers.md) - provider dispatch
  matrix.

## Current Workstreams

| Workstream                                  | State                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| Removals                                    | Closed; historical detail archived.                                          |
| Fastify server foundation / storage / proxy | Closed; Fastify owns the live server path.                                   |
| Server-side generation                      | Closed for `/completion`; remaining provider flattening stays deferred.      |
| Server-side prompt assembly                 | Closed; closeout notes archived.                                             |
| Hypa V3 memory                              | Active; next slice is 8-9 Phase 8 closeout.                                  |
| Client thinning                             | Not started; waits for server-owned prompt, generation, and memory surfaces. |

## Maintenance Rules

- Keep this file short: last done, current blocker, next pickup, and links.
- Keep the no-compatibility-migrations policy visible while there are no
  actual Fastify users.
- Put the actionable runbook in [`status/next-steps.md`](status/next-steps.md).
- Put completed logs and old status snapshots in
  [`phases-completed/`](phases-completed/).
- Keep phase files focused on remaining work and closeout summaries, not
  landed-slice history.
