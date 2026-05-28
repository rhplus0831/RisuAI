# Alpha 3 Final Audit

Date: 2026-05-28

Status: **closed.** Alpha 3 is complete. A3F1 through A3F13 are closed, the
Alpha 3 R1-R7 audit gates pass, and the remaining contract-decision findings
have focused regression proof.

## Verdict

The Alpha 3 invariant is satisfied for the scoped Fastify-served web mode:

> In Fastify-served web mode, passive projection reads must not claim write
> ownership, public command writes must preserve client-owned stable ids and
> unambiguous addressing, and server-owned assets/secrets must not leak or drift
> through client fallbacks.

All behavior buckets in [`closeout-buckets.md`](./closeout-buckets.md) are
closed. Chat folder uniqueness remains excluded from A3F5 because the earlier
AEC4 audit rule already covers global chat folder identity.

## Closeout Summary

| Criterion | Status | Proof |
| --------- | ------ | ----- |
| A3EC1 - Passive projection and conflict semantics | Closed | Bucket 1 fixed passive bootstrap refresh, generic settings conflict replay, and compatibility fan-out. |
| A3EC2 - Stable command ids | Closed | Bucket 2 fixed preset copy/import and last-lorebook delete fallback. |
| A3EC3 - Global chat/message addressing | Closed | Bucket 3 enforces global chat/message ids or rejects ambiguous command writes. |
| A3EC4 - Asset ownership | Closed | Bucket 4 fixed asset reads, bundle walking, backups, and ONNX upload metadata. |
| A3EC5 - Secret row identity | Closed | Bucket 5 restores masked array placeholders by stable row identity or rejects unsafe placeholders. |
| A3EC6 - Repeatable audit and docs | Closed | R1-R7 pass, A3F13 has focused retention tests, and broad status docs point to this closeout. |

## Bucket 6 Closeout

A3F13 is closed by a bounded in-memory event retention contract:

- `InMemoryCommandEventSink` keeps only the latest 1000 command events for
  diagnostics through `list()`.
- Live subscribers still receive every emitted event; trimming retained history
  does not affect SSE fanout.
- Event history is not a durable replay log.

Focused proof:

- `server/fastify/__tests__/events.test.ts` covers bounded retained command
  event history, live fanout preservation, and `clear()` behavior.

No dedicated R-rule was added for A3F13 because the implementation exposes a
small local retention policy and the focused test is the stronger guard.

## Verification

Latest full verification on 2026-05-28:

- `pnpm client-thinning:audit`: passed.
- `pnpm check`: 0 errors, 0 warnings.
- `pnpm test`: 79 files passed; 793 tests passed, 4 skipped.
- `pnpm api:test`: 70 files passed; 1267 tests passed.
- `pnpm build`: passed with existing nonblocking warning classes.
- `pnpm smoke:fastify-browser`: build passed and 1 browser smoke test passed.

Focused Bucket 6 proof:

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/events.test.ts`:
  1 file passed; 8 tests passed.

## Handoff

Alpha 3 has no remaining open buckets. Future Fastify client-thinning findings
should be recorded as a new follow-up workstream rather than reopening this
closed closeout record.
