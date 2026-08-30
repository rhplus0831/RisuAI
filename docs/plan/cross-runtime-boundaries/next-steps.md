# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [standalone-settings contract
slice](phases/slices/phase-1-protocol-contract-completion/standalone-settings-contract.md).

1. Define the eight-name taxonomy plus schema-derived present/absent state and
   revisioned payload at an explicit protocol subpath.
2. Preserve non-negative safe-integer revisions, additive outer payloads, exact
   state variants, unknown present values, and the existing name guard.
3. Migrate browser resource state/read/manifest/invalidation consumers and the
   Fastify resource-read route without moving storage, revision, or repair policy.
4. Remove the superseded application-tree contract module and extend the
   protocol import audit.
5. Refresh the boundary baseline for the exact one removed cross-runtime edge and
   record the contract release.

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
- Do not move aggregate `Database`, character state, or Svelte state into a
  shared package.
- Do not move standalone-setting storage, resource projection, revision
  authority, repair, invalidation, authentication, or writer policy into protocol.
- Do not combine unrelated generation or prompt contract families.

## Handoff

After the slice passes, update [`status.md`](status.md) with exact edge counts
and the standalone-settings release cursor, refresh
[`latest-verification.md`](latest-verification.md), then select the next
wire-contract family from [`baseline.json`](baseline.json).
