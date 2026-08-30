# Shell And Character-Summary Resource Contracts

Status: ready.

Parent: [Phase 1](../../phase-1-protocol-contract-completion.md)

Depends on: Phase 0 gate at `b01e88b03461753afe8f573029ce2e5ab47892ef`.

## Objective

Move the serialized shell and character-summary resource contracts from the
browser application tree into explicit, schema-first `@risuai/protocol`
subpaths, then migrate both runtimes without changing wire behavior.

## Source And Destination

- `src/ts/server/shellProtocol.ts` to `@risuai/protocol/shell-resource`.
- `src/ts/server/characterSummaryProtocol.ts` to
  `@risuai/protocol/character-summary-resource`.
- Fastify resource-read routes/tests and browser resource/cache consumers adopt
  the package exports.
- The Phase 0 baseline currently classifies 8 direct edges to these two targets.

## Behavior Contract

- Mutations and persistence: none; these are authenticated resource reads.
- Route paths, methods, authentication, active-writer policy, response keys,
  masking, payload sizes, cache validators, and event invalidation: unchanged.
- Authoritative recovery remains an authenticated resource reread.
- Rollback: restore the old modules and consumer imports together; retain parity
  fixtures until both runtime consumers pass.

## Validation

- Focused protocol validator and browser/server parity tests.
- `pnpm check:protocol`
- `pnpm check:server`
- `pnpm test:affected`
- Owning resource-read/browser resource tests.
- Prettier and `git diff --check`.

## Done When

- Both contracts are exported only through explicit protocol subpaths.
- Fastify and browser consumers use the package owner and parity fixtures pass.
- The old browser-tree modules have no consumer and are removed.
- The architecture baseline records the exact edge reduction and releases the
  two contract cursors to Workstream 3.
