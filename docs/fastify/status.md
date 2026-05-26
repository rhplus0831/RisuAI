# Migration Status

Date: 2026-05-27

This is the live handoff for the Fastify migration. The first
post-closeout audit is archived in
[`phases-completed/status-followup-closeout.md`](phases-completed/status-followup-closeout.md);
the original migration closeout is in
[`phases-completed/status-migration-closeout.md`](phases-completed/status-migration-closeout.md).

Policy note: there are no actual Fastify users yet, so do not add
compatibility migrations for intermediate Fastify shapes. Update the
current server schema, command surface, and import/export paths directly.

## Current Snapshot

- Active work: one open finding. The 2026-05-27 Phases 0-9 audit found
  trigger collection/chat data effects still writing `DBState.db`
  directly (guard throws in server-backed mode); tracked in
  [`phases/phase-9-trigger-projection-writes.md`](phases/phase-9-trigger-projection-writes.md).
- Latest closeout: the audit-driven slice routed the scalar character /
  persona trigger effects, scripting `declareAPI` character setters, and
  the Realm / creator-quote UI writes through commands, with a focused
  `runTrigger` projection-guard regression test. Verification passed on
  2026-05-27. See
  [`phases-completed/phase-9-trigger-scalar-projection-writes.md`](phases-completed/phase-9-trigger-scalar-projection-writes.md).
- No follow-up remains open for Phases 0, 1, 2, 4, or 7. Phases 0-8 and
  the rest of Phase 9 verified clean against code in the 2026-05-27 audit.
- Next default pickup: the open Phase 9 trigger collection/chat
  projection-write finding above.
- Closeout rule: keep this file to the current snapshot. Put landed
  slice detail under `phases-completed/`; use `phases/` only for active
  or remaining alpha scope.

## Commit Anchors

| Commit     | Scope                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| pending    | Routed scalar trigger / scripting / UI projection writes through commands; opened the trigger collection/chat follow-up. |
| pending    | Closed the `LEFTOVER.md` Phase 3, Phase 7, and Phase 9 audit findings.                                                   |
| `50d55b97` | Closed the broad alpha typecheck blocker and full verification matrix.                                                   |
| `bd7a4712` | Restored the Phase 5 `sendChat` coordinator boundary.                                                                    |
| `cf830b9e` | Closed Phase 9B projection-write tails.                                                                                  |
| `0c429fe8` | Added CRLF-safe provider SSE event framing.                                                                              |
| `6137b782` | Recorded the broad closeout typecheck blocker later closed by `50d55b97`.                                                |
| `ed4d53a8` | Isolated memory event delivery failures.                                                                                 |
| `0cee686d` | Aligned hub response-header filtering.                                                                                   |
| `d570f482` | Rejected truncated provider SSE tails.                                                                                   |
| `7bc0e8f6` | Closed Phase 9A projection-write blockers.                                                                               |

## Audit Findings

| Phase                                   | State        | Finding                                                                                                                                                                                                | Closeout                                                                                                     |
| --------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 0 - Removals                            | No follow-up | Google Drive public artifact removal still appears complete.                                                                                                                                           | None                                                                                                         |
| 1 - Foundation                          | No follow-up | Fastify foundation shape still matches the phase goals.                                                                                                                                                | None                                                                                                         |
| 2 - Storage / import / assets / backups | No follow-up | Baseline storage, import, asset, backup, and static route work still appears complete.                                                                                                                 | None                                                                                                         |
| 3 - Proxy migration                     | Closed       | Hub passthrough reuses shared proxy request/response filtering, including proxy control-header stripping plus hub-only `x-risu-node-path` stripping.                                                   | [`phases-completed/leftover-audit-closeout.md`](phases-completed/leftover-audit-closeout.md)                 |
| 4 - sendChat tests                      | No follow-up | Fixture harness and coverage inventory still appear complete.                                                                                                                                          | None                                                                                                         |
| 5 - sendChat extraction                 | Closed       | The coordinator is back to a thin 358-line boundary, with server-backed `/chat` adapter logic, terminal handling, persistence, and local prompt assembly wrappers in focused helpers.                  | [`phases-completed/phase-5-sendchat-boundary-alpha.md`](phases-completed/phase-5-sendchat-boundary-alpha.md) |
| 6 - Server-side generation              | Closed       | Provider SSE parsers reject unterminated tails as typed provider errors and accept LF/CRLF-delimited complete event blocks.                                                                            | [`phases-completed/phase-6-sse-line-endings.md`](phases-completed/phase-6-sse-line-endings.md)               |
| 7 - Server-side prompt assembly         | Closed       | Coverage docs now match the actual guardrail split: provider parity through `/completion`, real `/chat` route-backed coverage for send/continue/regenerate/preview/preview-prompt.                     | [`phases-completed/leftover-audit-closeout.md`](phases-completed/leftover-audit-closeout.md)                 |
| 8 - Hypa V3 memory                      | Closed       | Memory event delivery is best-effort across external sinks, SSE subscribers, worker progress emits, and memory job routes.                                                                             | [`phases-completed/phase-8-memory-event-isolation.md`](phases-completed/phase-8-memory-event-isolation.md)   |
| 9 - Client thinning                     | Open         | Scalar trigger / scripting / UI projection writes now route through commands. Trigger collection/chat effects (`globalLore`, chat `note`) still write `DBState.db` directly and throw under the guard. | [`phases/phase-9-trigger-projection-writes.md`](phases/phase-9-trigger-projection-writes.md)                 |
| Broad closeout                          | Closed       | The earlier `pnpm check` blocker with 58 diagnostics across 18 files is fixed.                                                                                                                         | [`phases-completed/broad-closeout-typecheck-alpha.md`](phases-completed/broad-closeout-typecheck-alpha.md)   |

## Verification

Latest leftover closeout on 2026-05-27:

- `pnpm check` passed: 0 errors, 0 warnings.
- `pnpm test` passed: 69 files, 747 passed, 4 skipped.
- `pnpm api:test` passed: 68 files, 1217 passed.
- `pnpm build` passed with nonblocking build warnings.
- `pnpm smoke:fastify-browser` passed: 1 browser smoke test.

Focused verification for the closed Phase 3, 5, 6, 8, and 9 alpha
slices is archived in the linked `phases-completed/` notes.

## Closeout Expectations

- Each future reopened phase must include focused regression tests for
  the finding it fixes.
- Broad closeout should run `pnpm check`, `pnpm test`, `pnpm api:test`,
  `pnpm build`, and `pnpm smoke:fastify-browser` unless a narrower
  change has explicit owner approval to defer the full matrix.
- Re-run `pnpm smoke:fastify-browser` before closing any future browser
  projection sweep.
