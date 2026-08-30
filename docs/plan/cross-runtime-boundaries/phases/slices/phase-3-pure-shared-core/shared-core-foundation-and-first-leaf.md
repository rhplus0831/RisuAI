# Shared-Core Foundation And First Leaf

Status: ready.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: Phase 0 boundary classifications and Phase 2 route/operation
catalog closeout at `6a6d0ac1f`.

## Objective

Establish an audited browser/Node-neutral shared-core package and move the first
low-fanout duplicated leaf algorithm into it with differential proof.

## Contract

- Audit current cross-runtime duplicate leaf helpers and choose a candidate
  with real production consumers in both runtimes.
- Create the smallest package/export and import-boundary gate needed for pure
  behavior; do not turn `packages/protocol` into an algorithm package.
- Replace both implementations only after focused fixtures prove identical
  results, failures, ordering, and edge-case handling.
- Record rejected candidates whose framework, host, credential, persistence,
  database, or aggregate-state dependencies make them unsuitable.

## Behavior Contract

No route, schema, request, response, persistence, prompt, parser, provider,
translator, generation, authentication, active-writer, credential, host, or UI
behavior changes.

## Validation

Shared-core import audit, focused differential fixtures, affected browser and
server tests, relevant typechecks, architecture inventory, formatting, and
`git diff --check`.

## Done When

- The package admits only pure value dependencies and is independently
  typechecked.
- One duplicated leaf has a single shared implementation consumed by browser
  and Fastify code.
- The prior duplicate implementations are removed and differential tests pass.

Stop if the candidate requires browser stores, DOM/Svelte, Fastify, filesystem,
process globals, credentials, persistence, or an aggregate browser database.
