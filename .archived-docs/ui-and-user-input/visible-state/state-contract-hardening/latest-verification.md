# Latest Verification

Date: 2026-06-11

This file records proof for the archived UI state contract hardening workstream.
Historical command rows are preserved as they were recorded during the plan.

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
| `pnpm exec prettier --check package.json README.md STRUCTURE.md .archived-docs/README.md docs/structure/testing-and-operations.md docs/structure/frontend.md docs/structure/generated-and-legacy.md 'docs/plan/**/*.md'` | Passed. |
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
| `pnpm exec prettier --check STRUCTURE.md .archived-docs/README.md docs/structure/testing-and-operations.md docs/structure/frontend.md docs/structure/server-resources-and-bridges.md 'docs/plan/**/*.md'` | Passed. |
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

## Phase 4 Composed Generation Settings UI Proof

Recorded on 2026-06-11 after the composed generation-settings UI slices landed
as `2841acfd1`, `90035dbc7`, `2139c7d22`, `28a64e5ba`, and `b6627d2a8`.
This proof covers the required lower-layer generation-settings coverage plus
the new visible workflow tests for:

- sidebar `Toggles` plus app-level preset/persona pickers selecting chat-owned
  settings without retargeting global preset/persona state;
- incomplete imported-chat setup labels, send guarding, composer preservation,
  and visible remediation to ready state;
- missing/deleted preset or persona readiness without silently selecting
  global/default rows;
- mounted `characterRow` projection updates to labels and controls without a
  remount;
- failed optimistic save rollback visibly restoring chat-owned labels and
  controls.

No Phase 4 feasibility assertion was skipped.

| Command                                                                                                                                                                                                                                                                                                                                                       | Result                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `pnpm exec vitest run src/ts/chatGenerationSettings.test.ts src/ts/activeChatGenerationSettings.test.ts src/lib/SideBars/chatGenerationSettingsControls.test.ts src/lib/Setting/pickerGenerationSettings.test.ts src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts src/ts/chatCommands.test.ts` | Passed: 7 files / 89 tests.  |
| `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveBundleImportRoute.test.ts server/fastify/__tests__/realmImport.test.ts`                                                                                        | Passed: 4 files / 176 tests. |
| `pnpm exec prettier --check docs/plan/ui-state-contract-hardening/README.md docs/plan/ui-state-contract-hardening/status.md docs/plan/ui-state-contract-hardening/latest-verification.md docs/plan/ui-state-contract-hardening/phases/README.md docs/plan/ui-state-contract-hardening/phases/phase-4-composed-generation-settings-ui.md`                      | Passed.                      |
| `git diff --check`                                                                                                                                                                                                                                                                                                                                            | Passed.                      |

## Phase 5 Browser Smoke And Coverage Map Proof

Recorded on 2026-06-11 after the visible Fastify browser smoke and coverage-map
profile slices landed. This proof covers the Phase 5 browser smoke assertions
and opt-in UI coverage-map workflow only. It does not claim coverage thresholds.

| Command                                                                                                                                                                                                                                                                                                                                 | Result                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm smoke:fastify-browser`                                                                                                                                                                                                                                                                                                            | Passed: `pnpm build:site` completed and Playwright ran 2 Fastify browser smoke specs / 2 tests. The build emitted existing CSS pseudo-element, browser-externalization, plugin-timing, Svelte, dynamic-import, and chunk-size warnings. |
| `pnpm coverage:ui-map`                                                                                                                                                                                                                                                                                                                  | Passed: 6 files / 38 tests. The command emitted a text coverage table and wrote JSON summary plus HTML coverage reports under `coverage/ui-map`.                                                                                        |
| `pnpm exec prettier --check docs/plan/ui-state-contract-hardening/status.md docs/plan/ui-state-contract-hardening/latest-verification.md docs/plan/ui-state-contract-hardening/README.md docs/plan/ui-state-contract-hardening/phases/README.md docs/plan/ui-state-contract-hardening/phases/phase-5-browser-smoke-and-coverage-map.md` | Passed after formatting this proof section.                                                                                                                                                                                             |
| `git diff --check`                                                                                                                                                                                                                                                                                                                      | Passed after this proof refresh.                                                                                                                                                                                                        |

Coverage artifact details verified locally:

- `coverage/ui-map/coverage-summary.json` exists and contains the JSON summary.
- `coverage/ui-map/index.html` exists as the HTML entry point.
- `coverage/ui-map` also contains HTML support files such as `base.css`,
  `block-navigation.js`, `prettify.js`, `sorter.js`, and per-directory report
  folders for `lib/` and `ts/`.
- `coverage/` is ignored by `.gitignore`, and `.prettierignore` also excludes
  `coverage`, so coverage-map artifacts are kept local by policy.

## Phase 6 Verification Closeout Proof

Recorded on 2026-06-11 for the final-validation-matrix slice. This slice did
not archive or move files. The required TypeScript order was preserved:
`pnpm exec tsc -p tsconfig.client-lib.json` ran before
`pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.

The matrix is not green. Focused App/UI-state proof, browser smoke, coverage
map, the client-lib declaration build, and whitespace diff checks passed, but
the broad client tests, Fastify API tests, broad `pnpm check`, and strict
Fastify server TypeScript check failed. Archive closeout remains pending.

| Command                                                                                                                                                                                                                                                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run src/App.routeEffect.test.ts src/App.routeEffect.dom.test.ts`                                                                                                                                                                                          | Passed: 2 files / 2 tests.                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm exec vitest run src/lib/SideBars/SideChatList.svelte.test.ts src/lib/Others/ChatList.svelte.test.ts src/lib/SideBars/chatGenerationSettingsControls.test.ts src/lib/Setting/pickerGenerationSettings.test.ts src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts` | Passed: 5 files / 38 tests.                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm test`                                                                                                                                                                                                                                                                 | Failed: 2 failed files / 177 passed (179); 3 failed tests / 1578 passed / 4 skipped (1585); 62 unhandled errors. Representative diagnostics: `Settings.svelte.test.ts` expected `SettingsMenuIndex` `77` but received `-1`; `sendCloneCountProbe.test.ts` failed because chat generation settings were incomplete; repeated unhandled `db.modules.filter` errors came from `src/ts/process/modules.ts:380`.          |
| `pnpm api:test`                                                                                                                                                                                                                                                             | Failed: 2 failed files / 99 passed (101); 30 failed tests / 1961 passed / 1 skipped (1992). Representative diagnostics: 21 `durableGeneration.test.ts` failures with empty job ids, 404 cancel responses, 409 `chat_generation_settings_incomplete`, and timeouts; 9 `serverLoadCostHarness.test.ts` failures with expected 200 responses receiving 409 plus K1 timeouts.                                            |
| `pnpm smoke:fastify-browser`                                                                                                                                                                                                                                                | Passed: `pnpm build:site` completed and Playwright ran 2 Fastify browser smoke specs / 2 tests. The build emitted existing CSS `::highlight`, browser-externalization, plugin-timing, Svelte `state_referenced_locally`, dynamic-import, and chunk-size warnings.                                                                                                                                                    |
| `pnpm coverage:ui-map`                                                                                                                                                                                                                                                      | Passed: 6 files / 38 tests. The command emitted a text coverage table and wrote JSON summary plus HTML reports under `coverage/ui-map`; all-file coverage summary was 6.12% statements, 4.08% branches, 4.09% functions, and 6.91% lines.                                                                                                                                                                            |
| `pnpm check`                                                                                                                                                                                                                                                                | Failed on the broad baseline: `svelte-check` reported 37 errors and 1 warning in 22 files. Representative diagnostics include missing `PromptItemSnapshot`, the Phase 3 DOM test `Database` fixture cast, generation-settings fixture/result shape errors, `Uint8Array<ArrayBufferLike>` type mismatches, SQLite row cast errors, command/generation union-narrowing errors, and missing `AppConfig.importMaxBytes`. |
| `pnpm exec tsc -p tsconfig.client-lib.json`                                                                                                                                                                                                                                 | Passed with no output.                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`                                                                                                                                                                                                                    | Failed with exit code 2. Representative diagnostics: many `TS6305` errors said expected `dist/client-types/...` declaration outputs had not been built from their source files after the client-lib command, followed by strict errors such as implicit `any` parameters in server tests/prompt files and unknown-key diagnostics in `prompt/cbsCallbackMemo.ts`.                                                    |
| `git diff --check`                                                                                                                                                                                                                                                          | Passed before documentation edits and again after formatting the two edited markdown files.                                                                                                                                                                                                                                                                                                                          |
| `pnpm exec prettier --write docs/plan/ui-state-contract-hardening/status.md docs/plan/ui-state-contract-hardening/latest-verification.md`                                                                                                                                   | Passed: `status.md` was unchanged by Prettier and `latest-verification.md` was formatted.                                                                                                                                                                                                                                                                                                                            |

Narrower/focused proof was not used to replace failed broad commands: the
focused App route/refreeze and UI-state suites passed before the broad failures
above, and those failures remain recorded as blockers for archive readiness.

## Phase 6 Final Validation Rerun Proof

Recorded on 2026-06-11 after the repair slices/commits addressed the failed
broad client/API, `pnpm check`, and strict Fastify server TypeScript rows from
the red attempt above. This supervisor-local rerun is green and makes archive
closeout the next pending action; this proof refresh did not archive or move
files.

The required TypeScript order was preserved: the client-lib declaration build
ran before the strict Fastify server check.

| Command                                                                                                                                                                                                                                                                     | Result                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm exec vitest run src/App.routeEffect.test.ts src/App.routeEffect.dom.test.ts`                                                                                                                                                                                          | Passed: 2 files / 2 tests.                                                                                                                                                                                                                                                                                                           |
| `pnpm exec vitest run src/lib/SideBars/SideChatList.svelte.test.ts src/lib/Others/ChatList.svelte.test.ts src/lib/SideBars/chatGenerationSettingsControls.test.ts src/lib/Setting/pickerGenerationSettings.test.ts src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts` | Passed: 5 files / 38 tests.                                                                                                                                                                                                                                                                                                          |
| `pnpm test`                                                                                                                                                                                                                                                                 | Passed: 179 files / 1581 tests passed / 4 skipped. The command printed repeated nonfatal `ECONNREFUSED 127.0.0.1:3000` logs from endpoint probes, but exited 0.                                                                                                                                                                      |
| `pnpm api:test`                                                                                                                                                                                                                                                             | Passed: 101 files / 1991 tests passed / 1 skipped.                                                                                                                                                                                                                                                                                   |
| `pnpm smoke:fastify-browser`                                                                                                                                                                                                                                                | Passed: `pnpm build:site` completed and Playwright ran 2 browser smoke tests / 2 passed. Build emitted existing CSS `::highlight`, browser externalization, plugin timing, Svelte `state_referenced_locally`, ineffective dynamic import, and chunk-size warnings; Playwright emitted the existing `NO_COLOR`/`FORCE_COLOR` warning. |
| `pnpm coverage:ui-map`                                                                                                                                                                                                                                                      | Passed: 6 files / 38 tests. The text coverage table emitted and JSON summary plus HTML reports were written under `coverage/ui-map`; summary was 6.12% statements, 4.08% branches, 4.09% functions, and 6.91% lines. Existing Svelte warning appeared in `src/lib/SideBars/LoreBook/LoreBookData.svelte:86`.                         |
| `pnpm check`                                                                                                                                                                                                                                                                | Passed with 0 errors and 1 warning: the existing Svelte `state_referenced_locally` warning in `src/lib/SideBars/LoreBook/LoreBookData.svelte:86`.                                                                                                                                                                                    |
| `pnpm exec tsc -p tsconfig.client-lib.json`                                                                                                                                                                                                                                 | Passed.                                                                                                                                                                                                                                                                                                                              |
| `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit --pretty false`                                                                                                                                                                                                     | Passed. The client-lib check ran first.                                                                                                                                                                                                                                                                                              |
| `git diff --check && git status --short`                                                                                                                                                                                                                                    | Passed with no output.                                                                                                                                                                                                                                                                                                               |

## Archive Closeout Proof

Recorded on 2026-06-11 after moving the completed workstream from
`docs/plan/ui-state-contract-hardening/` to
`.archived-docs/ui-and-user-input/visible-state/state-contract-hardening/`, updating archive navigation, and
refreshing `STRUCTURE.md` current-state wording. This proof preserves the red
Phase 6 attempt and the green rerun above as historical closeout context.

| Command                                                                                                             | Result  |
| ------------------------------------------------------------------------------------------------------------------- | ------- |
| `pnpm exec prettier --check STRUCTURE.md .archived-docs/README.md '.archived-docs/ui-and-user-input/visible-state/state-contract-hardening/**/*.md'` | Passed. |
| `git diff --check`                                                                                                  | Passed. |
