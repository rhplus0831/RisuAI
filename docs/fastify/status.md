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
- Last landed work: 9-9d manual verification, partial. Automated preflight and
  Fastify-served web checks passed; Tauri desktop manual checks remain pending
  because the Tauri dev webview now launches but stays blocked on the local
  frontend `appVer` initialization error.
- Current gap: Phase 9 still needs Tauri/local manual verification before final
  docs closeout.
- Next default pickup: finish the 9-9d Tauri/local manual verification.
- Last recorded focused baselines after 9-9d: `pnpm smoke:fastify-browser`
  passed with the storage-write audit, the server-backed sendChat fixture
  command selected 65 files and 734 passing tests with 4 skipped, the focused
  memory/generation helper command passed 5 files and 56 tests, the focused
  server `.risu` codec/reference command passed 2 files and 23 tests, the
  focused Fastify import/export/bootstrap command selected the full API suite
  with 68 files and 1162 tests, `pnpm check` was clean, `pnpm tauribuild`
  passed with existing warnings, and the focused local backup command selected
  65 files with 734 passing tests and 4 skipped.
  Broader baselines remain: 9-6c for full client/API test commands and 9-5d
  for the last standalone `pnpm build`.

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

| Workstream                                  | State                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| Removals                                    | Closed; historical detail archived.                                             |
| Fastify server foundation / storage / proxy | Closed; Fastify owns the live server path.                                      |
| Server-side generation                      | Closed for `/completion`; remaining provider flattening stays deferred.         |
| Server-side prompt assembly                 | Closed; closeout notes archived.                                                |
| Hypa V3 memory                              | Closed; closeout notes archived.                                                |
| Client thinning                             | Active; 9-9d Fastify web checks landed; finish Tauri/local manual verification. |

## Maintenance Rules

- Keep this file short: last done, current blocker, next pickup, and links.
- Keep the no-compatibility-migrations policy visible while there are no
  actual Fastify users.
- Put the actionable runbook in [`status/next-steps.md`](status/next-steps.md).
- Put completed logs and old status snapshots in
  [`phases-completed/`](phases-completed/).
- Keep phase files focused on remaining work and closeout summaries, not
  landed-slice history.
