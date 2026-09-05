# Maintainability and Performance Plan

Date: 2026-09-05

Closed on 2026-09-06. All ten findings and Phases 0–6 are accepted; see the
[final findings, measurements and residual owners](evidence/final-closeout.md)
and [execution/verification history](status.md). The original scope, phase
instructions and opening evidence below are retained as the historical plan;
current architecture guides remain authoritative for shipped behavior.

## Goal and Authority

Protect existing data and reduce work that scales with unrelated application
state. Make the affected ownership boundaries explicit enough that future
features do not silently reintroduce full-state operations.

This document owns scope, finding IDs, dependencies, invariants, and completion
criteria. `status.md` alone owns the moving execution cursor, implementation
commits, decisions, and verification results. Phase documents own detailed work
and acceptance criteria. Shipped behavior remains grounded in
[STRUCTURE.md](../../../STRUCTURE.md) and the
[current architecture guides](../../structure/README.md).

## Historical Basis

- [Mutation-range narrowing](../../../.archived-docs/protocol-and-persistence/mutation-range-narrowing/README.md)
  established targeted writers, physical-write metrics, and row-stability
  checks. It explicitly retained broad character creation as an infrequent
  operation. BardWiki's current foreign-key relationships invalidate the
  assumption that this remains merely a performance exception.
- [Frontend clone narrowing](../../../.archived-docs/performance-and-stability/frontend-performance/plan.md)
  established scoped rollback and clone-cost checks, while retaining broad
  snapshots for structural operations. Reuse that foundation and recheck the
  remaining callers against their actual mutation scope.
- [Cross-runtime boundaries](../../../.archived-docs/architecture-and-migration/cross-runtime-boundaries/PLAN.md)
  established protocol/shared-core ownership and the stable-plan, mutable-status,
  bounded-phase format used here. Existing package separation does not by itself
  prove that a prompt input typed as `any` is maintainable.

Archived plans explain previous decisions; their old commands, paths, and
completion claims are not current execution instructions. Do not reopen or
rewrite them to describe this work.

## Opening Evidence

Source anchor: `2a1abfbf937895d598b92dfd3724ef6a501dd7fd`
(`fix: allow durable BardWiki rebuild commands`). The audit inspected a clean
worktree at that anchor using eight independent read-only research areas, then
verified the retained findings against source.

Two observations have stronger evidence than a static performance hypothesis:

- **F01, reproduced correctness failure.** In separate disposable SQLite
  fixtures, both `POST /api/v1/commands/characters` and
  `POST /api/v1/commands/characters/create-and-select` returned HTTP 200. Each
  fixture started with one existing character/chat, one BardWiki settings row,
  one document, and one document version. After creating a second character,
  the original chat remained, but all three BardWiki row counts were zero.
  The explicit write metric also reported 16 table families; cascade effects
  require direct row assertions because that metric alone does not capture
  every foreign-key deletion. Phase 0 must make this reproduction a durable
  repository regression test; temporary audit scripts are not a dependency.
- **F06, measured build size.** A fresh `pnpm build:initial-preload` passed at
  the opening anchor. Initial JavaScript totaled 389,721 gzip bytes; the language
  chunk accounted for 291,801 gzip bytes, approximately 75%. Its raw size was
  904,254 bytes. These numbers describe the initial HTML preload closure, not
  all JavaScript loaded after application startup. Regenerate them for each
  implementation comparison; generated build artifacts are replaceable.

No production data or production latency measurements were collected. The
remaining findings establish work performed by live code, not its measured
user-visible duration. Reconfirm the anchor and applicable behavior before
editing; a later code change may already have resolved a finding.

## Finding Register

IDs correspond to the ten findings reported in the audit. Priority concerns
this workstream; it is not a claim about observed production frequency.

| ID | Finding and source owner | Evidence | Phase | Required outcome |
| --- | --- | --- | --- | --- |
| F01 | Broad character creation: `server/fastify/src/routes/commands.ts`, `server/fastify/src/commands/mutations.ts`, `server/fastify/src/repository.ts` | Reproduced data loss; urgent | 0 | Existing BardWiki and unrelated rows survive targeted creation and the confirmed Agent Preset deletion cleanup follow-up. |
| F02 | Generation preflight/assembly loads broad state and clones effective configuration: `server/fastify/src/routes/generationChat.ts`, `server/fastify/src/prompt/effectiveGenerationConfig.ts` | Verified mechanism; latency unmeasured | 3 | Ordinary generation preparation excludes unrelated corpus work; necessary dynamic access has explicit bounds. The existing configuration row and pre-extraction legacy input remain explicitly measured exceptions in Phase 3. |
| F03 | Sidebar folder/organization rollback snapshots all resident characters: `src/ts/chatCommands.ts`, `src/lib/SideBars/SideChatList.svelte` | Verified mechanism; latency unmeasured | 2a | Rollback captures only the affected fields/structure and preserves newer edits. |
| F04 | Resource reads await serialized cache persistence and cache-wide pruning: `src/ts/server/resourceCache.ts`, `src/ts/server/resourceReads.ts`, `src/ts/server/hydrationReads.ts` | Verified mechanism; latency unmeasured | 2c | Valid resource delivery does not await global eviction work. |
| F05 | Outbox staging repeats intent normalization and mutable-body cloning: `src/ts/server/pendingMutationOutbox.ts` | Verified mechanism; latency unmeasured | 2b | One owned normalized snapshot per staged intent; metadata extraction does not clone it again. |
| F06 | All seven locale packs enter the initial graph: `src/lang/index.ts`, `src/main.ts` | Fresh build measurement | 2d | Only the fallback and requested locale are needed to start; unused packs leave the initial closure. |
| F07 | Backup copying and asset GC run synchronously in the API process: `server/fastify/src/repository.ts`, `server/fastify/src/assetGc.ts`, `server/fastify/src/app.ts` | Verified mechanism; stall duration unmeasured | 4 | Long copy/scan work permits API progress without losing consistency. |
| F08 | Loaded transcript rows accumulate mounted components: `src/lib/ChatScreens/DefaultChatScreen.loadPages.ts`, `src/lib/ChatScreens/Chats.svelte` | Verified mechanism; practical threshold unmeasured | 5 | Measured decision on resident bounds; implement if justified and preserve navigation/accessibility. |
| F09 | Prompt database alias and extension fields erase type information: `server/fastify/src/prompt/serverTypes.ts` | Verified contract gap; no specific runtime mismatch reproduced | 3 | Production prompt entry boundaries use explicit domain views and checked dynamic fields. |
| F10 | Browser/server trigger compatibility logic is duplicated: `src/ts/process/triggerServerSupport.ts`, `server/fastify/src/prompt/triggerCompatibility.ts` | Identical source; parity mitigation exists | 6 | One neutral implementation, with both consumers and parity coverage. |

Other worker observations were not promoted into the audited ten-finding scope.
New concerns require their own evidence and an explicit scope decision in
`status.md`; discovering an adjacent shortcut does not silently expand a phase.

## Preserved Invariants

1. SQLite and content-addressed files remain authoritative. Browser caches stay
   disposable; the encrypted outbox retains pending intent, not accepted state.
2. Preserve the single-writer model, lineage checks, receipt idempotency, one
   revision/event per ordinary command, atomic rollback, and post-commit emission.
3. Optimistic UI still distinguishes accepted, queued, and failed. Narrow rollback
   must preserve unrelated changes, newer drafts, and authoritative refreshes.
4. Preserve supported prompt bytes/order, provider selection, credentials,
   agent/module/persona precedence, CBS/regex/Lua behavior, and durable effects.
   The F01 data-preservation correction is an intentional behavior change.
5. Performance work must not introduce unbounded caches, unauthenticated cache
   reuse, stale cross-lineage state, or payload/timeout-limit bypasses.
6. Preserve backup recoverability and asset-reference protection across awaits,
   cancellation, concurrent requests, imports, and server shutdown.
7. Preserve responsive mobile web, chat scroll anchors, streaming, editing,
   translation, and accessibility. Shared logic stays framework-neutral;
   authentication, persistence, credentials, and filesystem policy stay server-owned.

## Sequence and Work Units

| Phase | Outcome | Dependency |
| --- | --- | --- |
| [0. Character creation safety](phases/phase-0-character-creation-safety.md) | Reproduced data loss fixed with targeted writes and regression coverage. | Opening source confirmation only; do not wait for broad benchmarks. |
| [1. Baselines and acceptance budgets](phases/phase-1-baselines-and-budgets.md) | Comparable fixtures, cost measurements, and explicit completion targets. | Phase 0 accepted. |
| [2. Browser work reduction](phases/phase-2-browser-work.md) | Scoped rollback, single outbox normalization, deferred/coalesced cache maintenance, selected-locale loading. | Phase 1; execute 2a through 2d separately. |
| [3. Generation inputs and types](phases/phase-3-generation-inputs-and-types.md) | Narrow, typed preparation and deliberate dynamic-script access. | Phase 2 complete; Phase 1 generation baseline. |
| [4. Server maintenance scheduling](phases/phase-4-server-maintenance.md) | Responsive backup/GC work with explicit consistency boundaries. | Phase 3 correctness/type/structural gates and Phase 1 maintenance baseline; Phase 3 timing acceptance before Phase 4 acceptance. |
| [5. Transcript residency decision](phases/phase-5-transcript-residency.md) | Evidence-backed implementation or documented retention of current paging. | Phase 4 complete; remeasure after earlier UI changes. |
| [6. Shared policy and closeout](phases/phase-6-shared-policy-and-closeout.md) | Duplicate policy removed; all findings have verified dispositions and current docs. | Prior phase gates satisfied. |

Implement one bounded slice at a time. A phase may contain several separately
reviewable commits; phase order does not require a single large commit. Record
an evidence-backed sequencing change in `status.md` before following it. Use
read-only parallel research for architectural cross-checks where project guidance
applies; do not create concurrent edits to shared owners by default.

## Measurement and Acceptance Policy

- Prefer deterministic assertions about rows touched, clone scope/count, cache
  scans, bundle membership, or mounted rows. Timing complements these assertions.
- Measure unchanged and changed code with the same synthetic fixture, hardware,
  runtime, cache state, and concurrency. Record the commit, fixture dimensions,
  repetitions, and results. Keep secrets and user data out of fixtures/artifacts.
- Phase 1 sets numeric latency/residency targets from measurements before the
  relevant optimization starts. No invented millisecond target or historical
  budget increase is a substitute for showing improvement.
- F08 has an explicit measured decision gate. Other findings remain required
  work unless source evidence disproves them or an explicit plan amendment
  records the retained cost, rationale, owner, and revisit trigger. A deferred
  finding remains visibly deferred; it cannot count as an implemented fix.
- Preserve valid architectural tradeoffs. Do not remove required snapshots,
  revision fences, or durability merely to reduce an instrumentation counter.

## Validation and Completion

Use the current [test workflow](../../tests/README.md#running-the-suite), not
commands copied from historical plans. During a slice run
`pnpm test -- <one-test-or-source-file>` for a concrete diagnostic. When the
implementation batch is complete, run `pnpm test:agent`; add `pnpm check:docs`
for documentation changes. Exact browser/performance tests needed by the phase
are separate evidence: `test:agent` does not run Playwright or specialized
performance probes. The user/CI own `pnpm test:all` and compatibility harnesses;
record their evidence separately without claiming an agent aggregate covered them.

The default documentation validator excludes active plans. Validate this plan's
links and literal paths explicitly through `validateCurrentDocumentation` in
`util/current-documentation-validator.ts`, supplying the plan documents,
`indexSpecs: []`, and `literalPathExemptions: []`, as well as running the standard
current-document check. No validation-tool expansion is required by this plan.

Closeout requires all finding dispositions, phase evidence, and residual costs
to be recorded at an exact source anchor; passing tests alone is not proof of a
performance improvement. Update the affected current architecture guides after
behavior ships. Archive the intact workstream under
`.archived-docs/performance-and-stability/`, repair its links, update the archive
index, and remove its active-plan entry only after closeout.
