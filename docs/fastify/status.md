# Migration Status

Date: 2026-05-24

This is the live Fastify migration handoff. It replaces the former root
handoff and roadmap files, which were removed so this status tree is the
single place for current pickup state.

Completed phase detail and old landed-slice logs live in
[`phases-completed/`](phases-completed/).

## Current Snapshot

- Active phase: Phase 7, server-side prompt assembly.
- Last landed slice: 7-12c (`8cf7fd63`), which routed `sendChat`
  preview and preview-prompt paths through `/api/v1/generate/chat` behind
  `db.useServerPromptAssembly`.
- Current blocker: send / continue / regenerate need a typed
  server-to-browser mutation handoff before they can leave the local
  assembler path.
- Next default pickup: 7-12d-i, the mutation contract plus
  `varChanged` persistence.
- Last recorded baselines after 7-12c: `pnpm api:test` 882 tests,
  `pnpm test` 618 tests plus 4 skipped, `pnpm check` clean, and
  `pnpm build` passing with existing CSS / bundle-size warnings.

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

| Workstream | State |
| --- | --- |
| Removals | Closed; historical detail archived. |
| Fastify server foundation / storage / proxy | Closed; Fastify owns the live server path. |
| Server-side generation | Closed for `/completion`; remaining provider flattening follows Phase 7 needs. |
| Server-side prompt assembly | Active; 7-12d mutation handoff is next. |
| Hypa V3 memory | Not started; waits for Phase 7. |
| Client thinning | Not started; waits for server-owned prompt, generation, and memory surfaces. |

## Maintenance Rules

- Keep this file short: last done, current blocker, next pickup, and links.
- Put the actionable runbook in [`status/next-steps.md`](status/next-steps.md).
- Put completed logs and old status snapshots in
  [`phases-completed/`](phases-completed/).
- Keep phase files focused on remaining work and closeout summaries, not
  landed-slice history.
