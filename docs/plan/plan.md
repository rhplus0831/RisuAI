# Stability And Performance Remediation Plan

Date: 2026-06-04

## Goal

Fix the confirmed issues in
[`audit-stability-and-performance.md`](audit-stability-and-performance.md)
without changing the wire model, `.risu` bytes, rendered output, or persisted
state. Each fix either narrows unnecessary work or adds a preventive bound. Each
fix needs a regression test.

End state:

- Server hot paths load only the rows they read. (Root 1 / Phase 2.)
- Client hot paths use scalar or single-row rollbacks instead of whole-corpus
  clones. (Root 2 / Phase 3.)
- Streaming parses a bounded number of times, not once per token. (Root 3 /
  Phase 1, H3.)
- Proxy, non-durable provider, and Lua fetches have timeouts and abort
  propagation. (Root 4 / Phase 4.)
- Decompression, buffering, streams, and jobs fail safely on limits or aborts.
  (Root 5 / Phase 5.)
- Memory and Lua work is bounded and fair. (Phase 6.)
- Invariant work is memoized and stray logging/redundant scans are removed.
  (Phase 7.)
- A fix-completeness gate tracks every regression test. (Phase 8.)

## Boundary Sources

- [`audit-stability-and-performance.md`](audit-stability-and-performance.md)
  owns the evidence and verifier notes. [`status.md`](status.md) records phase
  state. [`active-risk-analysis.md`](active-risk-analysis.md) maps findings to
  phases.
- The per-root source files are listed under "Source Anchors" in
  [`README.md`](README.md).
- [`../structure/backend.md`](../structure/backend.md),
  [`../structure/data-and-events.md`](../structure/data-and-events.md),
  [`../structure/server-projection-and-bridges.md`](../structure/server-projection-and-bridges.md),
  and [`../structure/frontend.md`](../structure/frontend.md) own the
  present-tense descriptions of the load/projection/command/guard model the fixes
  must preserve.
- [`../archive/leftover.md`](../archive/leftover.md) owns deferred or
  evidence-gated items. This plan does not re-open them.
- The codebase remains the source of truth when docs drift.

## Current Baseline

The audit (method and counts in
[`audit-stability-and-performance.md`](audit-stability-and-performance.md))
found that the earlier perf workstreams fixed the wire and known client clone
hot paths, but left adjacent paths broad:

- Server projection payloads are lean, but hot reads/writes still call
  `loadPersisted` / `loadPersistedWithMessages`, parsing the corpus. Scoped
  helpers exist but are not wired into the hot paths.
- The client narrowed the snapshot family but left specific callers on
  `cloneJsonValue(DBState.db.characters)`, especially `changeChatTo`.
- Streaming has no render coalescing: one provider delta triggers one full
  CBS+markdown+DOMPurify parse of the growing message.
- Non-durable provider/proxy/Lua fetches rely on client-disconnect abort only,
  bounded only by Node/undici defaults.
- Several decompress/buffer paths check size only after full materialization.

This plan started from the green baseline in
[`latest-verification.md`](latest-verification.md). Phases 0, 1, and 2 have
landed, and Phase 3 is complete after the L32 watcher/global-modal
ID-assignment follow-up. Phase 4 outbound request lifecycle is the next root in
audit order.

## Prerequisites

Phase 0 lands the shared prerequisites before any runtime fix:

1. Measurement baseline. Seed a large corpus and capture server timings with
   `RISU_PROTOCOL_METRICS=1`; use `pnpm analyze:db` for static cost.
2. Regression harnesses. Reuse `src/ts/__tests__/cloneCostHarness.ts` for
   client clones. Add a server helper that fails when a scoped hot path calls a
   whole-corpus loader.
3. Fix-completeness gate. Register every scheduled fix's regression test and
   fail if the proof disappears.
4. Severity contract. Prioritize per-action hot-path costs (H1) and UI freezes
   (H2/H3) over rare bounded foot-guns.

## Invariants

Every slice must preserve these; a slice that cannot is out of scope:

- Wire/protocol unchanged. Payloads, command envelopes, revisions, and SSE
  semantics stay byte-for-byte the same.
- Rollback correctness. A narrowed rollback restores only the fields the command
  mutates.
- Broad paths remain. Keep full loaders/snapshots for true full-corpus work
  such as export/import and create/delete/reorder/fork.
- Output identity. Rendered output, prompt bytes, trigger/CBS/Lua results,
  `.risu` bytes, and persisted state stay identical.
- Bounds are additive. Timeouts and size caps change failure modes, not valid
  success paths.
- No data-loss path. Narrowed loads still provide expected empty shapes, and
  bounded aborts never commit partial writes.

## Phase Overview

- [0. Baseline & Harness](phases/phase-0-baseline-foundations.md): seeded
  corpus, server load-count assertion, fix-completeness gate scaffold. No runtime
  change.
- [1. High-Severity Hot Paths](phases/phase-1-high-severity-hot-paths.md): H1
  hydration guard, H2 `ChatSelectionSnapshot`, H3 streaming render coalescing.
- [2. Server Load Narrowing](phases/phase-2-server-load-narrowing.md) (Root 1):
  scoped assembly load, command-mutation read narrowing, single-character
  projection, lazy metric, bulk-read narrowing (M1, M3, M4, M5, L1, L2, L5, L6,
  L10, U1).
- [3. Client Clone Narrowing](phases/phase-3-client-clone-narrowing.md) (Root 2):
  drop redundant normalize, clone-before-strip, single-row send snapshot,
  remaining clone callers, watcher cost, runner rollback (M12, M13, M14, L31-L36,
  U4).
- [4. Outbound Request Lifecycle](phases/phase-4-outbound-request-lifecycle.md)
  (Root 4): proxy/provider/Lua timeouts + abort, egress hardening (M6, M8, L20,
  L22, L23, L24, L25).
- [5. Materialization & Lifecycle](phases/phase-5-materialization-and-lifecycle.md)
  (Root 5): bounded inflate, asset-GC token scan, bundle-export cleanup,
  stream/job lifecycle, import robustness, sync-replay correctness (M9, M10, M11,
  L11-L15, L27-L30).
- [6. Memory & Lua](phases/phase-6-memory-and-lua.md): embed batch sizing, job
  fairness, orphan-cleanup gating, Lua exec budget/engine reuse (M7, L16, L17,
  L18, L19, L21).
- [7. Memoization & Hygiene](phases/phase-7-memoization-and-hygiene.md): regex
  compile memoization, redundant deletes/scans, logging hygiene (M2, L3, L8, L9,
  L37, L38, L39, L40).
- [8. Verification Budgets](phases/phase-8-verification-budgets.md): keep the
  fix-completeness gate complete and self-checking.

## Execution Cursor

Phases 0, 1, 2, and 3 are complete. Prefer Phases 4-7 in the order above unless
current evidence points elsewhere. Phase 8 is the standing gate.

For each fix: re-check the cited symbol, add the focused regression test, narrow
or bound the path, keep true full-corpus consumers broad, and register the gate.

## Not In This Plan

- No sync-model rewrite. Projection/bootstrap/hydration/command/revision/events
  stay as they are.
- No state-model rewrite. Hydrated `message[]` histories still live under
  `DBState.db.characters`; this plan reduces clone/load cost only.
- No gated owner-decision items. L4, L7, L26, and U2 stay gated; U3 needs no
  action. See [`active-risk-analysis.md`](active-risk-analysis.md).
- No multi-tenant Lua sandbox or server-restart durability work. Those remain in
  `leftover.md`.
- No re-opening dismissed findings. R1-R5 are verified non-issues.
