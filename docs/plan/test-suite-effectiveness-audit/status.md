# Test Suite Effectiveness Audit Status

Date: 2026-08-29

This is the live execution router for the test-suite effectiveness workstream.
Keep durable scope and decision rules in [`plan.md`](plan.md), phase gates under
[`phases/`](phases/), findings under [`findings/`](findings/), and command proof
in [`latest-verification.md`](latest-verification.md).

## Current Snapshot

- Plan state: Active; Phases 0-2 complete and Phase 3 in progress.
- Current phase: Phase 3 — Persistence, Commands, Events, And Bridges.
- Active slice: Phase 3 exact inventory review covers the 52 category-C owners
  and their persistence, mutation, receipt, event, and editing bridge seams.
- Implementation state: exhaustive test/case/support manifests and their local,
  affected, aggregate, coverage, and CI checks are live. The protocol import
  policy uses recursive AST evidence and the Realm scale case has isolated local
  and CI owners. No product behavior or existing product test has been removed.
- Blockers: the full differential compatibility harness cannot run because its
  pinned external worktree is absent. The new current-only owner is green; the
  blocker applies only to historical baseline claims.
- Next action: audit the first cohesive Phase 3 persistence/command batch and
  record case-level contracts, overlap, and dispositions.

## Planning Baseline

| Measurement                          | Result                                       |
| ------------------------------------ | -------------------------------------------- |
| Frozen tracked anchor                | 698 files at `56796fa5a2f651a791e19b4223337b98874efa97` |
| Live tracked test/spec universe      | 699 files (`+1` inventory-tool test)         |
| Full frontend Vitest universe        | 538: 195 N / 17 S / 326 D                    |
| Standalone ordinary frontend         | 536: 195 N / 17 S / 324 D                    |
| `test:all` ordinary frontend         | 530: 194 N / 17 S / 319 D                    |
| Fastify Vitest                       | 154 files                                    |
| Browser smoke                        | 7 files                                      |
| Compatibility harness                | Current-only green; full differential blocked |
| Collected cases                      | 10,009 total; 1 direct-only skip; 1,261 parameterized rows |
| Support owners                       | 253 standalone; 65 mixed production seams   |
| Primary-category assignments         | 699 of 699 ratified                          |
| Complete file dispositions           | 51 Keep / 1 Reclassify                       |
| Findings                             | 26 done / 1 confirmed / 2 deferred           |

The 698-file rows preserve the plan-creation anchor. The live counts, support
owners, runtime evidence, and category totals are checked by the Phase 0
manifests and verification record.

## Phase Router

| Phase | State   | Purpose                                                                 |
| ----: | ------- | ----------------------------------------------------------------------- |
| [0](phases/phase-0-baseline-inventory-and-rubric.md) | Complete | Froze the baseline, exhaustive inventory, rubric, and evidence format. |
| [1](phases/phase-1-assurance-architecture-and-special-lanes.md) | Complete | Audited runners, setup, discovery, CI, fixtures, helpers, and special gates. |
| [2](phases/phase-2-browser-state-sync-and-recovery.md) | Complete | Audited browser state synchronization, durable intent, and recovery. |
| [3](phases/phase-3-persistence-commands-events-and-bridges.md) | In progress | Audit persistence, commands, events, and editing bridges. |
| [4](phases/phase-4-app-navigation-chat-and-shared-ui.md) | Pending | Audit app navigation, chat, shared UI, feedback, and accessibility. |
| [5](phases/phase-5-settings-profiles-authoring-and-catalogs.md) | Pending | Audit settings, profiles, character authoring, and catalogs. |
| [6](phases/phase-6-prompting-generation-and-streaming.md) | Pending | Audit prompting, generation, streaming, and durable finalization. |
| [7](phases/phase-7-providers-models-credentials-translation-and-media.md) | Pending | Audit providers, models, credentials, translation, and media. |
| [8](phases/phase-8-memory-embeddings-jobs-and-workers.md) | Pending | Audit memory, embeddings, summaries, jobs, and workers. |
| [9](phases/phase-9-scripting-parsing-triggers-and-automation.md) | Pending | Audit scripting, parsing, triggers, Lua, and automation. |
| [10](phases/phase-10-plugins-modules-mcp-and-specialized-tools.md) | Pending | Audit plugins, modules, MCP, Playground, and specialized tools. |
| [11](phases/phase-11-assets-import-export-and-backups.md) | Pending | Audit assets, imports, exports, saves, and backups. |
| [12](phases/phase-12-api-security-runtime-and-observability.md) | Pending | Audit API security, runtime, limits, tracing, and operations. |
| [13](phases/phase-13-cross-suite-consolidation-and-remediation.md) | Pending | Resolve cross-suite duplication, removals, replacements, and gaps. |
| [14](phases/phase-14-verification-and-closeout.md) | Pending | Verify final effectiveness, counts, documentation, and closeout. |

See [`phases/README.md`](phases/README.md) for links and shared slice rules.

## Decision Totals

| Decision   | Count | Meaning                                                    |
| ---------- | ----: | ---------------------------------------------------------- |
| Keep       |    51 | Distinct contract and suitable evidence layer.             |
| Strengthen |     0 | Valuable intent, but insufficient or self-fulfilling proof. |
| Merge      |     0 | Equivalent failure mode can move into a stronger owner.    |
| Reclassify |     1 | Valuable test belongs to another category, lane, or type.  |
| Remove     |     0 | No meaningful unique value after mandatory removal proof.  |
| Add        |     0 | Material uncovered contract requires new proof.            |
| Pending    |   647 | Known test owners awaiting their owning phase review.       |

## Current Decisions

1. Use product risk as the primary category and runtime/lane as a secondary
   tag. Do not split companion client/server contracts merely because they live
   in different directories.
2. Give every tracked test exactly one primary audit owner. Record cross-domain
   seams as tags rather than reviewing the same file as complete scope in
   multiple phases.
3. Treat the assurance-infrastructure phase as the one intentional horizontal
   review. Browser specs still retain a product-domain owner for their behavior.
4. Do not set a target test-count reduction. Success is stronger signal, less
   false confidence, and justified maintenance cost.
5. Do not remove a test solely because it is narrow, implementation-aware,
   duplicated at another evidence layer, slow, flaky, or outside a coverage
   threshold. Apply the complete removal proof first.
6. Keep current testing and architecture documents authoritative until accepted
   findings land.
7. Keep the routing TSV separate from the effectiveness inventory; the former
   enforces capability placement, while the latter preserves reviewed audit
   metadata and cross-lane ownership.
8. Count a pilot decision at file level only when the complete file was
   reviewed. Larger files with selected pilot cases remain Pending and record a
   `pilot-partial` state.

## Blockers And Accepted Gaps

- Blocker: `/home/codex/risu-baseline-71c476e9c` is absent, so the compatibility
  harness cannot execute. Revisit when the exact pinned worktree and its
  dependencies exist; never substitute another checkout or refresh goldens.
- Confirmed gap: `TSA-P00-002` (load/order-sensitive translator preset retry
  case) has a concrete owner and revisit condition. `TSA-P00-001` is remediated.
- Deferred migration: `TSA-P01-017` bounds the resource-database adapter's
  claims; Phases 3/6/11 migrate consumers and Phase 13 removes the helper.
- Deferred browser fidelity: `TSA-P02-009` bounds IndexedDB/Web Locks, cache
  pressure, manifest-independence, cleanup-spy, and authoritative-reread claims.
  Revisit in Phase 13 or 14 if the harness gains persistent multi-page and
  IndexedDB fault injection.

## Maintenance Rules

- Update this file whenever a phase or slice changes state or decision totals
  change materially.
- Keep this file a router, not a chronological implementation diary.
- Record every accepted finding and removal permanently in
  [`findings/README.md`](findings/README.md) or a linked phase ledger.
- Record commands and results in [`latest-verification.md`](latest-verification.md),
  including red attempts that materially affect a decision.
- A deferred item requires an owner, evidence-based reason, and concrete revisit
  condition; "later" is not a disposition.
