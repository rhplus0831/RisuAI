# Stability And Performance Remediation Plan V2

Date: 2026-06-05

## Goal

Fix the confirmed issues in
[`audit-stability-and-performance-v2.md`](audit-stability-and-performance-v2.md)
without changing the wire model, `.risu` bytes, rendered output, or persisted
state. Each fix either narrows unnecessary work or adds a preventive bound.
Each fix needs a regression test.

End state:

- The second ring of server whole-corpus paths loads/writes only the rows it
  touches: chat-create, single-row PATCH, field projections, Realm append,
  finalization persist. (Root 1 / Phase 2, plus H2 in Phase 1.)
- Prompt assembly stops re-cloning, re-stringifying, and re-CBS-parsing
  unchanged transcripts and template cards. (Root 2 / Phase 3.)
- The remaining client whole-corpus clones use scoped reads/snapshots.
  (Root 3 / Phase 4.)
- A variable write no longer remounts and cold-re-parses every visible
  message. (Root 4 / Phase 1 H3 + Phase 5.)
- Bridge watchers never echo server-originated edits back as commands; client
  lifecycle state is bounded. (Root 6 / Phase 6.)
- The opt-in translate/TTS/MCP/file-import subsystems stop leaking, hanging,
  truncating, and over-working. (Root 5 / Phase 7.)
- Server jobs, memory, import/export, and outbound paths are bounded and fail
  safely. (Phase 8.)
- The V2 trigger interpreter is budgeted and abortable like Lua. (Phase 1 H1.)
- A v2 fix-completeness gate tracks every regression test. (Phase 9.)

## Boundary Sources

- [`audit-stability-and-performance-v2.md`](audit-stability-and-performance-v2.md)
  owns the evidence and verifier notes. [`status.md`](status.md) records phase
  state. [`active-risk-analysis.md`](active-risk-analysis.md) maps findings to
  phases.
- The per-root source files are listed under "Source Anchors" in
  [`README.md`](README.md) and the risk analysis.
- [`../../structure/backend.md`](../../structure/backend.md),
  [`../../structure/data-and-events.md`](../../structure/data-and-events.md),
  [`../../structure/server-projection-and-bridges.md`](../../structure/server-projection-and-bridges.md),
  and [`../../structure/frontend.md`](../../structure/frontend.md) own the
  present-tense descriptions of the load/projection/command/guard model the
  fixes must preserve.
- [`../leftover.md`](../leftover.md) owns deferred or
  evidence-gated items. This plan schedules only bounded sub-wins next to
  them (K1-K4, L3, L21, L25, L31) and does not re-open the parent gates.
- The closed v1 plan is archived at
  [`../audit-stability-and-performance/`](../audit-stability-and-performance/).
  Its gate test stays live against the archive.
- The codebase remains the source of truth when docs drift.

## Current Baseline

The v2 audit (method and counts in
[`audit-stability-and-performance-v2.md`](audit-stability-and-performance-v2.md))
re-examined the post-v1-fix codebase and found the v1 fixes present and
effective, but:

- A second ring of routine routes still runs hydrated whole-corpus
  parse/clone/diff work (chat-create is the worst: H2).
- The CBS/`risuChatParser` interpreter layer — outside every prior
  workstream's scope — is the largest unmitigated per-send server cost.
- One `ReloadGUIPointer` bump remounts every visible message AND wipes the
  Phase 7 script/regex caches, making each remount cold.
- Several landed v1 patterns were applied asymmetrically (fixed-point guard,
  scoped mutation reads, apply-epoch gates, M13-style diffs); the residuals
  are scheduled here (M2, M5, M9, M11/M12, K1-K4, L20, L32).
- The opt-in translate/TTS/MCP/file-import subsystems were never audited and
  carry unbounded caches, leaks, missing timeouts, a defeated import size
  guard, and a leftover test cap that silently truncates data.

This plan starts from the v1 closing baseline in
[`latest-verification.md`](latest-verification.md): `pnpm test` 1132/4,
`pnpm api:test` 1737/1, audit green, both TypeScript checks zero errors.

## Prerequisites

Phase 0 lands the shared prerequisites before any runtime fix:

1. v2 fix-completeness gate. A sibling of the v1 gate
   (`src/ts/__tests__/fixCompletenessGate.test.ts`, now pointed at the
   archive) that parses the v2 docs, seeds every scheduled v2 ID as
   `PLANNED`, and fails on doc/registry drift.
2. Measurement points. Reuse the v1 corpus fixture and server load-count
   harness; add a client render-count probe (ParseMarkdown invocations across
   a simulated GUI reload) for H3/Phase 5 proofs.
3. Severity contract. Prioritize routine-action corpus-scaling costs (H2),
   whole-screen re-parses (H3), and the send-hang class (H1) over rare
   bounded foot-guns.

## Invariants

Every slice must preserve these; a slice that cannot is out of scope:

- Wire/protocol unchanged. Payloads, command envelopes, revisions, and SSE
  semantics stay byte-for-byte the same.
- Rollback correctness. A narrowed rollback restores only the fields the
  command mutates.
- Broad paths remain. Keep full loaders/snapshots for true full-corpus work
  such as export/import and create/delete/reorder/fork — but note H2/L13
  prove "create" is not automatically broad: single-row creates use the
  writer kit.
- Output identity. Rendered output, prompt bytes, trigger/CBS/Lua results,
  `.risu` bytes, and persisted state stay identical. Memoized CBS/template
  renders must be byte-identical to the double-rendered originals (M3's
  side-effect-bearing cards need explicit tests). L22 is the single scheduled
  semantic correction and must document the embedding-window change.
- Bounds are additive. Timeouts and size caps change failure modes, not valid
  success paths (L1's deadline change must not kill actively-streaming
  generations).
- No data-loss path. Narrowed loads still provide expected empty shapes;
  bounded aborts never commit partial writes; M22/L4 fix existing silent data
  loss.

## Phase Overview

- [0. Baseline & Gate](phases/phase-0-baseline-and-gate.md): v2 gate
  scaffold, render-count probe, baseline refresh. No runtime change.
- [1. High-Severity Hot Paths](phases/phase-1-high-severity-hot-paths.md):
  H1 trigger budget/abort, H2 chat-create narrowing, H3 remount decoupling.
- [2. Server Corpus-Path Ring 2](phases/phase-2-server-corpus-ring-2.md)
  (Root 1): M5, M6, L3, L13, L14, L16, K1, K2.
- [3. Assembly CBS & Triggers](phases/phase-3-assembly-cbs-and-triggers.md)
  (Root 2): M1-M4, L4-L11.
- [4. Client Clone Narrowing Ring 2](phases/phase-4-client-clone-ring-2.md)
  (Root 3): M7-M10, L32-L34, L37, K4.
- [5. Client Render & UI](phases/phase-5-client-render-and-ui.md) (Root 4):
  M13, M17, L38-L44.
- [6. Bridges, Lifecycle & Network](phases/phase-6-bridges-lifecycle-network.md)
  (Root 6): M11, M12, M14, L35, L36, L45-L47.
- [7. Opt-In Subsystems](phases/phase-7-opt-in-subsystems.md) (Root 5):
  M15, M16, M18-M22, L48-L59, K3.
- [8. Server Jobs, Memory & Import Bounds](phases/phase-8-server-bounds.md):
  L1, L2, L15, L17-L31.
- [9. Verification Budgets](phases/phase-9-verification-budgets.md): keep the
  v2 gate complete and self-checking; closing run.

## Execution Cursor

Closed on 2026-06-06 after Phase 9 archived this plan and repointed the v2
gate. Phases 0-9 are complete; no current open v2 task remains here.

For any fix: re-check the cited symbol (line numbers drift), add the focused
regression test, narrow or bound the path, keep true full-corpus consumers
broad, and register the gate.

## Not In This Plan

- No sync-model rewrite. Projection/bootstrap/hydration/command/revision/
  events stay as they are.
- No state-model rewrite. Hydrated `message[]` histories still live under
  `DBState.db.characters`.
- No gated items: L12 and the v1 carry-overs (v1-L4, v1-L7, v1-L26, v1-U2)
  stay gated; I1-I18 need no action. See
  [`active-risk-analysis.md`](active-risk-analysis.md).
- No multi-tenant Lua sandbox, server-restart durability, or streamed-export
  work. Those remain in `leftover.md`.
- No re-opening dismissed findings. R1-R13 are verified non-issues.
