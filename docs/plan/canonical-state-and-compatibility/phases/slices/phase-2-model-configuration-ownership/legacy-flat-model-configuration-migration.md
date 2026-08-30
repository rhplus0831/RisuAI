# Legacy Flat Model Configuration Migration

Status: ready.

Parent: [Phase 2](../../phase-2-model-configuration-ownership.md)

Depends on: migration/recovery foundation at `1e758cd22` and the released
Workstream 1 model/provider contracts.

## Objective

Transactionally migrate usable normal-runtime flat model/provider settings and
role selections into stable durable profiles and bindings while retaining the
explicit legacy conversion boundary.

## Scope

- The Phase 0 `model-durable-profiles`, `model-role-bindings`,
  `model-legacy-flat-fields`, and `model-explicit-legacy-conversion` rows.
- Model profile, role-binding, preset, loadout, resolver, authoring, import, and
  export fixtures named by the compatibility baseline.
- Credential references and masking; inline-secret damaged-state repair remains
  held for Phase 5.

## Behavior Contract

- Provider choice, request/static model, role fallback, inheritance, request
  options, auxiliary models, and generation-visible output stay equivalent.
- Migration is one named transactional schema step, does not bump command
  revision, and emits no receipt or command event.
- Missing or malformed legacy settings retain their Phase 0 behavior; inline
  secrets are never copied into a canonical profile.
- The old normal resolver remains available as rollback evidence until migrated
  read, authoring, reload, import, and export proofs pass.

## Validation

Historical migration/reopen fixtures, model profile/binding/preset/loadout and
credential tests, resolver/provider-request differential tests, affected
generation and auxiliary lanes, both typechecks, compatibility harness,
formatting, and `git diff --check`.

## Done When

- Every usable flat normal-runtime selection resolves through a stable profile
  and role binding after migration and reopen.
- Re-running or interrupting the step is deterministic and atomic.
- Explicit legacy conversion/import still accepts supported old inputs without
  making flat fields normal runtime owners.
- The model canonical-owner cursor can be released to Workstream 3 unless the
  recorded Phase 5 inline-secret repair hold applies.

Stop if migration would persist an inline credential, change fallback order, or
remove the explicit legacy conversion/export boundary.
