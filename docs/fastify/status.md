# Migration Status

Date: 2026-05-24

This is the live Fastify migration handoff. It replaces the former root
handoff and roadmap files, which were removed so this status tree is the
single place for current pickup state.

Completed phase detail and old landed-slice logs live in
[`phases-completed/`](phases-completed/).

## Current Snapshot

- Active phase: Phase 8, Hypa V3 memory.
- Last landed slice: 8-1a-i, migration runner + version bump.
- Current blocker: none recorded.
- Next default pickup: 8-1a-ii, memory tables on top of the runner.
- Last recorded full baselines after 8-1a-i: `pnpm check` clean,
  `pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 900 tests, and
  `pnpm build` passing with existing CSS `::highlight`, browser
  externalization, plugin-timing, and bundle-size warnings.
- Focused verification after 8-1a-i:
  `pnpm exec vitest run server/fastify/__tests__/db.test.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/smoke.test.ts --config server/fastify/vitest.config.ts`
  passed.

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
| Hypa V3 memory                              | Active; next slice is 8-1a-ii memory tables on top of the runner.            |
| Client thinning                             | Not started; waits for server-owned prompt, generation, and memory surfaces. |

## Maintenance Rules

- Keep this file short: last done, current blocker, next pickup, and links.
- Put the actionable runbook in [`status/next-steps.md`](status/next-steps.md).
- Put completed logs and old status snapshots in
  [`phases-completed/`](phases-completed/).
- Keep phase files focused on remaining work and closeout summaries, not
  landed-slice history.
