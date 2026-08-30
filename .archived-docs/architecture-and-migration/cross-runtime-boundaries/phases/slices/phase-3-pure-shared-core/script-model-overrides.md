# Script-Model Overrides

Status: complete at `2831411d1`.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core Agent-only lorebook predicate at `4162150ec`.

## Objective

Move dependency-free script-model override types, normalization, strict read
validation, profile lookup, and immutable update behavior into the audited
shared-core owner without changing profile resolution, Lua execution, database
repair, persistence, character/module commands, or settings behavior.

## Source And Destination

- Source: `src/ts/model/scriptModelOverrides.ts`.
- Destination: an explicit `@risuai/shared-core` subpath.
- Consumers: browser scripting, triggers, modules, storage, character bridge,
  command types, and settings; Fastify character/module commands, database
  defaults, and Lua runtime.

## Behavior Contract

- Preserve the exact `llmProfileId` and `axLlmProfileId` field names and
  `scriptMain`/`scriptAux` role taxonomy.
- Preserve whitespace trimming, blank omission, object-only normalization,
  unknown-key rejection, path-qualified validation errors, and error class
  identity/name.
- Preserve main/aux field selection, blank deletion, fresh normalized return
  objects, and non-mutation of the input.
- Keep durable profile lookup, role inheritance, provider/credential policy,
  Lua state, database repair, persistence, command authorization, and UI state
  in their current owners.

## Validation

Shared-core import audit/typecheck; ported and expanded normalization,
validation-error, role-selection, update, allocation, and non-mutation fixtures;
closed-world ownership proof for all production consumers; affected scripting,
trigger, module, storage, character-bridge, Fastify command, database-default,
and Lua-runtime tests; both typechecks; architecture inventory; formatting; and
`git diff --check`.

## Done When

- Every production consumer uses the shared subpath and the browser-tree owner
  is deleted.
- Four production runtime root-`src` edges and the source target disappear
  without a new exception.
- Normalization, strict read validation, profile selection, and updates remain
  behaviorally identical in browser and Fastify owners.

Stop if the leaf needs model-profile resolution, aggregate database types,
browser stores, DOM/Svelte, Fastify, filesystem, process-global state,
credentials, persistence, or host policy.

## Release Evidence

- `@risuai/shared-core/script-model-overrides` owns the types, normalizer,
  strict reader/error, role lookup, and immutable update behavior; seven browser
  and four Fastify production consumers import it directly.
- Differential, ownership, and import-boundary files passed 5, 1, and 2 tests;
  affected selector, module, scripting, character-bridge, database-default, Lua,
  and command owners passed 1, 40, 28, 25, 27, 52, and 230 tests.
- Four production runtime root-`src` edges and one source target left the checked
  inventory.
