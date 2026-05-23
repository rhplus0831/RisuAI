# Migration Status

Date: 2026-05-24

This is the live Fastify migration handoff. It replaces the former root
handoff and roadmap files, which were removed so this status tree is the
single place for current pickup state.

Completed phase detail and old landed-slice logs live in
[`phases-completed/`](phases-completed/).

## Current Snapshot

- Active phase: Phase 7, server-side prompt assembly.
- Last landed slice: 7-12d-i, the typed assembly mutation payload plus
  `varChanged` persistence for send-like `/chat` requests.
- Current blocker: the typed mutation payload is still internal to
  `AssembleResult`; the browser needs it serialized as `message_patch`
  and applied before send / continue / regenerate can use server prompt
  assembly.
- Next default pickup: 7-12d-ii, `message_patch` SSE emission plus the
  browser applier while provider dispatch still runs locally.
- Last recorded baselines after 7-12d-i: `pnpm check` clean,
  `pnpm api:test` 886 tests, `pnpm test` 618 tests plus 4 skipped, and
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
| Server-side prompt assembly                 | Active; 7-12d-ii `message_patch` applier is next.                              |
| Hypa V3 memory                              | Not started; waits for Phase 7.                                                |
| Client thinning                             | Not started; waits for server-owned prompt, generation, and memory surfaces.   |

## Maintenance Rules

- Keep this file short: last done, current blocker, next pickup, and links.
- Put the actionable runbook in [`status/next-steps.md`](status/next-steps.md).
- Put completed logs and old status snapshots in
  [`phases-completed/`](phases-completed/).
- Keep phase files focused on remaining work and closeout summaries, not
  landed-slice history.
