# Fastify Follow-Up Alpha Status

Date: 2026-05-27

This is the live handoff for the second audit pass over Fastify Phases
0-9. The previous `docs/fastify-followup/` closeout still records landed
work, but this alpha track reopens the findings below for task agents.

Policy note: there are no actual Fastify users yet, so do not add
compatibility migrations for intermediate Fastify shapes. Update the
current server schema, command surface, and import/export paths directly.

## Current Snapshot

- Active work: Phase 5 sendChat boundary cleanup and broad alpha
  closeout typecheck cleanup.
- Broad alpha closeout verification is blocked by `pnpm check`
  diagnostics found on 2026-05-27.
- No follow-up found in this audit: Phases 0, 1, 2, 4, and 7.
- Next default pickup: clear
  [`phases/phase-5-sendchat-boundary-alpha.md`](phases/phase-5-sendchat-boundary-alpha.md),
  then clear
  [`phases/broad-closeout-typecheck-alpha.md`](phases/broad-closeout-typecheck-alpha.md),
  then rerun broad alpha closeout verification.
- Closeout rule: keep this file to the current snapshot. Put landed
  slice detail under `phases-completed/` and keep focused scope,
  boundaries, and exit criteria under `phases/`.

## Recent Alpha Anchors

| Commit     | Scope                                           |
| ---------- | ----------------------------------------------- |
| `7bc0e8f6` | Closed Phase 9A projection-write blockers.      |
| `d570f482` | Closed Phase 6 truncated provider SSE tails.    |
| `0cee686d` | Closed Phase 3 hub response-header filtering.   |
| `ed4d53a8` | Closed Phase 8 memory event delivery isolation. |
| `6137b782` | Recorded the broad closeout typecheck blocker.  |

## Audit Findings

| Phase                                   | State        | Finding                                                                                                                                                    | Task Doc                                                                                                         |
| --------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0 - Removals                            | No follow-up | Google Drive public artifact removal still appears complete.                                                                                               | None                                                                                                             |
| 1 - Foundation                          | No follow-up | Fastify foundation shape still matches the phase goals.                                                                                                    | None                                                                                                             |
| 2 - Storage / import / assets / backups | No follow-up | Baseline storage, import, asset, backup, and static route work still appears complete.                                                                     | None                                                                                                             |
| 3 - Proxy migration                     | Closed       | Hub passthrough now reuses the shared proxy response-header strip policy, with hub-only transport header stripping retained.                               | [`phases-completed/phase-3-hub-response-headers.md`](phases-completed/phase-3-hub-response-headers.md)           |
| 4 - sendChat tests                      | No follow-up | Fixture harness and coverage inventory still appear complete.                                                                                              | None                                                                                                             |
| 5 - sendChat extraction                 | Open         | Historical extraction closed, but later server-backed sendChat adapter logic grew the current coordinator from the 445-line closeout shape to 703 lines.   | [`phases/phase-5-sendchat-boundary-alpha.md`](phases/phase-5-sendchat-boundary-alpha.md)                         |
| 6 - Server-side generation              | Closed       | Provider SSE parsers now handle unterminated tails as typed provider errors and accept CRLF-delimited complete event blocks.                               | [`phases-completed/phase-6-sse-line-endings.md`](phases-completed/phase-6-sse-line-endings.md)                   |
| 7 - Server-side prompt assembly         | No follow-up | Regenerate, provider guards, stop-trigger payloads, and route-backed fixture coverage still appear complete.                                               | None                                                                                                             |
| 8 - Hypa V3 memory                      | Closed       | Memory event delivery is now best-effort across external sinks, SSE subscribers, worker progress emits, and memory job routes.                             | [`phases-completed/phase-8-memory-event-isolation.md`](phases-completed/phase-8-memory-event-isolation.md)       |
| 9 - Client thinning                     | Closed       | Character/chat/module import, ordering/selection, module-apply, MCP risuaccess, and helper-coverage projection-write tails are closed for this alpha pass. | [`phases-completed/phase-9-projection-write-tails-9b.md`](phases-completed/phase-9-projection-write-tails-9b.md) |

## Broad Closeout Finding

The 2026-05-27 closeout pass found that `pnpm check` fails with 57
diagnostics across 17 files. The failures are typecheck-only so far:
`pnpm test`, `pnpm api:test`, `pnpm build`, and
`pnpm smoke:fastify-browser` all passed in the same pass. Track the
cleanup in
[`phases/broad-closeout-typecheck-alpha.md`](phases/broad-closeout-typecheck-alpha.md).

## Phase 6 Alpha Closeout

The 2026-05-27 CRLF line-ending slice added shared SSE event-block
framing for LF and CRLF delimiters across OpenAI-compatible,
Anthropic, Mistral, and Gemini streams, while preserving typed
provider errors for unterminated SSE tails. The closeout log lives in
[`phases-completed/phase-6-sse-line-endings.md`](phases-completed/phase-6-sse-line-endings.md).

## Phase 5 Alpha Finding

The 2026-05-27 re-audit found that Phase 5 did close historically at
commit `a7e2831d`, with `src/ts/process/index.svelte.ts` at 445 lines
and the extraction helpers in place. The current coordinator is 703
lines after later server-backed prompt-assembly, patch-replay,
terminal side-effect, restoration, and generation-result persistence
logic landed inline. Local Phase 5 fixtures and helper tests still
passed, and server-backed sendChat tests also passed, so this is
tracked as boundary drift rather than a confirmed behavior regression.

## Phase 9 Alpha Closeout

The 2026-05-27 Phase 9B slice closed the remaining alpha
projection-write tails for character/chat/module imports, character
ordering and folder metadata, chat-page selection, module apply,
browser MCP `risuaccess` character/module writers, `chatCommands.ts`
helper flows, and `deleteGlobalModule`. The closeout log lives in
[`phases-completed/phase-9-projection-write-tails-9b.md`](phases-completed/phase-9-projection-write-tails-9b.md).

## Verification From Audit

The audit used subagents for Phases 0-2, 3-6, 7, 8, and 9, then
locally checked the critical findings. The Fastify API suite passed in
subagent runs, focused Phase 7/8/9 suites passed, `pnpm build` passed,
and `pnpm smoke:fastify-browser` passed. Phase 3 now has focused
coverage for hub response-header filtering, Phase 6 has focused
coverage for truncated provider SSE tails and CRLF-delimited provider
SSE event handling, and Phase 8 has focused coverage for best-effort
memory event delivery. The latest local Phase 9B slice closes the
reopened import/order/module-apply/MCP projection-write tails and helper
coverage.

Latest broad closeout attempt on 2026-05-27:

- `pnpm check` failed: 57 errors, 0 warnings, 17 files.
- `pnpm test` passed: 67 files, 742 passed, 4 skipped.
- `pnpm api:test` passed: 68 files, 1212 passed.
- `pnpm build` passed with nonblocking build warnings.
- `pnpm smoke:fastify-browser` passed: 1 browser smoke test.

Latest focused Phase 9B closeout on 2026-05-27:

- Direct-bind sweep had no hits.
- Focused client/helper suites passed: 9 files, 73 tests.
- Focused Fastify command/event/bootstrap API suite passed: 68 files,
  1217 tests.
- `pnpm smoke:fastify-browser` passed: 1 browser smoke test.
- `pnpm check` still failed with the known broad alpha blocker: 57
  errors, 0 warnings, 17 files.

Latest focused Phase 5 re-audit on 2026-05-27:

- Local Phase 5 fixture/helper sweep passed: 28 files, 316 tests.
- Server-backed sendChat fixture/preview sweep passed: 2 files, 26
  tests.
- `pnpm check` still failed with the known broad alpha blocker,
  including the server-backed sendChat fixture typing bucket.

## Closeout Expectations

- Each reopened phase must include focused regression tests for the
  finding it fixes.
- Broad closeout should run `pnpm check`, `pnpm test`, `pnpm api:test`,
  and `pnpm build` unless a narrower change has explicit owner approval
  to defer the full matrix.
- Re-run `pnpm smoke:fastify-browser` before closing any future browser
  projection sweep.
