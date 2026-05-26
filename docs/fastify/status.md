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
- Last landed work: 9-7d decode normalization and validation. The server now
  has a pure `.risu` import snapshot normalizer that consumes production legacy
  and RISUSAVE block codecs, assembles block saves into current Phase 9
  resource shapes, runs command-owned stable-id normalizers, validates
  malformed decoded rows, and preserves remote/cache-only unsupported-reference
  reports without repository or browser-storage access.
- Current gap: repository-backed export snapshots are not built from server
  persistence yet.
- Next default pickup: 9-7e, repository-backed export adapter.
- Last recorded focused baselines after 9-7d: focused Fastify
  `risuSaveCodec.test.ts` passed with 16 tests and `pnpm check` clean.
  Broader baselines remain: 9-6c for full client/API test commands and
  `pnpm check`, and 9-5d for the last full `pnpm build`.

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

| Workstream                                  | State                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Removals                                    | Closed; historical detail archived.                                     |
| Fastify server foundation / storage / proxy | Closed; Fastify owns the live server path.                              |
| Server-side generation                      | Closed for `/completion`; remaining provider flattening stays deferred. |
| Server-side prompt assembly                 | Closed; closeout notes archived.                                        |
| Hypa V3 memory                              | Closed; closeout notes archived.                                        |
| Client thinning                             | Active; 9-7d landed; continue with 9-7e export adapter.                 |

## Maintenance Rules

- Keep this file short: last done, current blocker, next pickup, and links.
- Keep the no-compatibility-migrations policy visible while there are no
  actual Fastify users.
- Put the actionable runbook in [`status/next-steps.md`](status/next-steps.md).
- Put completed logs and old status snapshots in
  [`phases-completed/`](phases-completed/).
- Keep phase files focused on remaining work and closeout summaries, not
  landed-slice history.
