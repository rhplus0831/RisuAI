# Fastify Follow-Up Alpha Status

Date: 2026-05-27

This is the live handoff for the second audit pass over Fastify Phases
0-9. The previous `docs/fastify-followup/` closeout still records landed
work, but this alpha track reopens the findings below for task agents.

Policy note: there are no actual Fastify users yet, so do not add
compatibility migrations for intermediate Fastify shapes. Update the
current server schema, command surface, and import/export paths directly.

## Current Snapshot

- Active work: broad alpha closeout verification is blocked by
  `pnpm check` diagnostics found on 2026-05-27.
- Phase follow-up findings remain closed; the open slice is a broad
  closeout typecheck cleanup.
- No follow-up found in this audit: Phases 0, 1, 2, 4, 5, and 7.
- Next default pickup: clear
  [`phases/broad-closeout-typecheck-alpha.md`](phases/broad-closeout-typecheck-alpha.md),
  then rerun broad alpha closeout verification.
- Closeout rule: keep this file to the current snapshot. Put landed
  slice detail under `phases-completed/` and keep focused scope,
  boundaries, and exit criteria under `phases/`.

## Audit Findings

| Phase                                   | State        | Finding                                                                                                                                 | Task Doc                                                                                                   |
| --------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 0 - Removals                            | No follow-up | Google Drive public artifact removal still appears complete.                                                                            | None                                                                                                       |
| 1 - Foundation                          | No follow-up | Fastify foundation shape still matches the phase goals.                                                                                 | None                                                                                                       |
| 2 - Storage / import / assets / backups | No follow-up | Baseline storage, import, asset, backup, and static route work still appears complete.                                                  | None                                                                                                       |
| 3 - Proxy migration                     | Closed       | Hub passthrough now reuses the shared proxy response-header strip policy, with hub-only transport header stripping retained.            | [`phases-completed/phase-3-hub-response-headers.md`](phases-completed/phase-3-hub-response-headers.md)     |
| 4 - sendChat tests                      | No follow-up | Fixture harness and coverage inventory still appear complete.                                                                           | None                                                                                                       |
| 5 - sendChat extraction                 | No follow-up | Browser extraction baseline still appears complete.                                                                                     | None                                                                                                       |
| 6 - Server-side generation              | Closed       | Unterminated provider SSE tails now emit typed provider errors instead of successful `done` streams.                                    | [`phases-completed/phase-6-generation-sse-tails.md`](phases-completed/phase-6-generation-sse-tails.md)     |
| 7 - Server-side prompt assembly         | No follow-up | Regenerate, provider guards, stop-trigger payloads, and route-backed fixture coverage still appear complete.                            | None                                                                                                       |
| 8 - Hypa V3 memory                      | Closed       | Memory event delivery is now best-effort across external sinks, SSE subscribers, worker progress emits, and memory job routes.          | [`phases-completed/phase-8-memory-event-isolation.md`](phases-completed/phase-8-memory-event-isolation.md) |
| 9 - Client thinning                     | Closed       | 9A converted module settings, side chat list, Hypa/supa memory toggles, and lorebook page selection to command-first/draft-first flows. | [`phases-completed/phase-9-client-thinning-9a.md`](phases-completed/phase-9-client-thinning-9a.md)         |

## Broad Closeout Finding

The 2026-05-27 closeout pass found that `pnpm check` fails with 57
diagnostics across 17 files. The failures are typecheck-only so far:
`pnpm test`, `pnpm api:test`, `pnpm build`, and
`pnpm smoke:fastify-browser` all passed in the same pass. Track the
cleanup in
[`phases/broad-closeout-typecheck-alpha.md`](phases/broad-closeout-typecheck-alpha.md).

## Verification From Audit

The audit used subagents for Phases 0-2, 3-6, 7, 8, and 9, then
locally checked the critical findings. The Fastify API suite passed in
subagent runs, focused Phase 7/8/9 suites passed, `pnpm build` passed,
and `pnpm smoke:fastify-browser` passed. Phase 3 now has focused
coverage for hub response-header filtering, Phase 6 has focused
coverage for truncated provider SSE tails, and Phase 8 has focused
coverage for best-effort memory event delivery.

Latest broad closeout attempt on 2026-05-27:

- `pnpm check` failed: 57 errors, 0 warnings, 17 files.
- `pnpm test` passed: 67 files, 742 passed, 4 skipped.
- `pnpm api:test` passed: 68 files, 1212 passed.
- `pnpm build` passed with nonblocking build warnings.
- `pnpm smoke:fastify-browser` passed: 1 browser smoke test.

## Closeout Expectations

- Each reopened phase must include focused regression tests for the
  finding it fixes.
- Broad closeout should run `pnpm check`, `pnpm test`, `pnpm api:test`,
  and `pnpm build` unless a narrower change has explicit owner approval
  to defer the full matrix.
- Re-run `pnpm smoke:fastify-browser` before closing Phase 9 projection
  work or any future browser projection sweep.
