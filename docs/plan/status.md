# Stability And Performance Remediation Status

Date: 2026-06-05

This is the entry router for the remediation workstream. Use it first, then open
only the phase or slice needed for the task.

The plan schedules 57 confirmed findings (3 high, 14 medium, 40 low) from
[`audit-stability-and-performance.md`](audit-stability-and-performance.md) across
Phases 0-8. ALL SCHEDULED PHASES (0-7) ARE COMPLETE: all three highs are fixed
— H1 (`0dc7452e`), H3 (`e41dc6c6`), H2 (`067ab82a`) — all of Phase 2's server
load narrowing landed — scoped assembly load (M1, L1, L2, `c193c008`),
command-mutation read narrowing (M3, L5, L6, `e0e86ab1`), single-character
projection (M4, `254b3112`), metric/bulk-read slice (M5, L10, U1,
`b2765994`) — Phase 3's client clone narrowing is complete after the L32
watcher/global-modal follow-up, Phase 4's outbound request lifecycle landed
in one batch (M6, M8, L20, L22-L25, `bf1a6cb2`), Phase 5's
materialization/lifecycle batch landed (M9-M11, L11-L15, L27-L30,
`686220d6`), Phase 6's memory/Lua batch landed (M7, L16-L19, L21,
`ca798c01`), and Phase 7's memoization/hygiene batch landed (M2, L3, L8, L9,
L37-L40, `151c6978`). No scheduled work remains; Phase 8 stays the standing
gate.

## Current Snapshot

All findings are routed and all scheduled findings are DONE. Phase 8 is the
standing gate (its scaffold is live and every scheduled id — H1-H3, M1-M14,
L1-L3, L5/L6, L8-L25, L27-L40, U1, U4 — is registered as `DONE` with its
regression test). The only non-DONE ids are the gated owner-decision items
(L4, L7, L26, U2) and U3 (no action).

- [Phase 0](phases/phase-0-baseline-foundations.md) — COMPLETE. Shared
  large-corpus fixture + `assertScopedLoadOnHotPath` server load-count harness
  (with breadth detections as self-proof), and the fix-completeness gate
  scaffold (`src/ts/__tests__/fixCompletenessGate.test.ts`, seeded in Phase 0
  with planned ids, doc-mirrored, fails on drift). No runtime change.
- [Phase 1](phases/phase-1-high-severity-hot-paths.md) — COMPLETE. H1 DONE
  (`0dc7452e`, hydration guard); H3 DONE (`e41dc6c6`, streaming render
  coalescing); H2 DONE (`067ab82a`, chat-selection scalar snapshot).
- [Phase 2](phases/phase-2-server-load-narrowing.md) — COMPLETE. M1, L1, L2
  DONE (`c193c008`, scoped assembly load + module memo + run-var skip); M3,
  L5, L6 DONE (`e0e86ab1`, chat-scoped command-mutation reads); M4 DONE
  (`254b3112`, single-row `characterRow` read + in-place secret mask); M5,
  L10, U1 DONE (`b2765994`, deferred metric serialization + replay-only
  history + scoped bulk hydration).
- [Phase 3](phases/phase-3-client-clone-narrowing.md) — COMPLETE. M12-M14,
  L31-L36, U4 DONE: var writes drop the redundant
  `setDatabase`, kept-key character diff, single-row send-context rollback,
  scoped script-definition watcher, signal-read modules `$effect`, chat-scoped
  module toggle, single-row MCP patch, runner rejection rollback, scoped
  `setCurrentChat`, and scoped lorebook watcher/global-modal first-run
  ID assignment.
- [Phase 4](phases/phase-4-outbound-request-lifecycle.md) — COMPLETE. M6, M8,
  L20, L22-L25 DONE (`bf1a6cb2`, one batch): proxy abort-on-close +
  `requestTimeout` backstop, shared 600s non-durable `attachAbort` deadline +
  32 MB buffered-body cap, request signal threaded into the Lua runtime,
  8 MB streaming-buffer cap, embedded-IPv4 SSRF unwrapping, `setObjectValue`
  prototype-key guard, post-validation egress rate counting.
- [Phase 5](phases/phase-5-materialization-and-lifecycle.md) — COMPLETE.
  M9-M11, L11-L15, L27-L30 DONE (`686220d6`, one batch): streaming bounded
  inflate per envelope/block + finite bundle inner-`.risu` cap, column-only
  message-inlay asset scan (GC + import report), bundle-export close/error
  settle + Zip/FD teardown, SSE arming guard, done-job WS viewer close,
  runner-settle-before-`db.close()` shutdown, durable viewer heartbeat,
  no-viewer overflow abort, corrupt-manifest-tolerant backups list,
  transactional legacy restore re-import, persisted writer-session origin on
  replayed events, and the deferred reattach re-arm.
- [Phase 6](phases/phase-6-memory-and-lua.md) — COMPLETE. M7, L16-L19, L21
  DONE (`ca798c01`, one batch): bounded embed/summarize batch drain
  (`MEMORY_JOB_BATCH_MAX_JOBS`) + token-aware contextual sub-batches with
  independent commit, no-orphan cleanup skips the write txn (and the summary
  re-parse when the chat has no summaries), round-robin per-chat claim
  fairness, the memory-job-scoped `loadPersistedDatabaseForMemoryJob` loader,
  the shared per-request `LuaExecBudget`, and the pre-warmed Lua engine pool
  (prelude pre-run, host fns bound per call, one engine per call).
- [Phase 7](phases/phase-7-memoization-and-hygiene.md) — COMPLETE. M2, L3,
  L8, L9, L37-L40 DONE (`151c6978`, one batch): per-assembly prepared-script
  memo (modules + DSL parse + compiled RegExps once per assembly, cbs
  excluded), memoized lorebook keyword-key regexes, memoized trigger-effect
  regexes (9 sites through `getCompiledRegex`), keep-window command-event
  prune (no `OFFSET 999` walk per write), FK-cascade character delete (no
  redundant `chats` DELETE), and the warm/render-path `console.log` removals
  (command pipe dumps, preset dump, per-render `Trigger time`, in-place
  transcript scan).
- [Phase 8](phases/phase-8-verification-budgets.md) — standing; scaffold live
  (`fixCompletenessGate.test.ts`). Every scheduled id is now `DONE` (registry +
  [`active-risk-analysis.md`](active-risk-analysis.md) stay in enforced
  lockstep). Future fixes (e.g. a gated item getting scheduled) flip ids the
  same way: registry + doc together.

## Open Risk Router

[`active-risk-analysis.md`](active-risk-analysis.md) has the full per-finding
routing (finding -> phase -> target fix), the gated exclusions, and the
dismissed list. Highlights:

- Every scheduled finding is DONE; see the phase list above for the
  per-batch summaries and commits.
- Remaining open items are intentionally NOT scheduled: L4, L7, L26, U2 stay
  on the `RISU_PROTOCOL_METRICS` evidence path or an owner decision; U3 needs
  no action; the five dismissed candidates (R1-R5 in the audit) are
  non-issues.

## Latest Verification

See [`latest-verification.md`](latest-verification.md). The Phase 7 closing
run: `pnpm test` 1130/4, `pnpm api:test` 1737/1, audit green, both TypeScript
checks zero errors. Re-run and record the proof set after any future change to
the touched paths.

## Start Here

- The scheduled workstream is finished. For any follow-up,
  [`next-steps.md`](next-steps.md) records the closed state and the
  maintenance posture.
- Use [`active-risk-analysis.md`](active-risk-analysis.md) for the per-finding
  routing and the gated/dismissed exclusions.
- Use [`plan.md`](plan.md) for the goal, prerequisites, invariants, and phase
  order.
- Use [`phases/README.md`](phases/README.md) for all phase docs.

## Maintenance Rules

- Keep `status.md` and `next-steps.md` as the navigation entry points.
- Keep phase summaries in `phases/`; keep concrete task scope in
  `phases/slices/[phase]/`.
- Every fix needs a regression test and a Phase 8 gate entry. Do not mark a
  slice implemented without both.
- Preserve the broad path for its genuine consumer; narrow only the hot path.
- Re-check the cited code before editing — audit line numbers drift; symbol
  names are the durable anchor.
- Update this status and the phase router after a phase changes state, and flip
  finding IDs from "scheduled" to "DONE (commit)" in
  [`active-risk-analysis.md`](active-risk-analysis.md) as they land.
