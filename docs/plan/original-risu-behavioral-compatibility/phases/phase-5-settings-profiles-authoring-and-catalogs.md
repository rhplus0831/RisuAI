# Phase 5 — Settings, Profiles, Authoring, And Catalogs

Status: Pending  
Depends on: Phases 1-4

## Objective

Verify defaults, legacy settings, presets, profiles, personas, characters,
lorebooks, authoring workflows, uploads, and retained Realm/catalog actions from
editing through selection, persistence, runtime use, and reload.

## Audit Questions

- Are all baseline/default/legacy fields loaded, edited, saved, applied, copied,
  imported, exported, and reset without omission or type drift?
- Does preset/profile selection propagate every runtime-relevant option and
  clear stale values when the baseline does?
- Do character/persona/lore identifiers, order, assets, metadata, and references
  survive authoring, duplication, deletion, import, and reload?
- Are catalog/Realm acquisition and update actions atomic and visibly diagnosed
  when unsupported or failed?
- Can secret fields leak through browser projection, traces, fixtures, or export?

## Required Outputs

- Closed-world settings/default/command-group and preset/profile field matrices.
- Baseline/current save/apply/reset fixtures with missing/null/legacy variants.
- Runtime-consumer ownership for each profile option, linked to Phases 6-7.
- Browser authoring and catalog failure/atomicity journeys.
- Round-trip ownership links to Phase 11 for imported/exported artifacts.

## Exit Criteria

- Every retained field is classified for storage, projection, editing, runtime
  use, interchange, and secrecy as applicable.
- Apply/reset/copy/import cannot silently omit or retain stale runtime values.
- Authoring workflows preserve identity/references and visible failure semantics.
- Focused settings/authoring/catalog and compatibility lanes pass.

## Validation

Run structural field checks, unit/integration tests, built-browser authoring and
reload journeys, affected and compatibility lanes, secret scans where relevant,
formatting, and `git diff --check`.
