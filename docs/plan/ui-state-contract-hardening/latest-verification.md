# Latest Verification

Date: 2026-06-11

This file records proof for the active UI state contract hardening plan. Update
it after each phase lands.

## Setup Proof

Supervisor-local commands run during plan creation:

| Command                                                                                                   | Result                                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run`                                                                                                | Passed. Confirmed `smoke:fastify-browser` now invokes `pnpm build:site`.                                                              |
| `rg -n "buildsite\|build:site\|smoke:fastify-browser" README.md docs package.json STRUCTURE.md AGENTS.md` | Found current-doc `buildsite` references, which Phase 0 repaired. Remaining non-plan `buildsite` references are archive records only. |

Sub-agent audit reported additional focused validation for current
generation-settings and route/refreeze baselines:

| Area                                                  | Reported Result                                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Generation-settings focused client coverage           | Passed: 9 files / 90 tests.                                                                        |
| Generation-settings focused server/import coverage    | Passed: 4 files / 176 tests.                                                                       |
| TypeScript project-reference checks                   | Passed: client-lib build and strict Fastify server check.                                          |
| Existing App route/source and sidebar/router baseline | Passed: `src/App.routeEffect.test.ts`, `SideChatList.svelte.test.ts`, and `src/ts/router.test.ts`. |

These sub-agent results are audit inputs, not phase closeout proof for future
edits.

## Plan Validation

Supervisor-local commands after creating the active plan:

| Command                                                                                                                                                                                                                | Result  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `pnpm exec prettier --check package.json README.md STRUCTURE.md docs/archive/README.md docs/structure/testing-and-operations.md docs/structure/frontend.md docs/structure/generated-and-legacy.md 'docs/plan/**/*.md'` | Passed. |
| `git diff --check`                                                                                                                                                                                                     | Passed. |

## Sub-Agent Audit And Slice Split Refresh

Recorded on 2026-06-11 after ten read-only sub-agent audit passes and
supervisor-local plan updates. The audit found the plan valid after corrections
for slice dependencies, Phase 3 sidebar selector prerequisites, Phase 4
feasibility/rollback notes, Phase 5 coverage-map output, and Phase 6 closeout
validation.

| Command                                                                      | Result  |
| ---------------------------------------------------------------------------- | ------- |
| `pnpm exec prettier --check 'docs/plan/ui-state-contract-hardening/**/*.md'` | Passed. |
| `git diff --check`                                                           | Passed. |

Audit artifacts added:

- [`audit.md`](audit.md): validity verdict, unexpected work, and slice map.
- [`phases/slices/`](phases/slices/): 23 agent-executable slices across Phases
  0-6.

These results are docs-only audit proof, not implementation closeout proof for
future phase edits.
