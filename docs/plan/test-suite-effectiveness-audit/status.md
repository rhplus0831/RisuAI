# Test Suite Effectiveness Audit Status

Date: 2026-08-29

This is the live execution router for the test-suite effectiveness workstream.
Keep durable scope and decision rules in [`plan.md`](plan.md), phase gates under
[`phases/`](phases/), findings under [`findings/`](findings/), and command proof
in [`latest-verification.md`](latest-verification.md).

## Current Snapshot

- Plan state: Active; planning scaffold complete.
- Current phase: Phase 0 — Baseline, Inventory, And Rubric.
- Active slice: None; the first Phase 0 inventory slice is ready to author.
- Implementation state: No test or production behavior has changed. The audit
  and remediation pass has not begun.
- Blockers: None.
- Next action: Freeze the Phase 0 commit/toolchain, generate the exhaustive audit
  inventory, ratify the effectiveness rubric on a representative pilot, and
  record the full baseline command matrix.

## Planning Baseline

| Measurement                          | Result                                       |
| ------------------------------------ | -------------------------------------------- |
| Tracked `*.test.ts` / `*.spec.ts`    | 698 files                                    |
| Full frontend Vitest universe        | 537: 194 N / 17 S / 326 D                    |
| Standalone ordinary frontend         | 535: 194 N / 17 S / 324 D                    |
| `test:all` ordinary frontend         | 529: 193 N / 17 S / 319 D                    |
| Fastify Vitest                       | 154 files                                    |
| Browser smoke                        | 7 files                                      |
| Compatibility harness                | Opt-in; outside `test:all` and file count     |
| Primary-category assignments         | 0 of 698 ratified                            |
| Effectiveness decisions              | 0 ratified                                   |
| Findings                             | None; Phase 0 has not opened the ledger      |

The tracked file count and frontend routing check were refreshed during plan
creation. Test-case counts, support-artifact counts, runtime measurements, and
per-category totals remain Phase 0 work.

## Phase Router

| Phase | State   | Purpose                                                                 |
| ----: | ------- | ----------------------------------------------------------------------- |
| [0](phases/phase-0-baseline-inventory-and-rubric.md) | Ready | Freeze the baseline, exhaustive inventory, rubric, and evidence format. |
| [1](phases/phase-1-assurance-architecture-and-special-lanes.md) | Pending | Audit runners, setup, discovery, CI, fixtures, helpers, and special gates. |
| [2](phases/phase-2-browser-state-sync-and-recovery.md) | Pending | Audit browser state synchronization, durable intent, and recovery. |
| [3](phases/phase-3-persistence-commands-events-and-bridges.md) | Pending | Audit persistence, commands, events, and editing bridges. |
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
| Keep       |     0 | Distinct contract and suitable evidence layer.             |
| Strengthen |     0 | Valuable intent, but insufficient or self-fulfilling proof. |
| Merge      |     0 | Equivalent failure mode can move into a stronger owner.    |
| Reclassify |     0 | Valuable test belongs to another category, lane, or type.  |
| Remove     |     0 | No meaningful unique value after mandatory removal proof.  |
| Add        |     0 | Material uncovered contract requires new proof.            |
| Pending    |   698 | Known test owners awaiting Phase 0 inventory and review.    |

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

## Blockers And Accepted Gaps

- Blockers: None.
- Accepted gaps: None. Phase 0 will define the recorded-gap format and revisit
  requirements.

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
