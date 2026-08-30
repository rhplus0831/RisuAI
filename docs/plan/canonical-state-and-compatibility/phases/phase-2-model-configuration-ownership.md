# Phase 2: Model Configuration Ownership

Status: queued.

Depends on: Phase 1 foundation and accepted model rows in the Phase 0 matrix.

## Objective

Make durable model profiles and role bindings the one normal model
configuration owner while preserving classified static and legacy boundaries.

## Required Work

- Migrate usable legacy flat selections, provider/request/runtime options,
  credentials references, and fallbacks into stable-id profiles and bindings.
- Move remaining authoring, settings, preset, loadout, generation, memory,
  translation, scripting, tool, and auxiliary consumers to the durable contract.
- Preserve explicitly classified static/external compatibility paths.
- Remove ordinary resolver fallback only after migration, import, current
  authoring, reload, and explicit compatibility entrypoints pass.
- Preserve credential masking and block inline-secret reintroduction.

## Safety Contract

Provider selection, request model/options, fallback order, inheritance, static
model bypasses, masking, and prompt-visible behavior remain equivalent. Each
slice names settings tables/records, command revisions/events, and rollback.

## Exit Criteria

- Normal consumers resolve through one profile/binding contract.
- Flat fields cannot influence normal generation after canonical migration.
- Supported legacy imports and exports still work only at explicit boundaries.
- The model-owner release cursor is handed to Workstream 3 unless a Phase 5/6
  hold remains.

## Validation

Migration fixtures, resolver/provider request parity, profile/preset/loadout/
credential tests, generation and auxiliary owning lanes, browser authoring and
reload proof, both typechecks, formatting, and diff checks.
