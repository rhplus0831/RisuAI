# Original RisuAI Behavioral Compatibility Audit Status

Date: 2026-08-30

This is the live execution router. Keep stable scope, taxonomy, evidence rules,
and stopping gates in [`PLAN.md`](PLAN.md); semantic and decision rules in
[`CONTRACT.md`](CONTRACT.md); phase details under [`phases/`](phases/); canonical
findings under [`findings/`](findings/); inventory ownership under
[`inventory/`](inventory/); and command proof in
[`latest-verification.md`](latest-verification.md).

## Current Snapshot

- Plan state: Active.
- Current phase: Phase 4 — navigation, chat, shared UI, and presentation.
- Active slice: [Phase 4 navigation, chat, shared UI, and presentation](phases/phase-4-navigation-chat-and-shared-ui.md).
- Planning audit anchor: `1933c43ff7b4d35b57b0852013d95f3881a8cb28`.
- Compatibility baseline: `71c476e9c86263fe907105b011ca4dde0a619d66`.
- Behavioral sync cursor: `f3f0242fba297d82e0efcc2c31ca1428569b70f2`.
- Toolchain observed at opening: Node `v24.19.0`; pnpm `11.23.0`.
- Opening worktree state: clean.
- Full differential prerequisite: available as a clean detached worktree at
  `/home/codex/risu-baseline-71c476e9c`; its exact commit, dependency state, and
  cleanliness are enforced by `pnpm prepare:compat-baseline` and the harness
  preflight.
- Current compatibility state: Phases 2 and 3 are complete at
  `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74`; the post-correction full pinned
  differential passed with 16 baseline cells, 18 current and cluster tests, 15
  governed baseline/current divergences, and healthy cluster 10.
- Canonical findings: 15 resolved findings: 14 historical imports with exact raw
  mappings plus the Phase 1 lossless-normalizer finding `ORC-A-015`.
- Open maintainer decisions: four historical unsupported statements remain
  `proposed` because their sources do not identify individual authority.
- Next action: execute the Phase 4 navigation/chat/shared-UI audit using the
  completed state, command, event, and bridge ownership gates.

## Phase Router

| Phase | Status | Outcome |
| ---: | --- | --- |
| [0. Cursors, contract, inventory, and pilot](phases/phase-0-cursors-contract-and-inventory.md) | Complete | Frozen references, exact authority import, fail-closed registers, reproducible baseline, and four verified pilots. |
| [1. Harness and assurance architecture](phases/phase-1-harness-and-assurance-architecture.md) | Complete | Made baselines, fixtures, differential/expected-difference ownership, affected selection, CI, and release gates reproducible. |
| [2. Browser state synchronization and recovery](phases/phase-2-browser-state-sync-and-recovery.md) | Complete | Re-verified bootstrap projections, writer/observer boundaries, outbox/receipts, replay, reconnect, reload, and recovery lineage. |
| [3. Persistence, commands, events, and bridges](phases/phase-3-persistence-commands-events-and-bridges.md) | Complete | Closed command, durable-field, SQLite, event/resource, replay, and editing-bridge ownership. |
| [4. Navigation, chat, shared UI, and presentation](phases/phase-4-navigation-chat-and-shared-ui.md) | In progress | Verify visible navigation, chat, composer, transcript, hotkey, focus, feedback, and responsive behavior. |
| [5. Settings, profiles, authoring, and catalogs](phases/phase-5-settings-profiles-authoring-and-catalogs.md) | Pending | Verify defaults, legacy shapes, presets, personas, characters, lorebooks, catalogs, and authoring workflows. |
| [6. Prompting, generation, and streaming](phases/phase-6-prompting-generation-and-streaming.md) | Pending | Verify model-visible assembly, transcript mutation, stream/cancel/retry/reattach, and finalization. |
| [7. Providers, models, translation, and media](phases/phase-7-providers-models-translation-and-media.md) | Pending | Verify capability/resolution, credentials, endpoints, provider wire contracts, translation, and media behavior. |
| [8. Memory, embeddings, jobs, and workers](phases/phase-8-memory-embeddings-jobs-and-workers.md) | Pending | Verify retained memory selection, context truncation, jobs, retries, cancellation, and reconciliation. |
| [9. Scripting, parsing, triggers, and automation](phases/phase-9-scripting-parsing-triggers-and-automation.md) | Pending | Verify CBS, regex, Lua, trigger/script ordering and state, transformations, and explicit unsupported effects. |
| [10. Plugins, modules, MCP, and specialized tools](phases/phase-10-plugins-modules-mcp-and-specialized-tools.md) | Pending | Verify retained extension data/APIs/lifecycle, permissions, tools, and no-port boundaries. |
| [11. Assets, imports, exports, saves, and backups](phases/phase-11-assets-import-export-and-backups.md) | Pending | Verify references, codecs, salvage, staged assets, historical formats, and bidirectional round trips. |
| [12. Runtime, platform, limits, and diagnostics](phases/phase-12-runtime-platform-and-diagnostics.md) | Pending | Verify shared platform behavior, visible rejection/diagnostics, browser/server environment, startup/shutdown, and Push. |
| [13. Consolidation, adjudication, and remediation](phases/phase-13-consolidation-adjudication-and-remediation.md) | Pending | Deduplicate findings, settle decisions, land shared gates and fix waves, and close cross-domain ownership. |
| [14. Verification and closeout](phases/phase-14-verification-and-closeout.md) | Pending | Prove zero unexplained differences, complete decisions, final quality/release gates, current docs, and archive handoff. |

## Phase 0 Completion Record

- `STRUCTURE.md` records the behavioral sync cursor separately from the Git fork
  point.
- The archived upstream ledger covers `71c476e9c..f3f0242fb` and records that all
  units were dispositioned before the base advanced.
- The baseline object exists in both repositories; a detached clean worktree was
  prepared without moving `/home/codex/Risuai`, and preflight rejects a wrong
  commit, attached branch, dirty tree, or missing dependencies.
- The upstream register contains all 85 first-parent units in exact Git order,
  with historical disposition kept separate from current verification.
- The registers contain 77 initial surfaces, 59 historical decisions (55 signed
  and four authority-pending), 14 resolved findings, and all 75 historical raw
  reports mapped exactly once.
- The four pilots are verified by production-path tests for preset field
  completeness, persisted translation dispatch, Responses request ownership,
  and portable reroll candidates through all supported `.risu` codecs.

## Phase 1 Completion Record

- The pinned baseline, shared 16-cell schema, semantic normalizer, fixture and
  golden manifests, and decision-backed expected-difference registry fail
  closed at `546ea5aaee78144176043971fdd2c13c9e7c6079`, including explicit fixture-source
  classifications.
- The inactive-generation-metadata mismatch was corrected at its production
  owner in `c33dac56811c3c6c6bdf72f8ad3faac796abfe59`; normalization did not hide it.
- Prompt-preview diagnostics were kept distinct from persisted transcript
  metadata in the follow-up `5b6a9d492beb399a58d9695097171a9c3edf1b4d`.
- Affected and aggregate selection own register validation, current-only
  compatibility, and required full-pinned selection at
  `6ddc82431230ee40cf9c4151d3388baab0162998`.
- Main quality CI, daily/manual pinned cadence, artifact retention, and
  release-equivalent evidence ownership are recorded at
  `328a70787c26051525a713fc86311fe672dd7b8b`.
- Category A inventory rows `ORC-SURFACE-078` through `ORC-SURFACE-085` own the
  eight assurance surfaces and their exact implementation and test evidence.

## Phase 2 Completion Record

- Shared projection normalization across shell, full-settings, cache, and group
  reads, legacy `pip` migration, selection repair, and lineage-preserving
  response/SSE parsing landed at
  `3ce85c1f034b3afc493e291f8a8f5e9227064463`.
- The audit caught a valid partial-object fallback regression in that change;
  `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74` preserves persisted partial values
  while still defaulting invalid shell fields.
- Durable writer, observer, outbox, receipt, replay, response-loss, reconnect,
  takeover, and reload owners were re-verified through focused and built-browser
  evidence.
- Category B rows `ORC-SURFACE-086` through `ORC-SURFACE-088` own the new
  assurance surfaces; historical rows `ORC-SURFACE-023` and `ORC-SURFACE-072`
  are verified with no residual.

## Phase 3 Completion Record

- `958f8585138ec817fe5d134563df585434ed5821` pins all 161 command routes, 422
  retained Database fields, 46 SQLite tables and exact columns, 146 command
  events, browser resource reconciliation, replay ordering, and six built-in
  durable editing bridges.
- The same change restored six retained legacy-memory settings to the writable
  command catalog and represented both retained auto-continue interchange fields
  in the current Database type.
- `3f20a80b780f2538fd1e38aa6514d9a9f894985a` accepts only exact BardWiki
  preview/dry-run eventless receipts while keeping mutating receipts event-bound.
- Category C rows `ORC-SURFACE-089` through `ORC-SURFACE-093` own the new
  structural surfaces; historical rows `ORC-SURFACE-024`, `ORC-SURFACE-025`,
  `ORC-SURFACE-061`, and `ORC-SURFACE-073` are verified.
- Focused production, structural, browser event, and recovery lanes passed at
  `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74`, followed by the required full
  pinned differential. The canonical inventory now contains 93 rows.

## Locked Planning Decisions

- The fork point and behavioral sync cursor remain separate authorities.
- Upstream disposition and Fastify behavioral verification remain separate
  inventory fields.
- User-visible compatibility wins by default; exceptions require individual
  authority.
- Physical Fastify architecture may differ when observable behavior remains
  compatible.
- Unsupported/no-port behavior must be absent, explicit, or visibly diagnosed;
  silent partial behavior is not accepted.
- The workstream uses the current project taxonomy and `PLAN.md` + `status.md` +
  phase-file structure.
- Closure requires the pinned full differential; current-only goldens cannot
  substitute for baseline proof.
- No phase closes with unowned pending rows or unsigned expected differences.

## Maintenance Rules

- This file is the only live phase/slice router.
- Update it whenever a slice changes state, a finding is confirmed, a decision is
  signed, a blocker changes, or validation runs.
- Record the current Fastify verification commit for every completed domain
  phase; do not imply that the planning anchor covers later implementation.
- Keep durable rules in `PLAN.md`/`CONTRACT.md` and detailed evidence in the
  owning phase, inventory, finding, or verification file.
- Do not mark a phase complete while tests fail, a required baseline is absent,
  or a correctness gap lacks an explicit owner and revisit condition.
