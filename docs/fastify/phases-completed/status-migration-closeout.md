# Migration Status

Date: 2026-05-27

This is the original Fastify migration closeout snapshot. The
first post-closeout audit is archived in
[`status-followup-closeout.md`](status-followup-closeout.md). The
current live status is [`../status.md`](../status.md).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

Completed phase detail and old landed-slice logs live in this directory.

## Current Snapshot

- Original migration phase: none. Phase 9, Client thinning, was closed
  for the Fastify-served web scope in `edbc2d07`.
- Active handoff: none open. The second-pass alpha audit is closed in
  [`../status.md`](../status.md).
- First follow-up closeout: Phase 3 Slice 3A aligned stream-job proxy
  headers with direct proxy output in `e92e2d7e`.
- Latest alpha trail: `0c429fe8` closed Phase 6 CRLF SSE handling,
  `cf830b9e` closed Phase 9B projection-write tails, `bd7a4712`
  restored the Phase 5 `sendChat` boundary, and `50d55b97` closed the
  broad typecheck blocker and verification matrix.
- Tauri / Desktop manual verification remains deferred and should not
  be folded back into the original Phase 9 closeout.
- Last original closeout baselines are archived in
  [`phase-9-client-thinning-9-9e.md`](phase-9-client-thinning-9-9e.md):
  Fastify browser smoke, focused client/server suites, `pnpm check`,
  `pnpm tauribuild`, and Fastify-served manual command flow passed during
  9-9d/9-9e.

## Start Here

- [`status-next-steps-migration-closeout.md`](status-next-steps-migration-closeout.md) -
  original handoff and closeout verification notes.
- [`../status/next-steps.md`](../status/next-steps.md) -
  current next-steps runbook.
- [`status-followup-next-steps.md`](status-followup-next-steps.md) -
  first follow-up archive and reference verification commands.
- [`../status/phase-9-command-map.md`](../status/phase-9-command-map.md) -
  locked Phase 9 mutation inventory and command map.
- [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md) -
  closed Phase 9 scope, boundaries, and slice plan.
- [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md) - closed Phase
  8 summary and exit criteria.
- [`../status/server.md`](../status/server.md) - current Fastify route surface.
- [`../status/sendchat.md`](../status/sendchat.md) - current `sendChat`
  boundary and fixture guardrails.
- [`../coverage/providers.md`](../coverage/providers.md) - provider dispatch
  matrix.

## Current Workstreams

| Workstream                                  | State                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Removals                                    | Closed; historical detail archived.                                                      |
| Fastify server foundation / storage / proxy | Closed; Fastify owns the live server path and proxy header follow-up is closed.          |
| Server-side generation                      | Closed for `/completion`; streaming error follow-up is closed and provider flattening stays deferred. |
| Server-side prompt assembly                 | Closed; follow-up regenerate/provider/stop-trigger/fixture gaps closed again 2026-05-27. |
| Hypa V3 memory                              | Closed; custom embedding, progress event, and missing-summary follow-up closed again 2026-05-27. |
| Client thinning                             | Closed for Fastify web; direct-write follow-up closed again 2026-05-27.                  |
| Alpha broad closeout                        | Closed; `pnpm check` and the full broad matrix passed in `50d55b97`. |

## Maintenance Rules

- Keep this file short: last done, current pickup, and links.
- Keep the no-compatibility-migrations policy visible while there are no
  actual Fastify users.
- Put the original runbook in [`status-next-steps-migration-closeout.md`](status-next-steps-migration-closeout.md);
  current status lives in [`../status.md`](../status.md).
- Put completed logs and old status snapshots in this directory.
- Keep phase files focused on remaining work and closeout summaries, not
  landed-slice history.
