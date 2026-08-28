# Test Suite Effectiveness Audit Phases

Date: 2026-08-29

This active index owns phase scope, dependencies, exit criteria, validation, and
slice rules. [`../status.md`](../status.md) is the live execution cursor.

| Phase | State   | Scope |
| ----: | ------- | ----- |
| [0](phase-0-baseline-inventory-and-rubric.md) | Complete | Baseline, exhaustive inventory, effectiveness rubric, and pilot. |
| [1](phase-1-assurance-architecture-and-special-lanes.md) | Complete | Runners, setup, discovery, CI, fixtures, helpers, gates, compatibility. |
| [2](phase-2-browser-state-sync-and-recovery.md) | Complete | Browser state synchronization, durable intent, and recovery. |
| [3](phase-3-persistence-commands-events-and-bridges.md) | Complete | Persistence, revisioned commands, events, and editing bridges. |
| [4](phase-4-app-navigation-chat-and-shared-ui.md) | Complete | Navigation, chat, shared UI, feedback, accessibility, responsive behavior. |
| [5](phase-5-settings-profiles-authoring-and-catalogs.md) | Complete | Settings, profiles, personas, characters, lorebooks, Realm, catalogs. |
| [6](phase-6-prompting-generation-and-streaming.md) | Complete | Prompt assembly, generation, SSE, cancellation, durability, Agent Presets. |
| [7](phase-7-providers-models-credentials-translation-and-media.md) | In progress | Providers, models, secrets, translation, image/audio/transcription. |
| [8](phase-8-memory-embeddings-jobs-and-workers.md) | Pending | Hypa memory, embeddings, summaries, jobs, ranking, workers, UI reconciliation. |
| [9](phase-9-scripting-parsing-triggers-and-automation.md) | Pending | CBS, regex, triggers, Lua, parsing, display transforms, automation. |
| [10](phase-10-plugins-modules-mcp-and-specialized-tools.md) | Pending | Plugins, modules, MCP, RisuAccess, Playground, developer tools. |
| [11](phase-11-assets-import-export-and-backups.md) | Pending | Assets, saves, imports, exports, Realm/CharX, backup and restore. |
| [12](phase-12-api-security-runtime-and-observability.md) | Pending | Auth, route protection, network limits, tracing, startup, operations. |
| [13](phase-13-cross-suite-consolidation-and-remediation.md) | Pending | Cross-category duplication, replacements, shared harnesses, parity, gaps. |
| [14](phase-14-verification-and-closeout.md) | Pending | Final count/effectiveness proof, quality aggregate, docs, archive handoff. |

## Slice Rules

- One slice is one audit or remediation batch with one primary category and one
  cohesive production/test boundary.
- Name every test file and production owner in scope. Do not use a directory glob
  as the only review evidence.
- Aim for roughly 40-70 ordinary files per audit batch, but isolate mega-suites,
  browser journeys, performance budgets, compatibility goldens, and shared
  harnesses when their complexity warrants it.
- Each slice records contract inventory, plausible defects, rubric evidence,
  companion layers, decisions, findings, implementation actions, file/case
  deltas, rollback, and validation.
- Review tests at their faithful layer. Do not mock away the behavior merely to
  make a test easier to keep, merge, or reclassify.
- A removal or merge must satisfy
  [`../plan.md#removal-and-consolidation-proof`](../plan.md#removal-and-consolidation-proof)
  in the same slice that changes the owner.
- Keep audit findings separate from production fixes when a discovered defect
  needs more than a narrow regression-backed correction.
- Author concrete slices under `slices/<phase-name>/` when a phase opens. Keep
  them small enough to resume from `../status.md` without repeating the audit.
- Update the inventory, [`../findings/`](../findings/),
  [`../latest-verification.md`](../latest-verification.md), and
  [`../status.md`](../status.md) whenever a slice or phase changes state.
- Do not mark a phase complete until every in-scope row has a disposition and
  every exit criterion passes or has an explicit deferred owner, reason, and
  revisit condition.

## Shared Audit Output

Every domain phase produces:

1. the exact inventory rows and supported production contracts reviewed;
2. Keep/Strengthen/Merge/Reclassify/Remove/Add/Defer decisions;
3. confirmed findings with severity and evidence;
4. intentional defense-in-depth notes for apparent duplicates that stay;
5. count and support-artifact deltas;
6. material uncovered behaviors and their owner;
7. validation results and residual risk.

## Shared Validation Floor

Every remediation slice runs:

1. focused changed tests in their owning project/lane;
2. `pnpm test:affected --dry-run` and every selected lane;
3. `pnpm check:frontend-test-inventory` when frontend discovery, suffixes,
   registrations, coverage ownership, or tracked frontend files change;
4. the complete frontend or server lane when a test is deleted, a shared
   harness/setup changes, or the behavior spans a broad contract;
5. formatting of changed files and `git diff --check`.

Additional gates:

- DOM-visible or component work: owning UI tests and `pnpm coverage:ui-map` when
  a sentinel or mapped surface changes.
- Real-browser, reload, multi-tab, screenshot, or responsive work:
  `pnpm test:smoke` or exact specs followed by the complete smoke lane before
  phase closeout.
- Prompt/generation compatibility: `pnpm test:compat-harness` when the baseline
  prerequisites are available; never refresh goldens without a separate
  intentional decision.
- Performance/capacity contracts: isolated performance or server load-cost tests
  with their documented worker limits.
- Runner, setup, coverage, aggregate, or CI changes: `pnpm test:all` before phase
  closeout.

Audit-only slices that change no code or tests still run formatting and
`git diff --check`; they record why broader execution was unnecessary.
