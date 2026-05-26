# Migration Status

Date: 2026-05-27

This is the original Fastify migration closeout snapshot. The active
post-closeout audit handoff now lives in
[`../fastify-followup/status.md`](../fastify-followup/status.md).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

Completed phase detail and old landed-slice logs live in
[`phases-completed/`](phases-completed/).

## Current Snapshot

- Original migration phase: none. Phase 9, Client thinning, was closed
  for the Fastify-served web scope in `edbc2d07`.
- Active handoff: audit follow-up for Phases 0, 3, 6, and 8 in
  [`../fastify-followup/`](../fastify-followup/). Phase 7 follow-up
  closed again at `e7425ab1`; Phase 9 follow-up closed again at
  `67a9dab4`.
- Latest follow-up pickup: Phase 8 Slice 8A, stable custom embedding job
  model key, in
  [`../fastify-followup/status/next-steps.md`](../fastify-followup/status/next-steps.md).
- Tauri / Desktop manual verification remains deferred and should not
  be folded back into the original Phase 9 closeout.
- Last original closeout baselines are archived in
  [`phases-completed/phase-9-client-thinning-9-9e.md`](phases-completed/phase-9-client-thinning-9-9e.md):
  Fastify browser smoke, focused client/server suites, `pnpm check`,
  `pnpm tauribuild`, and Fastify-served manual command flow passed during
  9-9d/9-9e.

## Start Here

- [`status/next-steps.md`](status/next-steps.md) - original handoff and
  original closeout verification notes.
- [`../fastify-followup/status/next-steps.md`](../fastify-followup/status/next-steps.md) -
  active follow-up pickup order.
- [`status/phase-9-command-map.md`](status/phase-9-command-map.md) -
  locked Phase 9 mutation inventory and command map.
- [`phases/phase-9-client-thinning.md`](phases/phase-9-client-thinning.md) -
  closed Phase 9 scope, boundaries, and slice plan.
- [`phases/phase-8-memory.md`](phases/phase-8-memory.md) - closed Phase
  8 summary and exit criteria.
- [`status/server.md`](status/server.md) - current Fastify route surface.
- [`status/sendchat.md`](status/sendchat.md) - current `sendChat`
  boundary and fixture guardrails.
- [`coverage/providers.md`](coverage/providers.md) - provider dispatch
  matrix.

## Current Workstreams

| Workstream                                  | State                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Removals                                    | Closed; historical detail archived.                                                      |
| Fastify server foundation / storage / proxy | Closed; Fastify owns the live server path.                                               |
| Server-side generation                      | Closed for `/completion`; remaining provider flattening stays deferred.                  |
| Server-side prompt assembly                 | Closed; follow-up regenerate/provider/stop-trigger/fixture gaps closed again 2026-05-27. |
| Hypa V3 memory                              | Original Phase 8 closed; audit follow-up remains active in `docs/fastify-followup`.      |
| Client thinning                             | Closed for Fastify web; direct-write follow-up closed again 2026-05-27.                  |

## Maintenance Rules

- Keep this file short: last done, current blocker, next pickup, and links.
- Keep the no-compatibility-migrations policy visible while there are no
  actual Fastify users.
- Put the actionable runbook in [`status/next-steps.md`](status/next-steps.md).
- Put completed logs and old status snapshots in
  [`phases-completed/`](phases-completed/).
- Keep phase files focused on remaining work and closeout summaries, not
  landed-slice history.
