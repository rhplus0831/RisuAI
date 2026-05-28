# Fastify Client Thinning Alpha 2 - Remaining Tasks

Date: 2026-05-28

Status: **open task-agent handoff.** Buckets 1, 2, and 3 closed on
2026-05-28; the next open work item is Bucket 4, Alpha 2 docs/status closeout.
This directory records the next reopened client-thinning alpha pass after
[`../client-thinning-alpha/`](../client-thinning-alpha/) closed AF1 through
AF10 and AEC1 through AEC7.

The earlier client-thinning and alpha directories remain historical records.
Do not rewrite them to explain away this pass. Close this alpha-2 directory only
after the findings in [`open-findings.md`](./open-findings.md) are fixed, the
repeatable audit catches the bug classes, and the verification ladder below is
green.

## Why Alpha 2 Exists

The first alpha pass fixed the known Codex/Claude audit findings, but a deeper
follow-up audit found three remaining invariant gaps:

- A route-local chat fork fallback still minted a command-path chat id. This is
  now closed by Bucket 1 and recorded in [`history.md`](./history.md).
- Durable memory-job mutations were outside the active-writer lock. This is now
  closed by Bucket 2 and recorded in [`history.md`](./history.md).
- The invariant audit still proves less than the docs claim for route-local id
  minting, active-writer mutation discovery, and asset-walker validator parity.
  This is now closed by Bucket 3 and recorded in [`history.md`](./history.md).

These are not failures of the original Phase 9 migration slices. They are
follow-up gaps in the standing Fastify server-projection contract.

## Scope

Alpha 2 covers Fastify-served web mode only: the SPA served by
`server/fastify`, with `globalThis.__FASTIFY__ = true`, where durable state is
owned by Fastify APIs and the browser is a projection.

In scope:

- Public Fastify command routes and helpers that create or clone durable
  resource ids.
- Durable Fastify mutation routes that can change server-owned JSON or SQLite
  state, including memory-job and generation-time memory planning entrypoints.
- Client helpers used by those mutation routes.
- `util/client-thinning-audit.ts` checks that claim to enforce the invariant.
- Focused regression tests and closeout docs for the findings below.

Out of scope unless directly needed for a finding:

- A fresh whole-system Phase 9 re-audit.
- Legacy local browser persistence.
- Vite-only dev serving, Tauri/native/mobile wrappers, service-worker install
  surfaces, and alternative servers.

## Alpha-2 Invariant

> In Fastify-served web mode, no public command path mints stable durable ids
> behind the client's back, and no server-owned durable mutation bypasses the
> active-writer/session and repeatable-audit gates.

## Exit Criteria

Alpha 2 is complete only when every criterion below is true and covered by
committed regression proof.

| #     | Exit criterion                                                                                                                                                                                                                                                                                                                                                                                                  | Required regression proof                                                                                                                                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2EC1 | **Command fork ids are stable.** `/api/v1/commands/chats/:chatId/fork` no longer mints a chat id through route-local `randomUUID()` fallback. If a fork creates a chat, the command payload supplies the durable id, or the route is explicitly reclassified and the stable-id docs are updated.                                                                                                                | Missing `chat.id` on fork returns 400, or a documented alternative has equivalent stable-id proof. `pnpm client-thinning:audit` fails on route-local command id minting.                                                               |
| A2EC2 | **Every durable mutation is active-writer guarded or explicitly classified.** Memory job create/cancel routes and generation-time memory planning are guarded as browser-triggered durable mutations, or explicitly documented as exempt runtime/internal state with tests proving the exemption. Default closure is to guard browser-triggered entrypoints and classify background worker commits as internal. | Stale writer receives 423 for guarded memory/generation mutation entrypoints; client helpers send `risu-writer-session` and handle 423 where applicable; worker/internal commits are documented and tested as non-browser entrypoints. |
| A2EC3 | **The invariant audit covers the newly found blind spots.** The audit discovers command route id minting, active-writer mutation classifier drift, and full asset-walker validator coverage rather than relying on narrow whitelists.                                                                                                                                                                           | `pnpm client-thinning:audit` contains structural checks for the new classes and passes after fixes. Negative-fixture or source mutation checks are encouraged where practical.                                                         |
| A2EC4 | **Docs reflect current state.** This directory moves closed findings to history, updates buckets, and records the final ladder. Existing `status.md` and `status/next-steps.md` are reconciled only after code and audit proof land.                                                                                                                                                                            | `README`, `open-findings`, `closeout-buckets`, `decisions`, and `history/final-audit` agree after the full ladder passes.                                                                                                              |

Current progress:

- A2EC1 is closed by Bucket 1.
- A2EC2 is closed by Bucket 2.
- A2EC3 is closed by Bucket 3.
- A2EC4 remains open.

## Verification Ladder

Run focused proof first for each bucket, then the shared ladder before marking
Alpha 2 closed:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

`pnpm tauribuild` is not a current package script and is not an Alpha 2 closeout
gate.

## Document Map

- [`open-findings.md`](./open-findings.md) - live Alpha 2 findings and evidence.
- [`decisions.md`](./decisions.md) - starting decisions and acceptable
  alternatives.
- [`closeout-buckets.md`](./closeout-buckets.md) - ordered task-agent work.
- [`history.md`](./history.md) - resolved Alpha 2 findings as buckets close.
- `final-audit.md` - create only after all Alpha 2 buckets close and the ladder
  has been rerun.
