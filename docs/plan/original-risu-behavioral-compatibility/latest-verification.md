# Original RisuAI Behavioral Compatibility Latest Verification

Date: 2026-08-30

## Current Verdict

Phases 0 and 1 are complete. Phase 1 assurance evidence closes at
`546ea5aaee78144176043971fdd2c13c9e7c6079`, with selection ownership at
`6ddc82431230ee40cf9c4151d3388baab0162998`, CI ownership at
`328a70787c26051525a713fc86311fe672dd7b8b`, and the production semantic fix at
`c33dac56811c3c6c6bdf72f8ad3faac796abfe59`. Follow-up
`5b6a9d492beb399a58d9695097171a9c3edf1b4d` preserves prompt-preview diagnostics
while keeping persisted transcript metadata governed separately. The pinned
baseline, current-only harness, governed differential, register validation,
affected selection, and aggregate graph pass. This is an assurance-architecture
verdict, not yet a whole-product compatibility verdict; Phase 2 is in progress.

## Phase 0 Environment And Baseline Evidence

| Check | Result |
| --- | --- |
| Fastify evidence commit | `9ea7aa20dd5a93ac7e5c9112e8c8fbcb9fca1438` |
| Compatibility baseline | `71c476e9c86263fe907105b011ca4dde0a619d66` |
| Behavioral sync cursor | `f3f0242fba297d82e0efcc2c31ca1428569b70f2` |
| Node | `v24.19.0` |
| pnpm | `11.23.0` |
| Pinned baseline worktree | Clean, detached, exact at `/home/codex/risu-baseline-71c476e9c` |
| Moving upstream checkout | Left untouched at `/home/codex/Risuai`; not used as fork-point output authority |
| Baseline preparation | `pnpm prepare:compat-baseline` is idempotent and fails closed on wrong commit, attached branch, dirty state, or missing dependencies |
| Full differential | Passed: 16 baseline tests; 18 current/cluster tests; 16 compared cells; 15 explained divergences; cluster 10 healthy |

## Phase 0 Validation

| Command/check | Result |
| --- | --- |
| `pnpm exec vitest run util/compat-baseline.test.ts` | Passed; 6 tests |
| `pnpm exec tsx util/compat-baseline.ts --check` | Passed against the detached baseline |
| `pnpm exec vitest run util/validate-original-risu-compatibility-registers.test.ts` | Passed; 12 tests, including missing/null/order/repeated-value/endpoint negative cases |
| `pnpm validate:compat-registers` | Passed; 85 upstream units, 77 surfaces, 59 decisions, 14 findings, and 75 unique raw mappings |
| Pilot-focused Fastify Vitest command over seven owning files | Passed; 7 files and 522 tests |
| `pnpm check:server` | Passed protocol, client-declaration, browser-smoke, and Fastify typechecks |
| `pnpm test:affected --dry-run --base 9022d5bb45660ba50784e2324c93d339e75c96f9` | Selected the same seven pilot Fastify test files |
| `pnpm test:compat-harness` | Passed full pinned differential; counts recorded above |
| `pnpm exec prettier --check` for Phase 0 changes | Passed |
| `git diff --check` | Passed |

The pilot's direct Original-app reroll save exchange is not executable because
the pinned baseline harness mocks rerolls and exposes no save-exchange path. The
current codec test covers every supported `.risu` envelope and records this
specific residual/revisit condition rather than claiming unrun proof.

## Phase 1 Evidence

| Check | Result |
| --- | --- |
| Phase 1 closure and classified fixture provenance | `546ea5aaee78144176043971fdd2c13c9e7c6079` |
| Harness and governance foundation | `b0f06552dc84fc8c406c7279cd6330519d6c4db1` |
| Affected and aggregate ownership commit | `6ddc82431230ee40cf9c4151d3388baab0162998` |
| CI, cadence, and release-equivalent ownership commit | `328a70787c26051525a713fc86311fe672dd7b8b` |
| Semantic production correction | `c33dac56811c3c6c6bdf72f8ad3faac796abfe59` |
| Prompt preview/persistence contract follow-up | `5b6a9d492beb399a58d9695097171a9c3edf1b4d` |
| Category A inventory | 8 verified rows, `ORC-SURFACE-078` through `ORC-SURFACE-085`; total inventory 85 rows |
| Shared case matrix | 16 ordered cells: four scenarios × two transports × say-nothing enabled/disabled |
| Fixture/golden authority | 16 provenance case IDs, 6 governed manifest files, 23 decision-backed cell/aspect mappings |
| CI cadence | Main quality owns registers/current; full pinned differential runs daily at 06:00 UTC and by manual dispatch, with 14-day artifacts |
| Release-equivalent rule | Main quality and the full pinned differential must both succeed for the exact candidate revision |

## Phase 1 Validation

| Command/check | Result |
| --- | --- |
| `pnpm prepare:compat-baseline -- --check` | Failed as an invalid invocation: the package script already appends `--prepare`, so forwarding `-- --check` produced the fail-closed CLI usage error |
| `pnpm prepare:compat-baseline` | Passed; verified the clean detached baseline at `71c476e9c86263fe907105b011ca4dde0a619d66` |
| `pnpm exec tsx util/compat-baseline.ts --check` | Passed; direct read-only verification of the same clean detached baseline |
| `pnpm exec vitest run util/compat-baseline.test.ts test/compat-harness/governance.test.ts test/compat-harness/normalize.test.ts util/validate-original-risu-compatibility-registers.test.ts util/affected-tests.test.ts util/test-all.test.ts` | Passed; 6 files and 59 tests |
| `pnpm validate:compat-registers` | Passed; 85 upstream units, 85 inventory surfaces including all 8 Category A owners, 59 decisions, 14 findings, and 75 unique raw mappings |
| `pnpm test:affected --dry-run --base c33dac56811c3c6c6bdf72f8ad3faac796abfe59` | Passed; CI/config changes fail closed to `pnpm test:all` plus `pnpm test:compat-harness` |
| `pnpm test:all --dry-run` | Passed; 11 lanes, including register validation and an isolated current harness after registers |
| `pnpm test:compat-current` | Passed; 2 files and 18 tests, 16 current cells, cluster 10 healthy |
| `pnpm test:compat-harness` | Passed; baseline 1 file/16 tests and current 2 files/18 tests, 16 compared cells, 15 governed divergences, cluster 10 healthy |
| `pnpm exec prettier --check` for Phase 1 closure files | Passed |
| `git diff --check` | Passed |

The failed baseline command is retained because it corrected the command
contract: use the package script for prepare mode and the direct CLI for check
mode. It did not weaken or bypass baseline verification.

## Update Rules

- Record exact commands, commit, environment, counts, artifacts, and failures.
- Preserve failed attempts that change an audit decision or expose a harness flaw.
- Separate current-only results from fork-point differential results.
- Never report a baseline parity result when the pinned baseline did not run.
- Move historical command records into phase/slice evidence only after verifying
  them against the current tree.
