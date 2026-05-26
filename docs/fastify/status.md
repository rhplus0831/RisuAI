# Migration Status

Date: 2026-05-26

This is the live Fastify migration handoff: current pickup state,
blockers, and links to the detailed runbook.

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

Completed phase detail and old landed-slice logs live in
[`phases-completed/`](phases-completed/).

## Current Snapshot

- Active phase: Phase 9, Client thinning.
- Last landed work: 9-6e provider secret masking. Fastify bootstrap masks
  provider/media/memory secret fields before returning the browser projection,
  and settings commands preserve masked placeholders while accepting explicit
  replacement secrets.
- Current gap: server-side `.risu` codec core can start now that the
  server-backed browser projection no longer exposes provider secrets.
- Next default pickup: 9-7a, `.risu` fixture corpus and codec harness.
- Last recorded focused baselines after 9-6e: `pnpm check` clean and
  focused Fastify bootstrap/command tests passed. Last full client test
  command, `pnpm api:test`, and `pnpm build` baselines remain the 9-6c
  records.

## Start Here

- [`status/next-steps.md`](status/next-steps.md) - exact next slice and
  verification commands.
- [`status/phase-9-command-map.md`](status/phase-9-command-map.md) -
  locked Phase 9 mutation inventory and command map.
- [`phases/phase-9-client-thinning.md`](phases/phase-9-client-thinning.md) -
  active Phase 9 scope, boundaries, and slice plan.
- [`phases/phase-8-memory.md`](phases/phase-8-memory.md) - closed Phase
  8 summary and exit criteria.
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
| Hypa V3 memory                              | Closed; closeout notes archived.                                             |
| Client thinning                             | Active; 9-6e landed; continue with 9-7a `.risu` codec fixtures.              |

## Maintenance Rules

- Keep this file short: last done, current blocker, next pickup, and links.
- Keep the no-compatibility-migrations policy visible while there are no
  actual Fastify users.
- Put the actionable runbook in [`status/next-steps.md`](status/next-steps.md).
- Put completed logs and old status snapshots in
  [`phases-completed/`](phases-completed/).
- Keep phase files focused on remaining work and closeout summaries, not
  landed-slice history.
