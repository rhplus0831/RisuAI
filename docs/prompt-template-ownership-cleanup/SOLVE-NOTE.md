# Solve Note

This file is for future agents implementing or revising the prompt template
ownership cleanup plan.

## Current Manager Mandate

Continue acting as the manager for this workstream, even after context
compression. The current user asked for this process:

1. Read this workstream's `README.md` and plan how to complete it.
2. Keep this file updated with the execution plan and role instructions.
3. Spawn an explorer agent to verify task details and determine the concrete
   solve path.
4. After explorer results, spawn a worker agent with a fresh context to perform
   the implementation.
5. After worker completion, spawn a verification agent to validate the result.
6. If verification succeeds, run required formatting/checks, commit the changes,
   close finished agents, and move to the next incomplete task or phase.
7. If verification fails, close or reuse agents appropriately and spawn/send the
   worker a focused fix request. Repeat worker -> verifier until the plan is
   complete or a real blocker is recorded.

Close every sub-agent once its final result has been consumed. Do not leave
completed agents open.

## Execution Plan

1. Reconfirm the current code state before each phase with `rg` and focused file
   reads. The plan anchors are conceptual, not line-stable.
2. Treat Phase 0 as decided unless source review finds a contradiction. Its
   contract is: modern `promptPresets[].promptTemplate` owns normal prompt
   template data; top-level `promptTemplate` is only a migration
   projection/cache; chat-scoped `generationSettings.promptPresetId` wins for
   generation and must not silently fall back when stale.
3. Phase 1 runtime resolver slice is implemented: shared server/browser
   effective prompt template resolution is used by prompt assembly and helper
   reads, with top-level fallback only when no modern prompt preset owner is
   resolved.
4. Continue through Phase 2 only after independent Phase 1 verification: make
   prompt item command/projection/hydration paths owner-aware and
   prompt-preset-scoped.
5. Continue through Phase 3 after command ownership is stable: update Prompt
   Settings and related bridge/UI controls to edit the selected prompt preset,
   with hydration and stale-selection protections.
6. Continue through Phase 4 after the editor uses modern ownership: remove or
   gate silent legacy bot-preset prompt-template copy behavior and add/keep an
   explicit extraction/conversion path.
7. Continue through Phase 5: align generation, loadouts, imports/exports, and
   remaining compatibility mirrors so stale top-level template data cannot win.
8. Finish with Phase 6: run the focused client/server suites, TypeScript checks,
   `git diff --check`, Prettier, and browser smoke with `pnpm dev:agent` when UI
   workflows changed. Stop the dev server before finishing.
9. Update `status.md`, `latest-verification.md`, and relevant structure docs as
   phases complete or if exact gaps remain.

## Manager Instructions

1. Read `README.md`, `status.md`, `plan.md`, and `phases/README.md` before
   choosing a phase.
2. Re-check source symbols before editing. Paths in the plan are anchors, not a
   substitute for reading current code.
3. Keep phases narrow. Do not mix resolver, command, UI, legacy compatibility,
   and final cleanup in one patch unless the user explicitly asks for a large
   integrated change.
4. Prefer owner-aware, row-oriented commands for prompt preset edits. Avoid
   whole-array writes unless a phase explicitly accepts that tradeoff.
5. Preserve legacy bot preset import/export compatibility until a phase
   explicitly retires it.
6. Treat missing prompt-template bodies carefully. In the current projection
   model, missing can mean "not hydrated" rather than "disabled."
7. Run Prettier before committing if implementation work is done.

## Important Current Facts

- `promptPresets` already exist and include `promptTemplate` in their field
  contract.
- Prompt Settings currently edits `DBState.db.promptTemplate`, not a prompt
  preset row directly.
- The prompt-template bridge currently optimizes row-level edits against the
  top-level prompt-template collection.
- Server prompt item commands currently write `prompt_templates`.
- Legacy bot preset apply currently copies preset template data into the active
  top-level prompt template.
- Server and browser prompt assembly now resolve effective prompt template reads
  from chat/global prompt presets before top-level compatibility fallback.
- The Fastify variation is unreleased, so source-level storage reshaping is
  allowed without a formal user-data migration promise.

## Recommended Next Slice

Phase 1 has been implemented and the focused resolver parity fix has passed
local validation. The next recommended slice is Phase 2: make prompt item
commands, projection, hydration, and bridge rollback prompt-preset-owner-aware
without changing the Settings UI in the same patch.
