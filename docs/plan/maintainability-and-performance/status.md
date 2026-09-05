# Maintainability and Performance Status

Updated: 2026-09-05

## Execution Cursor

- State: Phases 0 and 1 accepted; executing Phase 2a browser rollback narrowing.
- Opening source: `2a1abfbf937895d598b92dfd3724ef6a501dd7fd`.
- Execution source: `2d9290bfc` (opening implementation plus plan), clean at task start.
- Next phase: [2. Browser work](phases/phase-2-browser-work.md), slice 2a.
- Next task: narrow sidebar folder/chat metadata capture, then organization
  rollback; preserve newer edits and authoritative projection fences.
- Blockers: none.
- Implementation commit: `491cc1820` fixes F01. Phase 1 probe commits and
  acceptance evidence are recorded below; Phase 2 implementation is next.

Read [PLAN.md](PLAN.md) for stable scope, evidence, and invariants; read only the
selected [phase](phases/README.md) for implementation detail.

## Phase Router

| Phase | Findings | State | Accepted implementation/evidence |
| --- | --- | --- | --- |
| [0. Character creation safety](phases/phase-0-character-creation-safety.md) | F01 | Accepted | Targeted append; 18 HTTP preservation/replay/rollback cases |
| [1. Baselines and budgets](phases/phase-1-baselines-and-budgets.md) | F02–F10 | Accepted | [Baselines and numeric budgets](evidence/baselines.md) |
| [2. Browser work](phases/phase-2-browser-work.md) | F03, F05, F04, F06 | Executing 2a; 2b–2d queued | Phase 1 budgets accepted |
| [3. Generation inputs and types](phases/phase-3-generation-inputs-and-types.md) | F02, F09 | Pending Phase 2 | None |
| [4. Server maintenance](phases/phase-4-server-maintenance.md) | F07 | Pending Phase 3 | None |
| [5. Transcript residency](phases/phase-5-transcript-residency.md) | F08 | Pending Phase 4; implementation decision open | None |
| [6. Shared policy and closeout](phases/phase-6-shared-policy-and-closeout.md) | F10; all closeout evidence | Pending prior phases | None |

## Finding Dispositions

| Finding | Disposition | Missing completion evidence |
| --- | --- | --- |
| F01 | Fixed; targeted creation and pre-normalization receipt fingerprint | Final combined aggregate remains pending |
| F02 | Open; source-confirmed work | Preparation baseline, narrowed reads/clones, behavior parity |
| F03 | Open; source-confirmed work | Scoped rollback and clone-scope proof |
| F04 | Open; source-confirmed work | Resource progress independent of pruning; cache lifecycle proof |
| F05 | Open; source-confirmed work | Single-normalization proof and durable-intent parity |
| F06 | Open; measured bundle cost | Selected-locale loading and fresh preload comparison |
| F07 | Open; source-confirmed work | Stall baseline, API progress, backup/GC consistency |
| F08 | Open; measurement required | Residency baseline and recorded implementation/retention decision |
| F09 | Open; source-confirmed type gap | Explicit prompt views and compiler-enforced boundary coverage |
| F10 | Open; source-confirmed duplication | Shared owner and unchanged consumer behavior |

## Verification Ledger

Distinguish audit observations, documentation checks, and implementation gates.
Do not carry an opening pass forward as proof of a later implementation commit.

| Scope | Source/date | Evidence | Limitation |
| --- | --- | --- | --- |
| Opening audit | Opening source, 2026-09-05 | Eight research areas cross-checked against source; both character creation endpoints reproduced BardWiki deletion in disposable SQLite fixtures. | Temporary reproductions are not checked-in regression tests; no production data inspected. |
| Opening preload | Opening source, 2026-09-05 | `pnpm build:initial-preload` passed; 389,721 total gzip bytes, 291,801 language gzip bytes. | Build sizes are not browser latency measurements or total post-startup transfer. |
| Plan review | Current documentation worktree, 2026-09-05 | Two read-only reviews completed; clarified cache-generation fences, nested prompt types, backup pins, and full-transcript screenshot exceptions. | Review of proposed work; no implementation evidence. |
| Plan documents | Opening source plus plan documents, 2026-09-05 | Explicit link/path validation passed for all 11 plan/index documents; `pnpm check:docs` passed for 49 current documents; whitespace checks passed. | Does not close implementation findings. |
| Agent aggregate | Opening source plus plan documents, 2026-09-05 | `pnpm test:agent` passed in 2m 16s: server/browser-smoke types, topology, current docs, frontend tests/check, server tests, and smoke build. | Excludes Playwright, specialized performance, and user/CI compatibility lanes; the new F01 regression is still future work. |

For each implemented slice add its source commit, fixture/reproduction, exact
commands and results, before/after cost, changed contract if any, and residual
risk. If evidence fails, record the failure and next action instead of advancing
the phase. Keep long generated logs outside this document; preserve the facts
needed to reproduce them here or in the owning phase's bounded slice record.

## Decisions and Exceptions

- The ten audited findings remain the scope. F01 is fixed; F02–F10 have accepted
  baselines but remain open until their implementation/decision phases. No
  finding has been silently deferred or added.
- Phase 0 precedes broad benchmarking because F01 is a reproduced correctness
  failure. Performance measurement must not delay its repair.
- F08 retains an implementation decision gate. A measured decision to keep
  paging must record its supported fixture envelope and revisit trigger.
- The single-writer model, durable outbox, revision/event ordering, and existing
  shared-package boundaries remain invariants, not optimization targets.

Future amendments belong here with date, affected finding, evidence, owner,
residual cost, and revisit condition. If an amendment changes stable scope or
phase dependencies, update `PLAN.md` and the affected phase at the same time.

## Phase 0 Accepted Evidence

- Source cross-check: both normal creation routes still invoke the broad
  message-free writer at the execution anchor. Six independent read-only Luna
  research areas were checked against live source; production edits remain
  sequential by owner.
- Foreign-key inventory: `chats` and `greeting_translations` cascade from
  `characters`. BardWiki settings/documents/receipts/jobs/search cascade from
  `chats`; versions, sources, links, manifests, and staging depend on those
  BardWiki rows. Messages and `chat_hypa_v3` are logical chat dependents without
  chat foreign keys. Preservation assertions must cover all of them directly.
- The new append path reads settings and an identity/trash-status projection
  for order validation, performs keyed duplicate checks, and inserts only the new
  character and optional empty chat. Existing single-writer transaction, receipt,
  revision, event, and post-commit emission boundaries are reused.
- Broad-writer inventory: after the creation cutover, ordinary
  `deleteAgentPresetCommand` remains a message-free caller; generic hydrated
  mutation and import/restore replacement helpers also retain broad writers.
  This is evidence of remaining cost/risk, not an implemented remedy. Phase 0
  does not widen into those owners; audit further at closeout before any scope
  decision. Import/restore replacement semantics remain intentional.
- Workflow interpretation: the current `AGENTS.md` and test guide require the
  aggregate only after all implementation work is complete. Phase-level checks
  therefore use exact focused tests; `pnpm test:agent` is the final combined gate.

- Durable reproduction: `characterCreationSafety.test.ts` failed on each opening
  route after HTTP 200: two existing BardWiki manifests became zero. The fixture
  seeds two characters/chats, four messages, two Hypa rows, greeting translations,
  all ten BardWiki families including resolved links/search, split collections,
  plugin storage, and a prior command receipt. SQL audit triggers detect physical
  rewrites even when rowids are reused. Both routes now preserve every old row.
- Explicit domain-table budget: 16 broad table families before; exactly
  `characters` + `settings` after, adding `chats` only for an initial chat. Normal
  revision/event/receipt infrastructure is asserted separately. Replay writes
  nothing and emits nothing; injected chat/event/receipt failures roll back all
  rows, revision, and audit triggers.
- The replay fixture exposed request normalization before receipt fingerprinting.
  Both routes now capture the submitted-intent fingerprint before normalization,
  including generated global-lore defaults and selection timestamps.
- Focused verification: `pnpm test --` followed by each of
  `server/fastify/__tests__/characterCreationSafety.test.ts` (18 passed),
  `server/fastify/__tests__/commands.test.ts` (241 passed),
  `server/fastify/__tests__/commandMutationReceipts.test.ts` (12 passed),
  `server/fastify/__tests__/commandSingleRowPaths.test.ts` (21 passed), and
  `server/fastify/__tests__/bardWikiLifecycle.test.ts` (8 passed).
  `pnpm check:docs` passed (49 current documents); explicit
  `validateCurrentDocumentation` with all ten workstream documents,
  `indexSpecs: []`, and `literalPathExemptions: []` passed. Prettier and
  whitespace checks passed. Final aggregate/browser/performance evidence is
  still pending, and these correctness tests make no latency claim.
- Residual cost: order validation visits existing character identities and
  extracts identity/trash status with SQLite JSON expressions; it does not
  materialize unrelated bodies in JavaScript. Legacy embedded-character state
  is rejected for explicit import/recovery rather than shadowed by an append.
  This prevents future deletion; recovery of historical production loss remains
  outside this local change.

## Phase 1 Accepted Evidence

- Browser structural probes and budgets: `f1fa4753b`,
  [F03/F04/F05 baseline](evidence/browser-work-baseline.md). Twelve focused
  cases pass; fixed-folder snapshot grows to 9,916,585 bytes, mutable outbox
  bodies normalize twice, and ten resource reads cause ten prune passes.
- Generation preparation/type inventory: `c5f58918f`,
  [F02/F09 baseline](evidence/generation-baseline.md). Two focused cases and the
  opt-in isolated timing run pass. Fixed target history with 48 unrelated owners
  loads 1,049,413 database bytes and 826 SQL result rows per preparation pass.
- Server maintenance: `dfb2d4db1`,
  [F07 baseline](evidence/maintenance-baseline.md). Isolated 20/200/2,000-asset
  matrix passes; zero API/heartbeat progress during GC or post-snapshot backup
  copying. Three measured repetitions plus one warmup per size are retained.
- Locale startup: `c25343989`, [F06 baseline](evidence/locale-baseline.md).
  Production initial preload repeats 389,721 gzip bytes; all twelve English/
  Korean cold/refresh cases show the requested first composer label and reach
  background readiness. Browser trace/readiness and production closure evidence
  remain separate. Repeated script closure lists are being deduplicated in the
  retained evidence without discarding individual timings or transfer totals.
- F10 source digests match and its four policy ownership/behavior tests pass.
- F08 probe: `c4cbb74ec`; [accepted isolated matrix and decision rule](evidence/transcript-baseline.md).
  All ten cases pass in 6.7 minutes. Corrected synthetic image bytes and excluded
  expensive trace recording before measurement. The nine profile/size cases use
  one journey each, 48-frame scroll samples and repeated 15-row page loads;
  screenshot capture/restoration is separate. Full cost matrix is opt-in.
- The large transcript fixtures pass scroll budgets but exceed the chosen
  incremental-page layout and post-GC heap comparison budgets. Deep jumps also
  issue 570 display-source requests; their full wall time cannot be attributed
  to DOM layout. F08's implementation/retention decision remains Phase 5 work.
- F06 retained script paths are deduplicated without changing individual
  milestone, first-label, gzip, encoded-body, or transfer measurements.
- Standard current-document and explicit workstream link/path validation passed.
  All phase-specific focused/browser/performance evidence is recorded in its
  owner. The final combined `pnpm test:agent` remains pending until implementation
  is complete, as required by current project guidance. User/CI compatibility
  and `pnpm test:all` have not been run or implied by these passes.
