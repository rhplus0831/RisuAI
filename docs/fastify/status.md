# Migration Status

Date: 2026-05-24

This is the live Fastify migration handoff. It replaces the former root
handoff and roadmap files, which were removed so this status tree is the
single place for current pickup state.

Completed phase detail and old landed-slice logs live in
[`phases-completed/`](phases-completed/).

## Current Snapshot

- Active phase: Phase 7, server-side prompt assembly.
- Last landed slice: 7-12d-iii-a, provider-agnostic `/chat` chunk
  transport with server-only tests and an internal dispatcher hook.
- Current blocker: `/chat` has transport for provider chunks, but the
  browser send path is not yet orchestrated around server dispatch.
- Next default pickup: 7-12d-iii-b, wire send-path orchestration,
  `generationId`, `addRerolls`, enriched `done`, and fixture coverage.
- Last recorded baselines after 7-12d-iii-a: `pnpm check` clean,
  `pnpm api:test` 893 tests, `pnpm test` 622 tests plus 4 skipped, and
  `pnpm build` passing with existing CSS / browser-externalization /
  plugin-timing / bundle-size warnings.

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
| Server-side prompt assembly                 | Active; 7-12d-iii-b send orchestration is next.                                |
| Hypa V3 memory                              | Not started; waits for Phase 7.                                                |
| Client thinning                             | Not started; waits for server-owned prompt, generation, and memory surfaces.   |

## Maintenance Rules

- Keep this file short: last done, current blocker, next pickup, and links.
- Put the actionable runbook in [`status/next-steps.md`](status/next-steps.md).
- Put completed logs and old status snapshots in
  [`phases-completed/`](phases-completed/).
- Keep phase files focused on remaining work and closeout summaries, not
  landed-slice history.
