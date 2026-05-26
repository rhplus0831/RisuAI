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
- Last landed work: 9-6d residual local cache classification. Fastify-mode
  `.risu` cache/remotes, cold-storage helpers, and Google Search MCP
  credentials now return before local persistence access; runtime-only caches
  remain browser-local.
- Current gap: provider secret masking can now land against the classified
  storage/cache surface.
- Next default pickup: 9-6e, provider secret masking.
- Last recorded focused baselines after 9-6d: `pnpm check` clean and focused
  client tests for RISUSAVE cache, cold storage, and Google Search MCP
  credential gates passed. Last full client test command, `pnpm api:test`, and
  `pnpm build` baselines remain the 9-6c records.

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
| Client thinning                             | Active; 9-6d landed; continue with 9-6e provider secret masking.             |

## Maintenance Rules

- Keep this file short: last done, current blocker, next pickup, and links.
- Keep the no-compatibility-migrations policy visible while there are no
  actual Fastify users.
- Put the actionable runbook in [`status/next-steps.md`](status/next-steps.md).
- Put completed logs and old status snapshots in
  [`phases-completed/`](phases-completed/).
- Keep phase files focused on remaining work and closeout summaries, not
  landed-slice history.
