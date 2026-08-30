# Model-Role Resolution

Status: ready.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core lore hash randomization at `1b1152814`.

## Objective

Move dependency-free model-role identifiers, normalization, inheritance
metadata, and legacy selection behavior into the audited shared-core owner
without changing durable profile/provider policy, model settings, persistence,
or command behavior.

## Source And Destination

- Source: `src/ts/model/modelRoles.ts`.
- Destination: an explicit `@risuai/shared-core` subpath.
- Consumers: nineteen browser production modules and eight Fastify production
  modules spanning model-profile records/resolution/UI, database defaults,
  settings surfaces, request/command types, and preset/profile commands.

## Behavior Contract

- Preserve exact canonical role order, legacy separate/fallback key order, all
  exported types, `model -> chatMain` and `submodel -> chatAux` aliases, and
  profile-inheritance sources.
- Preserve whitespace trimming, blank/invalid defaults, string-only fallback
  arrays, empty-item filtering, and fresh map/array allocation.
- Preserve base-role override exclusion, auxiliary nonblank override
  precedence, strict `seperateModelsForAxModels === true` gating, main/aux
  fallback behavior, and the `scriptAux -> otherAx -> subModel` chain.
- Keep durable profile resolution, provider capability, credentials,
  persistence, import/export, command policy, and UI orchestration outside the
  leaf.

## Validation

Shared-core import audit/typecheck; ported and expanded pre-extraction role/map
differential fixtures; closed-world ownership proof for all 27 production
consumers; affected model-profile resolver/record/UI, database-default,
split-preset, command, storage, request-role, and settings tests; both
typechecks; architecture inventory; formatting; and `git diff --check`.

## Done When

- All 27 production consumers use the shared subpath.
- `src/ts/model/modelRoles.ts` is deleted and all eight matching Fastify
  root-`src` edges disappear without a new exception.
- Role resolution and normalization remain byte-for-byte stable across browser
  and Fastify owners.

Stop if the leaf needs provider/credential policy, browser stores, DOM/Svelte,
Fastify, filesystem, process-global state, persistence, or an aggregate
database.
