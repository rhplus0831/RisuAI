# Test Suite Effectiveness Audit Status

Date: 2026-08-29

This is the live execution router for the test-suite effectiveness workstream.
Keep durable scope and decision rules in [`plan.md`](plan.md), phase gates under
[`phases/`](phases/), findings under [`findings/`](findings/), and command proof
in [`latest-verification.md`](latest-verification.md).

## Current Snapshot

- Plan state: Active; Phases 0-11 complete and Phase 12 in progress.
- Current phase: Phase 12 — API Security, Runtime, And Observability.
- Active slice: Phase 12 opens with 42 category-L owners and 432 authentication,
  authorization, network-policy, request-limit, tracing, startup/shutdown, and
  platform-runtime cases, including 81 parameterized rows: 21 Fastify owners /
  270 cases, 11 frontend Node owners / 77 cases, and 10 frontend DOM owners / 85
  cases.
- Implementation state: exhaustive test/case/support manifests and their local,
  affected, aggregate, coverage, and CI checks are live. The protocol import
  policy uses recursive AST evidence and the Realm scale case has isolated local
  and CI owners. Phase 5 added a mounted PersonaSettings owner, strengthened
  stable authoring targets and rejected-operation recovery. Phase 6 fixed
  prompt budget, Agent cancellation/output/progress, and SSE lifecycle defects;
  added browser response-loss proof; and corrected 18 product-risk owners.
  Phase 7 fixed provider credential/endpoint binding, stream errors,
  translation cache identity, request-history redaction, async polling, media
  URL encoding, and SigV4 oracle quality while correcting eight category
  boundaries. Phase 8 fixed stale memory snapshots and transcript-derived
  chunks, credential diagnostics, Float32 overflow, legacy salvage, embedding
  cache identities, subscriber/cancellation isolation, and bounded terminal
  history while correcting 17 category boundaries. Phase 9 fixed CBS recursion,
  server/client regex execution and output bounds, Lua/Python recovery and
  deadlines, UTF-8 response limits, nested Trigger V2 validation, and script
  cache identity while correcting four category boundaries. Phase 10 fixed
  delayed plugin callbacks, MCP body/frame/pagination bounds, RisuAccess stable
  mutation identity, module memo invalidation, image-translation teardown, and
  internal tool support while correcting five category boundaries. Phase 11
  preserved portable rerolls, bounded and disambiguated save/archive framing,
  rewrote all legacy backup references, rolled back failed CharX assets,
  contained PDF/inlay cleanup, disabled unusable Fastify remote blocks,
  corrected 17 category boundaries, and removed one proven-dead Kei adapter.
- Blockers: the full differential compatibility harness cannot run because its
  pinned external worktree is absent. The new current-only owner is green; the
  blocker applies only to historical baseline claims.
- Next action: audit authentication and route protection, proxy/egress policy,
  request and decompression limits, abort propagation, tracing/redaction,
  startup/shutdown, service workers, and production observability; then complete
  every Phase 12 disposition.

## Planning Baseline

| Measurement                          | Result                                       |
| ------------------------------------ | -------------------------------------------- |
| Frozen tracked anchor                | 698 files at `56796fa5a2f651a791e19b4223337b98874efa97` |
| Live tracked test/spec universe      | 700 files                                    |
| Full frontend Vitest universe        | 538: 194 N / 17 S / 327 D                    |
| Standalone ordinary frontend         | 536: 194 N / 17 S / 325 D                    |
| `test:all` ordinary frontend         | 530: 193 N / 17 S / 320 D                    |
| Fastify Vitest                       | 155 files                                    |
| Browser smoke                        | 7 files                                      |
| Compatibility harness                | Current-only green; full differential blocked |
| Collected cases                      | 10,170 total; 1 direct-only skip; 1,319 parameterized rows |
| Support owners                       | 252 standalone; 64 mixed production seams   |
| Primary-category assignments         | 700 of 700 ratified                          |
| Complete file dispositions           | 586 Keep / 82 Reclassify; 2 removed historical owners |
| Findings                             | 130 done / 11 deferred                       |

The 698-file rows preserve the plan-creation anchor. The live counts, support
owners, runtime evidence, and category totals are checked by the Phase 0
manifests and verification record.

## Phase Router

| Phase | State   | Purpose                                                                 |
| ----: | ------- | ----------------------------------------------------------------------- |
| [0](phases/phase-0-baseline-inventory-and-rubric.md) | Complete | Froze the baseline, exhaustive inventory, rubric, and evidence format. |
| [1](phases/phase-1-assurance-architecture-and-special-lanes.md) | Complete | Audited runners, setup, discovery, CI, fixtures, helpers, and special gates. |
| [2](phases/phase-2-browser-state-sync-and-recovery.md) | Complete | Audited browser state synchronization, durable intent, and recovery. |
| [3](phases/phase-3-persistence-commands-events-and-bridges.md) | Complete | Audited persistence, commands, events, and editing bridges. |
| [4](phases/phase-4-app-navigation-chat-and-shared-ui.md) | Complete | Audited app navigation, chat, shared UI, feedback, and accessibility. |
| [5](phases/phase-5-settings-profiles-authoring-and-catalogs.md) | Complete | Audited settings, profiles, character authoring, and catalogs. |
| [6](phases/phase-6-prompting-generation-and-streaming.md) | Complete | Audited prompting, generation, streaming, and durable finalization. |
| [7](phases/phase-7-providers-models-credentials-translation-and-media.md) | Complete | Audited providers, models, credentials, translation, and media. |
| [8](phases/phase-8-memory-embeddings-jobs-and-workers.md) | Complete | Audited memory, embeddings, summaries, jobs, and workers. |
| [9](phases/phase-9-scripting-parsing-triggers-and-automation.md) | Complete | Audited scripting, parsing, triggers, Lua, and automation. |
| [10](phases/phase-10-plugins-modules-mcp-and-specialized-tools.md) | Complete | Audited plugins, modules, MCP, Playground, and specialized tools. |
| [11](phases/phase-11-assets-import-export-and-backups.md) | Complete | Audited assets, imports, exports, saves, and backups. |
| [12](phases/phase-12-api-security-runtime-and-observability.md) | In progress | Audit API security, runtime, limits, tracing, and operations. |
| [13](phases/phase-13-cross-suite-consolidation-and-remediation.md) | Pending | Resolve cross-suite duplication, removals, replacements, and gaps. |
| [14](phases/phase-14-verification-and-closeout.md) | Pending | Verify final effectiveness, counts, documentation, and closeout. |

See [`phases/README.md`](phases/README.md) for links and shared slice rules.

## Decision Totals

| Decision   | Count | Meaning                                                    |
| ---------- | ----: | ---------------------------------------------------------- |
| Keep       |   586 | Distinct contract and suitable evidence layer.             |
| Strengthen |     0 | Valuable intent, but insufficient or self-fulfilling proof. |
| Merge      |     0 | Equivalent failure mode can move into a stronger owner.    |
| Reclassify |    82 | Valuable test belongs to another category, lane, or type.  |
| Remove     |     2 | Historical owner removed after mandatory replacement proof. |
| Add        |     3 | Historical owner added for a material uncovered contract.  |
| Pending    |    32 | Known live test owners awaiting their owning phase review.  |

Keep, Reclassify, and Pending partition the 700 live rows. Remove and Add are
durable action-ledger counts; the added Button, PersonaSettings, and local
backup owners are already included in Keep, while the removed Mobile and Kei
owners are no longer live rows.

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
- Closed suspicion: `TSA-P00-002` passed in isolation and under later exact and
  complete load; retain its regression and reopen only with a reproducible
  seed/order trace.
- Deferred migration: `TSA-P01-017` bounds the resource-database adapter's
  claims; Phases 3/6/11 migrate consumers and Phase 13 removes the helper.
- Deferred browser fidelity: `TSA-P02-009` bounds IndexedDB/Web Locks, cache
  pressure, manifest-independence, cleanup-spy, and authoritative-reread claims.
  Revisit in Phase 13 or 14 if the harness gains persistent multi-page and
  IndexedDB fault injection.
- Deferred persistence hardening: `TSA-P03-008` bounds historical fixture
  fidelity, stable-ID fail-close hardening, mounted-component rollback, and
  multi-step browser mutation claims. Revisit during Phase 13 consolidation or
  Phase 14 verification when the exact baseline or stronger browser fault
  injection is available.
- Deferred visible UI fidelity: `TSA-P04-019` bounds real visible
  send/attach/stream/abort/reload, true mobile/touch and Firefox/WebKit,
  stacked-alert/onboarding/full-screen accessibility, and broader UI-map
  claims. Phase 13 owns additions; Phase 14 must make the final residual
  decision.
- Deferred authoring composition and asset cleanup: `TSA-P05-013` routes
  save-then-stale asset cleanup to Phase 11, representative settings/restore
  composition to Phase 13, and the final residual decision to Phase 14.
- Deferred generation fidelity and recovery: `TSA-P06-013` routes malformed
  finalization-journal/runtime observability to Phase 12, response-loss/effect/
  provider-browser/prompt-walker composition to Phase 13, and the historical
  compatibility plus final residual decision to Phase 14.
- Deferred provider and media fidelity: `TSA-P07-013` routes credential/runtime
  observability to Phase 12, recorded-provider/browser/media composition to
  Phase 13, and the Ollama policy, historical compatibility, and final residual
  decision to Phase 14.
- Deferred memory lifecycle fidelity: `TSA-P08-012` routes worker/query
  observability to Phase 12, live browser/provider/restart composition and the
  summarized-memory invalidation policy to Phase 13, and historical
  compatibility plus the final residual decision to Phase 14.
- Deferred scripting/runtime fidelity: `TSA-P09-011` routes queued runtime and
  timeout observability to Phase 12, CBS/trigger parity and saved-definition
  browser composition to Phase 13, and historical compatibility plus the final
  residual decision to Phase 14.
- Deferred extension/tool fidelity: `TSA-P10-011` routes uploaded-asset cleanup
  to Phase 11, plugin proxy/runtime threat modeling to Phase 12, bounded real
  browser/MCP composition and support policy to Phase 13, and historical
  compatibility plus the final residual decision to Phase 14.
- Deferred asset/save fidelity: `TSA-P11-012` routes post-upload abort,
  request-limit, and tracing ownership to Phase 12; streaming/materialization,
  central asset-owner parity, and bounded browser import/restore composition to
  Phase 13; and independent historical fixture plus final residual-support
  verdicts to Phase 14.

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
