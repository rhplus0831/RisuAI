# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [provider operation contract
slice](phases/slices/phase-1-protocol-contract-completion/provider-operation-contract.md).

1. Define the provider operation taxonomy, credential variants, request input,
   and success envelope as schema-first exports at an explicit protocol subpath.
2. Preserve additive request-object behavior, exact operation strings, optional
   input behavior, and credential routing; add compatibility fixtures for every
   credential and input variant.
3. Migrate the browser provider client and Fastify provider handler/tests to the
   package contract without moving credential authority or provider dispatch.
4. Remove the superseded application-tree protocol module after every consumer
   moves.
5. Refresh the boundary baseline for the exact three removed cross-runtime edges
   and record the contract release.

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
and the provider-operation release cursor, refresh
[`latest-verification.md`](latest-verification.md), then select the next
wire-contract family from [`baseline.json`](baseline.json).
