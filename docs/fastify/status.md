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
- Last landed slice: 8-7e, `hypav3-memory` fixture parity.
- Current gap: the live server path has summarize/embed handlers and
  memory read/job/browser surfaces, but it does not yet call the
  chunk-planning helper; the default `chunk` job handler is still a no-op.
- Next default pickup: 8-8, live chunk-planning hook.
- Last recorded full baselines after 8-7e: `pnpm check` clean,
  `pnpm test` 652 tests plus 4 skipped, `pnpm api:test` 1048 tests, and
  `pnpm build` passing with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.
- Focused verification after 8-7e:
  `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
  passed with 27 tests;
  `pnpm exec vitest run src/ts/process/request/tests/serverMemory.test.ts`
  passed with 12 tests; and
  `pnpm exec vitest run server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/promptMemoryAdapter.test.ts --config server/fastify/vitest.config.ts`
  passed with 52 tests. Full verification also passed.

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
| Hypa V3 memory                              | Active; next slice is 8-8 live chunk-planning hook.                          |
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
