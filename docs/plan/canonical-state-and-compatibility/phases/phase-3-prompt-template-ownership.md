# Phase 3: Prompt-Template Ownership

Status: active; opened after the Phase 2 model-owner release at `6020f6009`.

Depends on: Phase 1 foundation and accepted prompt rows in the Phase 0 matrix.

## Objective

Make the selected modern prompt preset's template body the only normal durable
owner and confine legacy/template projections to explicit boundaries.

## Required Work

- Migrate or extract legacy bot-preset templates with stable ids and explicit
  selection behavior.
- Align editor, hydration, generation, loadout, commands, SQLite storage, and
  reload on the same prompt-preset owner.
- Remove the aggregate top-level and SQLite mutable mirrors as independent truth;
  retain only explicit derived projection/storage if Phase 0 classifies it.
- Prevent selection/hydration from recreating dual ownership.
- Preserve supported legacy prompt import/export and missing-template fallback.

## Safety Contract

Prompt row order, roles, ids, normalization, selection, caching, fallback, and
model-visible assembled output remain equivalent. Stale compatibility mirrors
must be unable to affect output.

## Exit Criteria

- Editor, hydration, generation, loadout, and command paths use one owner.
- Current and historical prompt fixtures migrate and round-trip deterministically.
- The prompt-owner release cursor is handed to Workstream 3 unless a later
  repair/interchange hold remains.

## Validation

Migration/import/export fixtures, prompt normalization/hydration/command tests,
prompt-assembly differential evidence, generation owning lanes, browser editor
and reload smoke, typechecks, formatting, and diff checks.
