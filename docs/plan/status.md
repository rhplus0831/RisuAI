# Stability And Performance Remediation Status

Date: 2026-06-04

This is the entry router for the remediation workstream. Use it first, then open
only the phase or slice needed for the task.

The plan schedules 57 confirmed findings (3 high, 14 medium, 40 low) from
[`audit-stability-and-performance.md`](audit-stability-and-performance.md) across
Phases 0-8. Phases 0, 1, and 2 are complete: all three highs are fixed — H1
(`0dc7452e`), H3 (`e41dc6c6`), H2 (`067ab82a`) — and all of Phase 2's server
load narrowing landed: scoped assembly load (M1, L1, L2, `c193c008`),
command-mutation read narrowing (M3, L5, L6, `e0e86ab1`), single-character
projection (M4, `254b3112`), and the metric/bulk-read slice (M5, L10, U1,
`b2765994`). Next: pick Phase 3-7 by current pain (Phase 3 client clone
narrowing is the next root in audit order).

## Current Snapshot

All findings are routed. Phases 0-2 are complete. Phases 3-7 group the
remaining mediums/lows by root cause. Phase 8 is the standing gate (its
scaffold is live and H1/H2/H3/M1/L1/L2/M3/L5/L6/M4/M5/L10/U1 are registered as
`DONE`).

- [Phase 0](phases/phase-0-baseline-foundations.md) — COMPLETE. Shared
  large-corpus fixture + `assertScopedLoadOnHotPath` server load-count harness
  (with breadth detections as self-proof), and the fix-completeness gate
  scaffold (`src/ts/__tests__/fixCompletenessGate.test.ts`, seeded in Phase 0
  with planned ids, now carrying H1/H2/H3 as `DONE`, doc-mirrored, fails on
  drift). No runtime change.
- [Phase 1](phases/phase-1-high-severity-hot-paths.md) — COMPLETE. H1 DONE
  (`0dc7452e`, hydration guard); H3 DONE (`e41dc6c6`, streaming render
  coalescing); H2 DONE (`067ab82a`, chat-selection scalar snapshot).
- [Phase 2](phases/phase-2-server-load-narrowing.md) — COMPLETE. M1, L1, L2
  DONE (`c193c008`, scoped assembly load + module memo + run-var skip); M3,
  L5, L6 DONE (`e0e86ab1`, chat-scoped command-mutation reads); M4 DONE
  (`254b3112`, single-row `characterRow` read + in-place secret mask); M5,
  L10, U1 DONE (`b2765994`, deferred metric serialization + replay-only
  history + scoped bulk hydration).
- [Phase 3](phases/phase-3-client-clone-narrowing.md) — not started. M12-M14,
  L31-L36, U4: client clone narrowing.
- [Phase 4](phases/phase-4-outbound-request-lifecycle.md) — not started. M6,
  M8, L20, L22-L25: outbound timeouts, abort, egress hardening.
- [Phase 5](phases/phase-5-materialization-and-lifecycle.md) — not started.
  M9-M11, L11-L15, L27-L30: bounded materialization and lifecycle cleanup.
- [Phase 6](phases/phase-6-memory-and-lua.md) — not started. M7, L16-L19, L21:
  memory fairness and Lua budget/engine reuse.
- [Phase 7](phases/phase-7-memoization-and-hygiene.md) — not started. M2, L3,
  L8, L9, L37-L40: memoization and hygiene.
- [Phase 8](phases/phase-8-verification-budgets.md) — standing; scaffold live
  (`fixCompletenessGate.test.ts`). Flip ids `PLANNED` -> `DONE` (registry +
  [`active-risk-analysis.md`](active-risk-analysis.md) together) as fixes land.

## Open Risk Router

[`active-risk-analysis.md`](active-risk-analysis.md) has the full per-finding
routing (finding -> phase -> target fix), the gated exclusions, and the
dismissed list. Highlights:

- All three highs are DONE: H1 (`0dc7452e`) hydration guard, H3 (`e41dc6c6`)
  streaming render coalescing, H2 (`067ab82a`) chat-selection scalar snapshot.
- Phase 2 scoped assembly load is DONE (`c193c008`): M1 target-chat-only
  message/hypa hydration, L1 `getActiveModules` memo, L2 run-var fixed-point
  skip.
- Phase 2 command-mutation read narrowing is DONE (`e0e86ab1`): the targeted
  message/scriptstate/generation routes read one chat row + its parent
  character instead of the full `loadPersisted` (M3 collections, L5 assets,
  L6 characters/chats).
- Phase 2 single-character projection is DONE (`254b3112`): the
  `characterRow` projection reads one character + its chats
  (`loadSingleCharacterStubRow`) and masks just that owned row via the new
  `maskProviderSecretsInPlace` (bootstrap drops its whole-DB mask clone too).
- Phase 2 metric/bulk-read slice is DONE (`b2765994`): metric fields defer
  behind the `RISU_PROTOCOL_METRICS` guard (M5), the SSE route loads
  command-event history only for replay (L10), and bulk hydration resolves
  known ids from the requested rows only (U1). Phase 2 is COMPLETE.
- Biggest remaining root: Phase 3 client clone narrowing (M12-M14, L31-L36,
  U4) — whole-corpus deep clones on client hot/warm paths.
- Gated (not scheduled): L4, L7, L26, U2 stay on the
  `RISU_PROTOCOL_METRICS` evidence path or an owner decision; U3 needs no
  action; the five dismissed candidates (R1-R5 in the audit) are non-issues.

## Latest Verification

See [`latest-verification.md`](latest-verification.md). Re-run and record the
focused/full proof set before starting the next phase or after any later phase
lands.

## Start Here

- Use [`next-steps.md`](next-steps.md) to choose the next task and proof command.
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
