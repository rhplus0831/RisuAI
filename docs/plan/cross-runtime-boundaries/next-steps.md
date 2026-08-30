# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [shell and character-summary resource contract
slice](phases/slices/phase-1-protocol-contract-completion/shell-and-character-summary-contracts.md).

1. Introduce schema-first shell and character-summary contracts through
   explicit `@risuai/protocol` subpaths.
2. Prove the protocol validators and current browser validators accept and
   reject the same fixtures, including exact-key/version behavior.
3. Migrate Fastify resource reads, server tests, and browser adapters to the
   package contracts without changing route, payload, cache, or masking
   behavior.
4. Remove only the superseded browser-tree contract modules after every live
   consumer has moved.
5. Refresh the architecture baseline for the exact removed edges and release
   the shell/character-summary contract cursor to Workstream 3.

## Boundary Conventions Released

- Serialized contracts live in browser-safe `@risuai/protocol` subpaths.
- Framework-neutral behavior belongs in a separately audited shared runtime
  owner, not in the protocol package.
- Security, active-writer policy, persistence, credentials, host behavior, and
  database repair remain Fastify-owned.
- Shared historical fixtures are test-owned and cannot make browser application
  modules a server dependency.

These conventions were released by Phase 0 at `b01e88b03` and unblock
Workstream 2's compatibility inventory.

## Not In This Slice

- Do not introduce the route operation catalog yet.
- Do not move aggregate `Database` or Svelte state into a shared package.
- Do not alter resource payloads, cache policy, authentication, active-writer
  policy, or authoritative recovery.
- Do not combine unrelated provider, generation, or prompt contract families.

## Handoff

After the slice passes, update [`status.md`](status.md) with exact edge counts
and contract release cursors, refresh [`latest-verification.md`](latest-verification.md),
then select the next wire-contract family from [`baseline.json`](baseline.json).
