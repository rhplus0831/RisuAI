# Lore Hash Randomization

Status: complete at `1b1152814`.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core history-slot rendering at `7e03538ea`.

## Objective

Move the dependency-free deterministic hash-seeded PRNG into the audited
shared-core owner and remove the private Fastify CBS copy without changing
browser CBS/lorebook keys or Fastify activation identities.

## Source And Destination

- Source: `src/ts/util/loreHash.ts` plus the private copy in
  `server/fastify/src/prompt/cbsAdapter.ts`.
- Destination: an explicit `@risuai/shared-core` subpath.
- Consumers: the browser utility facade and its CBS/parser/lorebook/MCP users;
  Fastify CBS and lorebook activation.

## Behavior Contract

- Preserve `sfc32`'s exact signed 32-bit coercions, shifts, overflow, state
  mutation order, and unsigned division by 4294967296.
- Preserve `pickHashRand`'s initial `5515` hash, UTF-16 code-unit loop, four
  consecutive hash calls against shared state, `cid % 1000` advancement, and
  returned first PRNG value after advancement.
- Preserve JavaScript behavior for empty/Unicode/long strings and negative,
  fractional, zero, boundary, and large identifiers; do not normalize inputs.
- Keep CBS parsing, lorebook policy, chat-variable naming, request context,
  persistence, and UI state in their current owners.

## Validation

Shared-core import audit/typecheck; differential vectors against both existing
implementations; repeated-call/state tests; closed-world ownership proof for
the browser facade and both Fastify owners; affected CBS/lorebook/browser tests;
both typechecks; architecture inventory; formatting; and `git diff --check`.

## Done When

- Browser and both Fastify owners use the shared subpath and the private CBS
  copy is deleted.
- `src/ts/util/loreHash.ts` is deleted and the matching Fastify root-`src` edge
  disappears without a new exception.
- Deterministic vectors match the pre-extraction browser and Fastify outputs
  exactly.

Stop if the leaf needs browser stores, DOM/Svelte, Fastify, filesystem,
process-global state, credentials, persistence, or an aggregate database.

## Release Evidence

- `@risuai/shared-core/lore-hash` owns `sfc32`/`pickHashRand`; the browser
  utility facade and both Fastify owners import it, and the private CBS copy is
  deleted.
- Differential, ownership, and import-boundary files passed 12, 1, and 2 tests;
  Fastify owners passed 79 and 33, and browser owners passed 19 and 11.
- One production runtime root-`src` edge and one target left the checked
  inventory.
