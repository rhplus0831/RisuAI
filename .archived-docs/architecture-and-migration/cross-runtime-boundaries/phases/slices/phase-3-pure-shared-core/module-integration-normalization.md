# Module-Integration Normalization

Status: complete at `d314bbdcf`; canonical CBS fixture correction at `e3adc0216`.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core script-model overrides at `2831411d1`.

## Objective

Move dependency-free module-integration parsing, stable combination, and
selected-Agent-preset lookup into the audited shared-core owner without changing
module activation, effective generation composition, persistence, or Agent
Preset orchestration.

## Source And Destination

- Source: `src/ts/moduleIntegration.ts`.
- Destination: an explicit `@risuai/shared-core` subpath.
- Consumers: browser chat-generation settings and module activation; Fastify
  effective generation configuration.

## Behavior Contract

- Preserve non-string rejection, comma splitting, per-entry trimming, empty
  removal, duplicate/order preservation while parsing, and first-occurrence
  deduplication while combining.
- Preserve `", "` output joining and empty-string output for no integrations.
- Preserve trimmed selected preset IDs, exact stored-ID matching, first-match
  selection, explicit `enabled === false` exclusion, and verbatim returned
  `moduleIntergration` content including its persisted misspelling.
- Keep module lookup/activation, selected preset composition, request policy,
  persistence, and Agent execution in their current owners.

## Validation

Shared-core import audit/typecheck; ported and expanded parser, combination,
ordering, duplicate, invalid-input, selected-preset, and disabled-preset
fixtures; closed-world ownership proof for all three production consumers;
affected chat-generation settings, module activation, and Fastify effective
generation tests; both typechecks; architecture inventory; formatting; and
`git diff --check`.

## Done When

- All three production consumers use the shared subpath and the browser-tree
  owner is deleted.
- The matching Fastify production runtime root-`src` edge and source target
  disappear without a new exception.
- Browser and Fastify composition preserve exact integration strings and
  activation behavior.

Stop if the leaf needs module records, aggregate database state, browser stores,
DOM/Svelte, Fastify, filesystem, process-global state, credentials,
persistence, or host policy.
