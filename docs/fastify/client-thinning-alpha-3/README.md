# Fastify Client Thinning Alpha 3 - Closeout Record

Date: 2026-05-28

Status: **closed.** This directory records the third client-thinning follow-up
pass after [`../client-thinning-alpha-2/`](../client-thinning-alpha-2/) closed.
Alpha 3 invariant gaps are fixed, covered by repeatable audit rules or focused
regression tests, and recorded in [`final-audit.md`](./final-audit.md).

## Why Alpha 3 Exists

The original Phase 9 migration and Alpha 1/Alpha 2 closeouts fixed many concrete
direct-write and server-projection bugs. The read-only Alpha 3 baseline still
had a green client-thinning audit and focused tests, but review found more
classes where the documented invariant is stronger than the code and audit
proof:

- Passive bootstrap refresh can re-register a stale browser session as the
  active writer.
- A generic settings path still blindly replays a 409 conflict.
- Some command paths still mint durable ids or allow ambiguous globally addressed
  ids.
- Asset reads, backup/restore, and bundle walking still have gaps around server
  asset ownership.
- Secret placeholder restoration can copy array-row secrets by index after
  reorder/delete.

These are follow-up gaps in the standing Fastify server-projection workstream,
not a rewrite of the archived Phase 9 migration slices.

## Current Bucket State

Bucket 0 landed the Alpha 3 audit gates in `util/client-thinning-audit.ts`.
Bucket 1 landed active-writer/conflict behavior fixes. Passive projection
refresh uses a read-only bootstrap fetch that does not send
`risu-writer-session`, generic data-driven settings no longer replay 409
conflicts, and whole-chat compatibility fan-out is serialized against the latest
command revision.

Bucket 2 has now landed stable-id command fixes. Preset copy requires the
client-supplied optimistic id as `newPresetId`, preset import uses the
validate-only preset constructor instead of the id-minting repair helper, and
deleting the last global lorebook now returns 400 instead of creating a fallback
id. The preset-import rewrite also closes the A3F6 image asset validation
overlap with focused malformed/missing asset tests.

Bucket 3 has now landed global chat/message id addressing fixes. Chat ids and
message ids are normalized to global uniqueness during import/bootstrap repair,
command-created chats and messages reject ids that already exist under another
parent, and the existing globally addressed patch/delete/fork routes remain
unambiguous without changing the public route contract.

Bucket 4 has now landed asset ownership and backup durability fixes. Fastify
asset reads reject unknown references before attaching `risu-auth`, the
RisuSave asset walker and bundle export include supported legacy
`assets/<sha>.<ext>` references, server backups copy/restore asset bytes, and
ONNX transformer asset uploads preserve `.onnx` metadata.

Bucket 5 has now landed masked-array secret row identity fixes. Placeholder
restoration for array rows resolves by stable row identity (`botPresets.id`,
`customModels.id`, `authRefreshes.url`, and `characters.chaId`) and rejects
masked placeholders when identity is missing, duplicated, or unknown. Focused
tests cover reorder/delete behavior for provider settings arrays plus direct
masking coverage for bot presets and character-owned TTS secrets.

Bucket 6 has now landed event retention and final closeout. The in-memory
command event sink retains only the latest 1000 command events for diagnostics
while preserving live fanout to active subscribers. Focused tests cover the
bounded retention contract, and the broad status docs now point to this Alpha 3
closeout after the full ladder passed.

## Scope

Alpha 3 covers Fastify-served web mode only: the SPA served by
`server/fastify`, with durable state owned by Fastify APIs and browser state
treated as a projection.

In scope:

- Active-writer registration, passive refresh, command conflict handling, and
  multi-command optimistic adapters.
- Public command routes and helpers that create, copy, import, or repair durable
  ids.
- Globally addressed chat and message command semantics. Chat folder global
  identity remains covered by the earlier AEC4 audit rule and is not reopened by
  Alpha 3 unless new evidence appears.
- Provider secret masking and placeholder restoration.
- Fastify asset read/write, RisuSave bundle walking, server backup/restore, and
  asset metadata.
- `util/client-thinning-audit.ts` coverage for the classes above.

Out of scope unless needed to close a finding:

- Legacy local browser mode.
- A full rewrite of the Phase 9 command map.
- Runtime-only provider/proxy requests that do not write local durable state.

## Alpha 3 Invariant

> In Fastify-served web mode, passive projection reads must not claim write
> ownership, public command writes must preserve client-owned stable ids and
> unambiguous addressing, and server-owned assets/secrets must not leak or drift
> through client fallbacks.

## Exit Criteria

Alpha 3 is complete only when every criterion below is true and covered by
committed regression proof.

| #     | Exit criterion                                                                                                                                                    | Required regression proof                                                                                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A3EC1 | Passive projection refresh does not steal active-writer ownership, and 409 conflicts are not blindly replayed.                                                    | Multi-session active-writer tests for event/bootstrap refresh; generic settings conflict test; audit checks for bootstrap registration mode and retry drift.                     |
| A3EC2 | Public command paths never mint stable ids unless a documented command explicitly owns server-generated ids.                                                      | Missing-id tests for preset copy/import and empty-lorebook fallback, or documented exceptions with explicit client/server contract and audit coverage.                           |
| A3EC3 | Globally addressed chat/message commands are globally unique or parent-scoped in the route contract. Chat folder global uniqueness remains covered by Alpha AEC4. | Cross-character duplicate chat-id tests and cross-chat duplicate message-id tests prove rejection or disambiguation for create/import/patch/delete/fork.                         |
| A3EC4 | Server asset reads, bundle walking, backups, and upload metadata preserve the server-owned asset contract.                                                        | Tests for rejecting arbitrary URL fetch with `risu-auth`, preserving backup asset bytes, including supported asset references in bundles, and retaining MIME/extension metadata. |
| A3EC5 | Masked provider secrets cannot be transplanted across array rows.                                                                                                 | Reorder/delete tests for masked array secret fields such as `botPresets`, `customModels`, and `authRefreshes`.                                                                   |
| A3EC6 | The repeatable audit covers the Alpha 3 bug classes.                                                                                                              | `pnpm client-thinning:audit` fails on the old patterns and passes after fixes; docs and status are reconciled only after the full ladder passes.                                 |

## Verification Baseline

The following commands passed on 2026-05-28 before Alpha 3 was marked closed:

```bash
pnpm client-thinning:audit
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

The focused Bucket 6 proof is:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/events.test.ts
```

## Document Map

- [`audit.md`](./audit.md) - combined Codex/Claude audit verdict, R1-R7 gates,
  and closeout checklist.
- [`open-findings.md`](./open-findings.md) - Alpha 3 findings and closed
  status.
- [`closeout-buckets.md`](./closeout-buckets.md) - bucket order and closed
  ownership record.
- [`decisions.md`](./decisions.md) - default decisions and acceptable
  alternatives to settle before implementation.
- [`final-audit.md`](./final-audit.md) - final Alpha 3 verdict and verification
  record.
- [`../../audit-codex-latest.md`](../../audit-codex-latest.md) and
  [`../../audit-claude-latest.md`](../../audit-claude-latest.md) - source latest
  read-only audits combined into this folder.
- [`../../handover.md`](../../handover.md) - broader audit handoff notes for the
  next detailed pass.
