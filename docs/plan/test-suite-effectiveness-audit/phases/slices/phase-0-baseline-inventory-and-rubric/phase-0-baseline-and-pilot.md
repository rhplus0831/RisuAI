# Phase 0 Slice: Baseline, Inventory, And Rubric Pilot

Date: 2026-08-29

Status: Complete.

## Scope And Anchor

This slice froze the pre-audit repository at clean commit
`56796fa5a2f651a791e19b4223337b98874efa97`, reconciled every tracked test and
support owner, added checked live inventories, measured the required lanes, and
applied the rubric to representative evidence before any test removal.

The inventory tooling added one focused frontend Node test file. The frozen
anchor therefore remains 698 files, while the live post-tooling inventory owns
699 files. This `+1` is an intentional assurance-infrastructure delta, not a
product-coverage claim.

## Reproducible Inventory

Machine-readable owners:

- [`../../../inventory.json`](../../../inventory.json): 699 disjoint test-file
  rows with lane, A-L primary category, seams, kind, dependency signals,
  specialized ownership, collected counts, and review metadata;
- [`../../../case-counts.json`](../../../case-counts.json): per-file collected
  case, skip, and parameterized-row evidence;
- [`../../../support-artifacts.json`](../../../support-artifacts.json): 253
  standalone support artifacts and 64 production files with explicit test-only
  seams;
- [`../../../frontend-routing-inventory.tsv`](../../../frontend-routing-inventory.tsv)
  is the checked N/S/D/B routing authority.

Current counts:

| Lane                 | Files | Cases | Skipped | Parameterized rows |
| -------------------- | ----: | ----: | ------: | -----------------: |
| Frontend Node        |   195 | 1,326 |       0 |                199 |
| Frontend Svelte+Node |    17 |   167 |       0 |                  0 |
| Frontend Happy-DOM   |   326 | 5,152 |       0 |                654 |
| Fastify Node         |   154 | 3,296 |       1 |                408 |
| Built Chromium       |     7 |    34 |       0 |                  0 |
| **Total**            | **699** | **9,975** | **1** | **1,261** |

The one skip is the direct-only Realm import scale case. It passed when invoked
by its documented direct-file command. `parameterizedRows` means collected
cases beyond non-`.each` source registrations; it is an explicit reproducible
matrix-row estimate, not an assertion-count metric.

Primary category ownership is exhaustive and disjoint:

| Category | Files | Category | Files |
| -------- | ----: | -------- | ----: |
| A        |    19 | G        |    95 |
| B        |    32 | H        |    43 |
| C        |    52 | I        |    42 |
| D        |   112 | J        |    47 |
| E        |    96 | K        |    38 |
| F        |    90 | L        |    33 |

No fallback rule owns a current row. Ordered boundary rules resolve apparent
multi-category paths, while other matches remain seam tags.

## Support Universe

The 253 standalone rows are disjoint:

| Role                         | Files |
| ---------------------------- | ----: |
| Runner, config, CI, manifests |    30 |
| Performance/budget tooling   |     4 |
| Compatibility harness        |    13 |
| Prompt/send fixture corpus   |   130 |
| Shared helpers and harnesses |    71 |
| Snapshots/screenshots        |     5 |

The 64 mixed production seams remain production owners. They are listed
separately because treating them as removable helper files would be unsafe.
Generated state, ordinary test files, inline test-local fixtures, general
production subjects, and the external compatibility worktree are intentionally
excluded as documented in the manifest.

## Ratified Rubric Pilot

The pilot uses the value classes, decisions, severities, and removal proof in
[`../../../plan.md`](../../../plan.md) without a numeric score. A file-level
decision appears in the live inventory only when the complete file was
reviewed. Selected cases from a larger file remain `pending` with
`pilot-partial` evidence.

| Evidence owner | Pilot role and plausible defect | Decision |
| -------------- | ------------------------------- | -------- |
| `pendingMutationOutbox.crossTab.test.ts` (all 6 cases) | Critical data-integrity/security matrix: duplicate cross-tab order or AES-GCM IV reuse after a losing CAS. Transaction and Chromium companions fail for different reasons. | Keep |
| Selected atomicity/recovery cases in `pendingMutationOutbox.test.ts` | Transaction split, corrupt counter recovery, or retained-intent loss. The remaining mega-suite families stay pending Phase 2. | Partial; pending file disposition |
| Two repaint matrices in `chatGenerationSettingsControls.test.ts` | Visible controls can stay bound to the previous chat after either local index change or authoritative projection replacement. Similar output, distinct invalidation defects. | Keep selected defense in depth; pending file disposition |
| Sanitized failure case in Fastify `providerOperations.test.ts` | Mocked upstream boundary could leak provider diagnostics or a credential draft in exact route JSON. | Keep selected case; pending file disposition |
| `packages/protocol/src/importBoundary.test.ts` | Non-recursive and static-regex discovery may miss nested modules, dynamic imports, or `require`. | Strengthen; `TSA-P00-001` |
| `personaDisplayName.test.ts` (both cases) | Whitespace/default mapping or search alias can regress despite mounted consumers mocking the helper. | Keep |
| `terminalFrameAssertions.test.ts` (all 9 cases) | A shared oracle could accept duplicate, misordered, or success-shaped aborted terminals. Negative counterexamples establish sensitivity. | Keep |
| `renderCostHarness.test.ts` (all 5 cases) | Variable-only refresh may broaden into transcript reparse/cache invalidation proportional to visible history. | Keep in isolated gate |
| Compatibility harness, 16 matrix cells and 4 goldens | Composed current-stack changes could alter transcript/request semantics or an intentional baseline divergence. | Keep support owner; execution blocked by missing pinned worktree |

The pilot also preserved the first measured frontend red baseline as
`TSA-P00-002`: one retryable translator-preset delete case failed in the full
lane, passed alone, and the next full lane passed. The evidence confirms
load/order sensitivity but not yet whether the product or harness owns the
race, so the 68-case file remains pending.

No Remove or Merge decision was accepted. The mandatory removal proof is
ratified unchanged: contract disposition, equivalent-failure or counterfactual
evidence, defense-in-depth analysis, support-consumer cleanup, discovery and
affected routing, owning lanes and special gates, and durable count/finding
records are all required in the same remediation slice.

## Baseline Environment

- Node `v24.19.0`; local pnpm `11.23.0`; Vitest `4.1.2`; Playwright `1.62.1`.
- Chrome for Testing `151.0.7922.34`, Playwright Chromium revision directory
  `chromium-1234`.
- Linux `7.0.0-30-generic`, x86_64, KVM; 10 available AMD Ryzen 9 9950X
  virtual CPUs.
- CI intentionally installs pnpm 10; local/CI package-manager skew is recorded
  for Phase 1 rather than treated as equivalent timing evidence.

## Command Evidence And Residuals

- First measured full frontend: 6,637 passed / 1 failed in 81.52 s, peak RSS
  4,561,420 KiB. The failed case became `TSA-P00-002`.
- Next full frontend: 6,638/6,638 passed in 73.96 s, peak RSS 4,831,652 KiB.
- Fastify: 3,295 passed / 1 direct-only skipped in 20.29 s and 17.48 s;
  direct Realm scale case passed in 3.15 s.
- Browser smoke build: 11.25 s, peak RSS 2,729,400 KiB. Chromium: 34/34
  passed without retry/flake in 62.44 s, peak RSS 1,162,396 KiB.
- Special gates: 38/38 passed in 11.78 s. UI map: 203/203 passed in
  20.29 s and met its configured thresholds.
- Broad frontend coverage passed: 70.56% lines, 67.48% statements, 65.23%
  functions, 60.75% branches. Broad backend coverage passed: 87.55% lines,
  85.13% statements, 92.95% functions, 74.89% branches. These are report-only.
- Compatibility was attempted and stopped before execution because
  `/home/codex/risu-baseline-71c476e9c` is missing. No golden was changed. The
  exact pinned worktree and dependencies remain the revisit condition.
- Inventory checks, focused utility tests, affected dry-run, aggregate dry-run,
  Prettier, and diff checks passed.

Durations are environment observations, not performance claims. Two measured
frontend/Fastify observations and one isolated browser observation are
insufficient for a new budget; no median-based threshold was introduced.

## Next Exact Slices

Phase 1 opens with `P01-S01 — Frontend discovery, capability routing, and live
manifest`, covering the root Vitest configs, routing registry/tests, special
registries, both inventory utilities/tests, the checked manifests, package
scripts, aggregate/affected integration, CI job, and authoritative testing
documentation. Global setup/mock semantics remain the next Phase 1 slice.

The first Phase 2 domain slice is `P02-S01 — Encrypted outbox atomicity,
cross-tab ordering, and reload recovery`, initially owning
`pendingMutationOutbox.test.ts`, `pendingMutationOutbox.crossTab.test.ts`, and
the exact recovery journeys in `startupRecoveryIntegrationMatrix.spec.ts`.
