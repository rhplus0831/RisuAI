# Phase 4: Prompt, Lorebook, And Script-Definition Ownership

Status: dependency-blocked.

Depends on: Phase 1 owner APIs and Workstream 2 canonical-owner closeout for
each resource family.

## Objective

Move high-complexity prompt, lorebook, and script-definition editors and
generation consumers to explicit resource owners.

## Required Work

- Migrate owner-scoped hydration, selected-owner state, editor drafts,
  debounced/explicit commands, optimistic projection, queued/failure feedback,
  rollback, and reload together.
- Preserve prompt body order/roles, lorebook stable ids and scopes, script/
  trigger ordering, module/character/chat ownership, and lazy hydration.
- Preserve generation snapshot/fence behavior so target selection or reload
  cannot mix owner epochs.
- Migrate export/import UI consumers to explicit hydration requirements.
- Remove each bridge lifecycle only after that family's browser and generation
  proof passes.

## Safety Contract

This phase changes browser state ownership, not persisted canonical ownership,
prompt output, lorebook activation, script execution, command events, or
authoritative-read fallback.

## Exit Criteria

- Editors and generation inputs use explicit owners end to end.
- Prompt/lorebook/script aggregate consumers and bridge registrations are zero.
- Draft, debounce, queued/failure rollback, reload, and model-visible parity
  evidence passes.

## Validation

Owner/bridge replacement tests, editor and generation fixtures, prompt/lorebook/
script owning lanes, import/export tests, browser smoke for edit/reload/generate,
typechecks, formatting, and diff checks.
