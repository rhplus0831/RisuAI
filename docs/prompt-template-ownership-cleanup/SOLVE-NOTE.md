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
4. Phase 2 command/projection/hydration slice is implemented: prompt item
   commands accept optional `promptPresetId`, scoped edits write the owning
   prompt preset row, hydration/projection are owner-aware, and debounced bridge
   edits drop stale selected-preset owners before send.
5. Phase 3 Settings UI ownership is implemented: Prompt Settings now sources
   its template draft from the selected prompt preset first, Bot Settings gates
   and toggles prompt-template ownership on the selected prompt preset, and
   top-level `promptTemplate` remains a compatibility projection. The
   prompt-template editor and Bot Settings gate now trigger owner-scoped
   hydration on selected prompt preset changes before adopting the selected
   preset template.
6. Phase 4 legacy bot-preset compatibility cleanup is implemented: silent
   legacy bot-preset prompt-template apply/snapshot behavior has been removed
   while explicit extraction/conversion remains available.
7. Phase 5 generation/loadout cleanup is implemented: browser local/parity
   assembly hydrates/checks the effective chat prompt-preset owner, and generic
   top-level preset mirroring no longer treats `promptTemplate` as a normal
   prompt-preset field.
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
- Prompt Settings now edits a local draft sourced from
  `promptPresets[promptPresetsId].promptTemplate` first and keeps
  `DBState.db.promptTemplate` aligned as a compatibility projection for bridge
  and reconcile flows.
- Prompt preset switches are owner-hydrated even while the newly selected owner
  is not yet marked hydrated; stale owner completions are ignored before the
  draft is reset.
- The prompt-template bridge optimizes row-level edits and now keys pending
  item updates by prompt preset owner plus item id.
- Server prompt item commands write `prompt_presets` rows when
  `promptPresetId` is supplied, and preserve `prompt_templates` writes only for
  omitted-id legacy commands.
- Legacy bot preset apply/save-current no longer copies prompt-template data
  between `botPresets[]` and the active top-level `promptTemplate`.
- Legacy `botPresets[].promptTemplate` is still preserved for import/export,
  prompt diff reads, and explicit extraction into modern prompt presets.
- Legacy bot-preset hydration uses non-template settings fields as loaded-data
  sentinels too, so presets saved without `promptTemplate` are not considered
  unloaded forever.
- Server and browser prompt assembly now resolve effective prompt template reads
  from chat/global prompt presets before top-level compatibility fallback.
- Browser local/parity send hydration now uses the same effective owner as
  normalization: chat-scoped `generationSettings.promptPresetId` first, then the
  selected/global prompt preset owner, then legacy top-level ownership.
- Generic top-level-to-prompt-preset mirroring intentionally skips
  `promptTemplate`; prompt-template ownership should move through explicit
  owner-aware prompt-preset paths.
- Server prompt-preset select/update/delete writes to `prompt_templates` remain
  as a compatibility mirror for this phase. Do not remove them until a later
  cleanup explicitly retires that mirror.
- The Fastify variation is unreleased, so source-level storage reshaping is
  allowed without a formal user-data migration promise.

## Recommended Next Slice

Phase 5 has been implemented as a narrow generation/loadout cleanup slice with
focused tests. The next recommended slice is Phase 6: run the full closeout
verification, update final docs, and decide whether any remaining
`prompt_templates` compatibility mirror writes should be retired or kept
documented.
