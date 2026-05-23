# Migration Status

Date: 2026-05-24

This is the live Fastify migration handoff. It replaces the former root
handoff and roadmap files, which were removed so this status tree is the
single place for current pickup state.

Completed phase detail and old landed-slice logs live in
[`phases-completed/`](phases-completed/).

## Current Snapshot

- Active phase: Phase 7, server-side prompt assembly.
- Last landed slice: 7-12d-iii-b, production `/chat` provider dispatch
  plus browser send-path orchestration.
- Current blocker: server-dispatched `/chat` still needs typed `tts`
  `side_effect` events and `error.restoration` rollback.
- Next default pickup: 7-12d-iv, add `tts` `side_effect` and
  `error.restoration` rollback.
- Last recorded baselines after 7-12d-iii-b: `pnpm check` clean,
  `pnpm test` 635 tests plus 4 skipped, `pnpm api:test` 894 tests, and
  `pnpm build` passing with existing CSS `::highlight`, browser
  externalization, plugin-timing, and bundle-size warnings.

## Start Here

- [`status/next-steps.md`](status/next-steps.md) - exact next slice and
  verification commands.
- [`phases/phase-7-prompt-assembly.md`](phases/phase-7-prompt-assembly.md)
  - active Phase 7 scope and exit criteria.
- [`status/server.md`](status/server.md) - current Fastify route surface.
- [`status/sendchat.md`](status/sendchat.md) - current `sendChat`
  boundary and fixture guardrails.
- [`coverage/providers.md`](coverage/providers.md) - provider dispatch
  matrix.

## Current Workstreams

| Workstream                                  | State                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| Removals                                    | Closed; historical detail archived.                                            |
| Fastify server foundation / storage / proxy | Closed; Fastify owns the live server path.                                     |
| Server-side generation                      | Closed for `/completion`; remaining provider flattening follows Phase 7 needs. |
| Server-side prompt assembly                 | Active; 7-12d-iv side effects / rollback is next.                              |
| Hypa V3 memory                              | Not started; waits for Phase 7.                                                |
| Client thinning                             | Not started; waits for server-owned prompt, generation, and memory surfaces.   |

## Maintenance Rules

- Keep this file short: last done, current blocker, next pickup, and links.
- Put the actionable runbook in [`status/next-steps.md`](status/next-steps.md).
- Put completed logs and old status snapshots in
  [`phases-completed/`](phases-completed/).
- Keep phase files focused on remaining work and closeout summaries, not
  landed-slice history.
