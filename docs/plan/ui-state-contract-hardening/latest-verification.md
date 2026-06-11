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

## Phase 1 Current Doc Policy Proof

Recorded on 2026-06-11 after the policy-core and structure-doc pointer slices
landed. This proof covers only the current-doc visible-state policy and pointers;
it does not prove later runtime selector, DOM workflow, browser smoke,
coverage-map, or closeout phases.

| Command                                                                                                                                                                                                  | Result  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `pnpm exec prettier --check STRUCTURE.md docs/archive/README.md docs/structure/testing-and-operations.md docs/structure/frontend.md docs/structure/server-projection-and-bridges.md 'docs/plan/**/*.md'` | Passed. |
| `git diff --check`                                                                                                                                                                                       | Passed. |

## Phase 2 Selector Hardening Proof

Recorded on 2026-06-11 after the Phase 2 selector-hardening slices landed. This
proof covers selector availability and migrated focused tests for chat lists,
generation settings controls/pickers, composer/message load pages, module
settings, grid catalog, and sidebar-tab prerequisites for Phase 3.

| Command                                                                                                                                                                                                             | Result                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run src/lib/SideBars/SideChatList.svelte.test.ts src/lib/Others/ChatList.svelte.test.ts src/lib/SideBars/chatGenerationSettingsControls.test.ts src/lib/Setting/pickerGenerationSettings.test.ts` | Passed: 4 files / 27 tests.                                                                                                                                                                                                                                                                                                                                         |
| `pnpm exec vitest run src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts src/lib/Others/GridCatalog.svelte.test.ts src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts`                                 | Passed: 3 files / 16 tests. Svelte emitted the existing `state_referenced_locally` warning for `src/lib/SideBars/LoreBook/LoreBookData.svelte:86`.                                                                                                                                                                                                                  |
| `pnpm check`                                                                                                                                                                                                        | Failed on the broad pre-existing baseline: `svelte-check` reported 34 errors and 1 warning in 21 files. Examples include missing `PromptItemSnapshot` in `PromptSettings.svelte`, fixture shape errors in generation-settings tests, SQLite row cast errors in `server/fastify/src/repository.ts`, and command/generation union-narrowing errors in Fastify routes. |
| `git diff --check`                                                                                                                                                                                                  | Passed.                                                                                                                                                                                                                                                                                                                                                             |

`pnpm check` does implicate Phase 2 validation files:
`src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts`,
`src/lib/Setting/pickerGenerationSettings.test.ts`, and
`src/lib/SideBars/chatGenerationSettingsControls.test.ts`. The focused Vitest
commands above passed for those files; the broad-check diagnostics are type
fixture/baseline issues rather than selector assertion failures. No Phase
2-owned selector component/runtime file was called out by `pnpm check`.

## Phase 3 Sidebar Route/Refreeze DOM Proof

Recorded on 2026-06-11 after the mounted DOM backfill landed as `65e869016`.
This proof covers the real mounted sidebar route/refreeze regression test, the
existing App route source-shape guard, and the nearby sidebar/router baseline.
`pnpm check` was not run for this proof-refresh slice.

| Command                                                                                   | Result                      |
| ----------------------------------------------------------------------------------------- | --------------------------- |
| `pnpm exec vitest run src/App.routeEffect.test.ts src/App.routeEffect.dom.test.ts`        | Passed: 2 files / 2 tests.  |
| `pnpm exec vitest run src/lib/SideBars/SideChatList.svelte.test.ts src/ts/router.test.ts` | Passed: 2 files / 14 tests. |
| `git diff --check`                                                                        | Passed.                     |

Formatting note: an initial
`pnpm exec prettier --check docs/plan/ui-state-contract-hardening/status.md docs/plan/ui-state-contract-hardening/latest-verification.md docs/plan/ui-state-contract-hardening/phases/README.md docs/plan/ui-state-contract-hardening/phases/phase-3-sidebar-route-refreeze-dom.md`
run failed because `latest-verification.md` needed Prettier formatting. After
`pnpm exec prettier --write` on the same files, the same Prettier check passed.
