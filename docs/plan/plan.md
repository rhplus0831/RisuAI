# Stability And Performance Remediation Plan

Date: 2026-06-04

## Goal

Fix the confirmed stability and performance findings in
[`audit-stability-and-performance.md`](audit-stability-and-performance.md)
without changing the projection/bootstrap/revision/event model, the `.risu`
envelope bytes, rendered output, or persisted state. Each fix narrows work to
what a path actually needs, or adds a preventive bound, and lands with a
regression test that fails if the issue returns.

End state:

- **Server stops reconstituting a broad in-memory `Database` on hot paths.**
  Prompt assembly, command mutations, chat-message hydration, single-character
  projection, and bulk hydration load only the rows they read (scoped SQLite
  loaders or a per-request memo). (Root 1 / Phase 2.)
- **Client stops whole-corpus deep-cloning for scalar/single-row rollbacks.**
  Chat selection, send context, character-field diffs, and the remaining
  snapshot callers use a scalar or single-row snapshot; the full clone stays for
  genuine restructures only. (Root 2 / Phase 3.)
- **Streaming renders are coalesced**, so a long response is parsed a bounded
  number of times instead of once per token. (Root 3 / Phase 1, H3.)
- **Outbound fetches have preventive timeouts and propagate abort** (proxy,
  non-durable provider, Lua), and egress hardening gaps are closed. (Root 4 /
  Phase 4.)
- **Decompression and buffering are bounded before materialization**, and
  stream/job lifecycles clean up on abort/close. (Root 5 / Phase 5.)
- **Memory and Lua execution are bounded and fair** (embed batch sizing, job
  fairness, orphan-cleanup gating, Lua exec budget). (Phase 6.)
- **Invariant work is memoized and hygiene gaps closed** (regex compilation,
  redundant deletes/scans, stray logging). (Phase 7.)
- **Every fix is covered by a regression test registered in a fix-completeness
  gate** that fails on drift. (Phase 8.)

## Boundary Sources

- [`audit-stability-and-performance.md`](audit-stability-and-performance.md)
  seeded the findings, evidence, impact, suggested fixes, and the adversarial
  verifier's grounded notes. [`status.md`](status.md) records phase state and
  [`active-risk-analysis.md`](active-risk-analysis.md) the finding -> phase map.
- The per-root source files are listed under "Source Anchors" in
  [`README.md`](README.md).
- [`../structure/backend.md`](../structure/backend.md),
  [`../structure/data-and-events.md`](../structure/data-and-events.md),
  [`../structure/server-projection-and-bridges.md`](../structure/server-projection-and-bridges.md),
  and [`../structure/frontend.md`](../structure/frontend.md) own the
  present-tense descriptions of the load/projection/command/guard model the fixes
  must preserve.
- [`../archive/leftover.md`](../archive/leftover.md) owns the deliberately
  deferred / evidence-gated items; this plan does not re-open those (see
  Non-Goals).
- The codebase remains the source of truth when docs drift.

## Current Baseline

The audit (method and counts in
[`audit-stability-and-performance.md`](audit-stability-and-performance.md))
found that the three landed perf workstreams fixed the *wire* and the *known*
client clone hot paths but left adjacent paths broad. Concretely:

- The server made the projection payload lean (lazy-projection) but still calls
  `loadPersisted` / `loadPersistedWithMessages` — which `JSON.parse` every
  character, every chat-metadata row, all 9 collection tables, and the full
  asset table — on most write and read paths, with **no per-request memo and no
  field-scoped loader wired on a hot path**. The scoped loaders
  (`getChatMessagesGroupedByIds`, `loadCharacterSelectionRows`) exist but are
  not used where they would help.
- The client narrowed the `current*StateSnapshot` family but left specific
  callers on `cloneJsonValue(DBState.db.characters)` — most importantly **chat
  selection (`changeChatTo`), which has no scalar-snapshot analog** to the
  landed `CharacterSelectionSnapshot`.
- Streaming has no render coalescing: one provider delta -> one full
  CBS+markdown+DOMPurify re-parse of the whole message, ~O(length²).
- Non-durable provider/proxy/Lua fetches rely on client-disconnect abort only,
  bounded only by Node/undici defaults.
- Several decompress/buffer paths check size only after full materialization.

This plan starts from the green test baseline the prior workstreams left
([`latest-verification.md`](latest-verification.md)): `pnpm test`,
`pnpm api:test`, `pnpm client-thinning:audit`, and both project-reference
TypeScript checks pass. No fix in this plan has landed yet.

## Prerequisites

Phase 0 lands the shared prerequisites before any runtime fix:

1. **Measurement baseline.** A seeded large-corpus fixture (many characters,
   many/large chats, several presets/modules/lorebooks, embeddings) plus a
   `RISU_PROTOCOL_METRICS=1` capture of the server stage timings the audit
   names, so each narrowing can show the cost it removes. `pnpm analyze:db`
   covers the static half.
2. **Regression-harness reuse.** Reuse the existing client clone-cost harness
   (`src/ts/__tests__/cloneCostHarness.ts`) for Root-2 client clones, and add
   a server-side equivalent that asserts a hot path does not call the
   whole-corpus loader (`getAllChatMessagesGrouped` / unscoped `loadPersisted`)
   when a scoped load would do.
3. **Fix-completeness gate scaffold.** A standing test (analogous to the
   landed `cloneCostGateCompleteness.test.ts`) that registers every scheduled
   fix's regression test and fails when a registered gate is missing/renamed —
   so a later refactor cannot silently delete a fix's proof.
4. **Severity contract.** Single-user self-host: a fix that removes a
   whole-corpus parse from a per-action hot path (H1) or a UI freeze (H2/H3)
   outranks a bounded/rare foot-gun. Keep the broad path for the genuine
   full-corpus consumer; narrow only the hot path that does not need it.

## Invariants

Every slice must preserve these; a slice that cannot is out of scope:

- **Wire/protocol unchanged.** Projection payloads, bootstrap shape, command
  envelopes, the revision contract (one bump + one command event per mutation),
  and SSE event semantics are byte-for-byte unchanged. Narrowing changes *what
  the server loads to compute a response*, not what it returns.
- **Rollback correctness.** A narrowed client rollback restores exactly the
  fields the command mutates and nothing else; it must not clobber unrelated
  concurrent edits the broad restore would have wiped (the
  `restoreCharacterSelection` property).
- **Reserve the broad path.** Keep the whole-corpus SQLite loader and the
  full-collection snapshot for their genuine consumers
  (assetGc/export/save/import; create/delete/reorder/fork). Narrowing stops the
  hot path from reaching them; it does not delete them.
- **Output identity.** Rendered output, prompt-assembly bytes, trigger/CBS/Lua
  results, `.risu` envelope bytes, and persisted state are identical before and
  after each slice. Round-trip tests gate any codec/export change.
- **Preventive bounds are additive.** A timeout/size cap must be generous enough
  not to abort a legitimately slow local model or truncate a large valid
  completion; it changes the failure mode, not the success path.
- **No new data-loss path.** A narrowed load must still give non-target rows the
  empty shape downstream iteration expects (e.g. `message = []`), and a
  bounded-decode abort must fail the request cleanly, never commit a partial
  write.

## Phase Overview

- [0. Baseline & Harness](phases/phase-0-baseline-foundations.md): seeded
  corpus, server clone-cost assertion, fix-completeness gate scaffold. No runtime
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

Nothing is implemented yet. Start with **Phase 0** (foundations), then **Phase
1** (the three high-severity fixes — each independent and high-leverage; H1 is a
one-line guard change). Phases 2-7 are largely independent of each other and can
be picked in any order after Phase 0/1; prefer the order above (root-cause
leverage). Phase 8 is the standing completeness layer.

For every fix: confirm the current code still matches the audit's cited location
(line numbers drift), write the regression test first where practical, narrow or
bound the path, keep the broad path for its genuine consumer, and register the
gate in Phase 8's completeness map.

## Not In This Plan

- **No sync-model rewrite.** The projection/bootstrap/hydration/command/revision/
  event model is preserved; this plan changes server load/clone cost and adds
  bounds, not the protocol.
- **No re-architecture of where state lives.** Hydrated `message[]` histories
  still accumulate in `DBState.db.characters`; the plan reduces what is cloned,
  not the storage model. Message-store / `hypaV3Data` / alternate semantics are
  unchanged.
- **Gated / owner-decision items are excluded.** The maintainer-deferred and
  evidence-gated findings — **L4** (targeted-assembly broad char rewrite), **L7**
  (Tier-5 create/delete full rewrite), **L26** (`.risu` export streaming writer),
  and **U2** (sprawling-resource full-bootstrap narrowing) — stay gated on the
  existing `RISU_PROTOCOL_METRICS` evidence path or an owner decision; see
  [`active-risk-analysis.md`](active-risk-analysis.md). **U3** (session-bounded
  id Sets) needs no action.
- **No multi-tenant Lua sandbox and no server-restart durability.** Those are
  separate workstreams (`leftover.md`); Phase 4/6 only harden the single-user
  self-host model.
- **No re-opening dismissed findings.** The five dismissed candidates (R1-R5 in
  the audit's "Investigated And Dismissed") are verified non-issues.
