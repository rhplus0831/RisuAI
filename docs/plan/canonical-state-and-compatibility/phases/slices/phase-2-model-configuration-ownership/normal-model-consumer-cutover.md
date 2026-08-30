# Normal Model Consumer Cutover

Status: ready.

Parent: [Phase 2](../../phase-2-model-configuration-ownership.md)

Depends on: deterministic flat migration at `47146eb75`.

## Objective

Make durable profiles and role bindings the only normal model-selection and
runtime-option inputs across authoring, reload, generation, and auxiliary
lanes, while keeping explicitly classified static and legacy entrypoints.

## Scope

- Settings/model authoring, model presets, loadouts, and reload hydration.
- Chat generation, memory, translation, scripting, tools, agents, and other
  auxiliary model-role consumers.
- Normal resolver fallback from a migrated role binding to `aiModel`,
  `subModel`, `modelRoles`, separate parameters, and fallback arrays.
- Current import/export and explicit legacy conversion remain compatibility
  boundaries; the inline-only Vertex hold remains Phase 5 work.

## Behavior Contract

- Provider, request model/options, fallback order, inheritance, static-model
  bypasses, and generated requests stay equivalent.
- Normal authoring writes canonical profile/binding records and cannot
  reintroduce flat runtime ownership.
- Missing or malformed durable state fails or reports incomplete according to
  the Phase 0 matrix; ordinary resolution does not mint or repair records.
- No command revision, receipt, event, lineage, backup, or restore semantics
  change unless the owning command already declares that mutation.

## Validation

Resolver/provider-request differential tests, model profile/binding/preset/
loadout fixtures, generation and every auxiliary role lane, browser authoring
and reload proof, explicit conversion/import/export fixtures, both typechecks,
compatibility/architecture gates, formatting, and `git diff --check`.

## Done When

- Every normal model consumer reaches configuration through a durable profile
  and binding after migration/reopen.
- Flat fields can influence behavior only through named static, import,
  export, explicit conversion, rollback, or Phase 5 repair boundaries.
- The remaining Phase 2 legacy-reader removal is isolated and the model-owner
  cursor is ready to release to Workstream 3.

Stop if a consumer needs an inline secret copied, a fallback reordered, or a
classified static/legacy boundary removed to complete the cutover.
