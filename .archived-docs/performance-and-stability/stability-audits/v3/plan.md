# Stability And Performance Remediation Plan V3

Date: 2026-06-06

## Goal

Fix the confirmed issues in
[`audit-stability-and-performance-v3.md`](audit-stability-and-performance-v3.md)
without changing the wire model, `.risu` bytes, rendered output, or persisted
state (two scheduled, documented behavior corrections excepted: M2 and H1 —
see Invariants). Each fix either narrows unnecessary work, adds a preventive
bound, or repairs a broken correctness contract. Each fix needs a regression
test.

End state:

- A cancelled streaming generation terminates as `aborted`, never as a
  spurious success with post-generation side effects. (Theme 3 / Phase 1 H1.)
- The user-send path stops paying O(transcript) clones and uploads: plain
  appends go through the single-message append command with a field-scoped
  rollback. (Theme 1 / Phase 1 M4+M5.)
- The command surface's third ring loads only what it touches: send
  persistence, settings, collections, plugin storage, single-row hydration.
  (Theme 2 / Phase 2.)
- The Hypa V3 memory budget actually constrains memory injection, the
  summarized prefix tokenizes once, and memory egress is deadline-bounded.
  (Theme 7 / Phase 3.)
- Normal shutdown runs the existing teardown; deadlines slide on active
  streams; realm/proxy egress is bounded and cancellable; responses are
  compressed and hashed bundles immutable-cached. (Themes 3+9 / Phase 4.)
- Every bridge flushes on unload, suppresses its own rollbacks, keeps true
  baselines, and the projection-guard-broken features work again.
  (Themes 4+5 / Phase 5.)
- Per-keystroke/per-write reactive consumers stop doing collection-sized
  work; the default catalog tab and render-path memo keys are cheap.
  (Theme 6 / Phase 6.)
- Per-send assembly/trigger amplifiers (sync asset reads, redundant clones,
  per-message rebuilds, unbounded user regex, stale memo) are narrowed and
  bounded. (Themes 1+8 / Phase 7.)
- The client interpreters get the server's budgets; plugins/MCP/media stop
  leaking listeners, contexts, URLs, and logs. (Theme 8 / Phase 8.)
- A v3 fix-completeness gate tracks every regression test. (Phase 9.)

## Boundary Sources

- [`audit-stability-and-performance-v3.md`](audit-stability-and-performance-v3.md)
  owns the evidence and verifier corrections (the corrections are part of the
  spec). [`status.md`](status.md) records phase state.
  [`active-risk-analysis.md`](active-risk-analysis.md) maps findings to
  phases.
- The per-theme source files are listed under "Source Anchors" in
  [`README.md`](README.md) and the risk analysis.
- [`../../structure/backend.md`](../../../../docs/structure/backend.md),
  [`../../structure/data-and-events.md`](../../../../docs/structure/data-and-events.md),
  [`../../structure/server-resources-and-bridges.md`](../../../../docs/structure/server-resources-and-bridges.md),
  and [`../../structure/frontend.md`](../../../../docs/structure/frontend.md) own the
  present-tense descriptions of the load/projection/command/guard model the
  fixes must preserve.
- [`../leftover.md`](../../../deferred-work/leftover.md) owns deferred or
  evidence-gated items. This plan schedules only bounded sub-wins next to
  them (K1-K4) and does not re-open the parent gates.
- The closed v1 and v2 plans are archived at
  [`../v1/`](../v1/)
  and
  [`../v2/`](../v2/).
  Their gate tests stay live against the archives and must keep passing.
- The codebase remains the source of truth when docs drift.

## Current Baseline

The v3 audit (method and counts in
[`audit-stability-and-performance-v3.md`](audit-stability-and-performance-v3.md))
re-examined the post-v2-fix codebase at `ad07004ba` and found the v1/v2 fixes
present and effective, but:

- The hottest action — send — still pays three transcript clones, a
  full-transcript upload, a whole-character-row rollback clone, and (for
  trigger/editinput users) a whole-corpus load inside the write transaction.
- A third ring of command routes never received scoped reads; the mutation
  engine silently defaults to the broad `loadPersisted`.
- A cancelled streaming generation is persisted through the full SUCCESS
  pipeline (H1) and normal process shutdown never runs the built teardown
  (M9).
- The memory token budget has been dead since inception (`tokens: 0`
  everywhere), defeating `memoryTokensRatio` entirely.
- The optimistic-write machinery is asymmetric across the six bridges
  (suppression, baselines, rollbacks, unload flush), and the read-only
  projection guard silently broke several legacy direct-write features.
- Several landed v2 patterns were applied asymmetrically (sliding deadlines,
  AudioContext reuse, console-log sweeps, $derived memoization, scoped
  reads); the residuals are scheduled here, four of them as K1-K4.

This plan starts from the v2 closing baseline in
[`latest-verification.md`](latest-verification.md): `pnpm test` 1312/4,
`pnpm api:test` 1846/1, client-thinning audit green, both TypeScript checks
zero errors (both re-verified green at `ad07004ba` on 2026-06-06).

## Prerequisites

Phase 0 lands the shared prerequisites before any runtime fix:

1. v3 fix-completeness gate. A sibling of the v1/v2 gates
   (`src/ts/__tests__/fixCompletenessGate.test.ts`,
   `fixCompletenessGateV2.test.ts`, both pointed at their archives) that
   parses the v3 plan docs, seeds every scheduled v3 ID (`H/M/L/K`) as
   `PLANNED`, and fails on doc/registry drift.
2. Measurement points. Reuse the corpus fixture, the server load-count
   harness, and the client render-count probe from the v1/v2 waves; add a
   send-path clone-count probe (cloneJsonValue/structuredClone invocations
   across one simulated send) for the Phase 1 proofs, and a terminal-frame
   assertion helper for H1.
3. Severity contract. Prioritize the cancel-correctness fix (H1), the
   send-path costs (M4, M5, M1), and the memory-budget repair (M2) over the
   bounded foot-guns.

## Invariants

Every slice must preserve these; a slice that cannot is out of scope:

- Wire/protocol unchanged. Payloads, command envelopes, revisions, and SSE
  semantics stay byte-for-byte the same. M4 may switch the plain-send
  dispatch from the replace command to the EXISTING append command (both are
  live protocol routes today); the emitted command events change shape
  accordingly (`messages.appended` vs `messages.replaced`) and every event
  consumer must be re-verified.
- Scheduled behavior corrections are explicit. Exactly two fixes change
  observable behavior on purpose and must ship with tests documenting the
  new behavior: H1 (cancel emits an aborted terminal, no success
  post-generation) and M2 (the memory token budget becomes enforced, so
  assembled prompts for memory-enabled chats with accumulated summaries
  change). Everything else is output-identical.
- Rollback correctness. A narrowed rollback restores only the fields the
  command mutates — and restores ALL of them (L21/L25/L27 fix existing
  under-restoring rollbacks).
- Broad paths remain. Keep full loaders/snapshots for true full-corpus work
  (export/import, restore, reorder); narrow only the hot path. The
  `skipDatabaseLoad`/scoped-read contracts in `commands/mutations.ts` are the
  levers — never bypass their guards.
- Output identity. Rendered output, prompt bytes, trigger/CBS/Lua results,
  `.risu` bytes, and persisted state stay identical (M2/H1 excepted, above).
  Memoized signatures/templates (L30, L31, L15) must be invalidation-correct
  — L10 exists precisely because a v2 memo missed an invalidation edge.
- Bounds are additive. Timeouts and size caps change failure modes, not valid
  success paths: L5/L2 must not kill actively-streaming generations; L16's
  deadline must comfortably exceed legitimate embedding/summarize latency;
  L47/L48 caps must pass real-world payloads.
- No data-loss path. M8's flush must never double-dispatch (suppression
  interplay with L23-L27); guard-repair fixes (L34-L36) must persist via
  scoped commands, not just stop throwing; narrowed loads still provide
  expected empty shapes.

## Phase Overview

- [0. Baseline & Gate](phases/phase-0-baseline-and-gate.md): v3 gate
  scaffold, clone-count probe, baseline refresh. No runtime change.
- [1. High Severity & Send Path](phases/phase-1-high-and-send-path.md)
  (Themes 1+3): H1, M4, M5.
- [2. Command-Surface Scoping](phases/phase-2-command-surface-scoping.md)
  (Theme 2): M1, M3, L11-L14, K2.
- [3. Memory Subsystem](phases/phase-3-memory-subsystem.md) (Theme 7):
  M2, L15, L16, K1.
- [4. Server Lifecycle, Deadlines & Transport](phases/phase-4-server-lifecycle-and-transport.md)
  (Themes 3+9): M9, L2, L4, L5, L17-L20, L56.
- [5. Client Write-Path Correctness](phases/phase-5-client-write-path-correctness.md)
  (Themes 4+5): M8, L21, L23-L27, L34-L37.
- [6. Reactive Amplification & Render](phases/phase-6-reactive-amplification-and-render.md)
  (Theme 6): M6, L22, L28-L33.
- [7. Assembly & Trigger Hot Paths](phases/phase-7-assembly-and-trigger-hot-paths.md)
  (Themes 1+8, server side): L1, L3, L6-L10, K3.
- [8. Client Interpreters, Plugins & Media](phases/phase-8-client-interpreters-plugins-media.md)
  (Theme 8): M7, L38-L55, K4.
- [9. Verification Budgets](phases/phase-9-verification-budgets.md): keep the
  v3 gate complete and self-checking; closing run; archive.

## Execution Cursor

- Complete: Phase 0, Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6,
  Phase 7, Phase 8, and Phase 9.
- Closed: this plan was archived on 2026-06-08 after the Phase 9 closing
  proof and gate repoint.
- For any fix: re-check the cited symbol (line numbers drift; the audit's
  verifier corrections are part of the spec), add the focused regression
  test, narrow or bound the path, keep true full-corpus consumers broad, and
  register the gate.

## Not In This Plan

- No sync-model rewrite. Projection/bootstrap/hydration/command/revision/
  events stay as they are.
- No state-model rewrite. Hydrated `message[]` histories still live under
  `DBState.db.characters`; the projection-guard proxy re-mint (I19) stays.
- No gated items: `v2-L12` and the v1 carry-overs (v1-L4, v1-L7, v1-L26,
  v1-U2) stay gated; I1-I23 need no action (some may ride phases — see
  [`active-risk-analysis.md`](active-risk-analysis.md)).
- No multi-tenant Lua sandbox, server-restart durability, or streamed-export
  work. Those remain in [`../leftover.md`](../../../deferred-work/leftover.md).
- No re-opening dismissed findings: v3 R1-R5, v2 R1-R13, and v1's R-set are
  verified non-issues.
