# Original RisuAI Behavioral Compatibility Latest Verification

Date: 2026-08-30

## Current Verdict

Phase 0 is complete at Fastify evidence commit
`9ea7aa20dd5a93ac7e5c9112e8c8fbcb9fca1438`. Its baseline, authority-import,
register-validation, and four pilot gates pass. This is an opening-method
verdict, not yet a whole-product compatibility verdict; Phase 1 and domain
phases remain active.

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
| `pnpm prepare:compat-baseline -- --check` | Passed against the detached baseline |
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

## Update Rules

- Record exact commands, commit, environment, counts, artifacts, and failures.
- Preserve failed attempts that change an audit decision or expose a harness flaw.
- Separate current-only results from fork-point differential results.
- Never report a baseline parity result when the pinned baseline did not run.
- Move historical command records into phase/slice evidence only after verifying
  them against the current tree.
