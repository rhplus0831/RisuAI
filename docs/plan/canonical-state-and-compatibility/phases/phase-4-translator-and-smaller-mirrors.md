# Phase 4: Translator And Smaller Compatibility Mirrors

Status: queued.

Depends on: Phase 1 foundation and per-family Phase 0 dispositions.

## Objective

Move translator and selected smaller compatibility domains to one internal
read/write contract, without broadening the phase into a generic legacy cleanup.

## Required Work

- Make selected translator preset/step data the normal pipeline owner.
- Remove normal-runtime synchronization of first-step
  `translatorPrompt`/`translatorMaxResponse` scalars and legacy selected-index
  ownership after migration.
- Preserve chat-scoped preset ids, cache signatures, provider/model profile
  resolution, history limits, and classified non-LLM translators.
- Process each smaller mirror only according to its Phase 0 disposition, in a
  separate resource-family slice.
- Record per-family Workstream 3 release or later-phase hold.

## Safety Contract

Translation request text, languages, prompt slots, step order, max response,
history, notes, cache identity, failure/fallback, and persisted selection remain
equivalent.

## Exit Criteria

- Each migrated family has one normal internal read/write contract.
- Legacy fields are produced or consumed only at explicit classified boundaries.
- Translator/smaller owner cursors are released individually to Workstream 3.

## Validation

Migration and historical fixtures, translator preset/pipeline/cache/provider
tests, command and chat-selection tests, browser authoring/reload proof, import/
export tests, typechecks, formatting, and diff checks.
