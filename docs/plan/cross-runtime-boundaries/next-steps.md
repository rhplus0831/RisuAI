# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [client-context contract
slice](phases/slices/phase-1-protocol-contract-completion/client-context-contract.md).

1. Define the schema-derived reported-client-context DTO and behavior-preserving
   normalizer at an explicit protocol subpath.
2. Preserve language trimming and syntax, finite positive dimension checks,
   rounding, clamping, ignored fields, and undefined-empty normalization.
3. Migrate Fastify route/prompt consumers and the display-source contract to the
   package owner while leaving browser environment capture in its browser adapter.
4. Keep the browser adapter as the only `navigator`/`window` reader and add
   package fixtures for normalization boundaries.
5. Refresh the boundary baseline for the exact four removed cross-runtime edges
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
- Do not move aggregate `Database`, character state, or Svelte state into a
  shared package.
- Do not move `navigator`, `window`, prompt assembly, CBS behavior, route
  authorization, active-writer policy, or authoritative recovery into protocol.
- Do not combine unrelated display-source, OAuth, standalone-settings, or prompt
  contract families.

## Handoff

After the slice passes, update [`status.md`](status.md) with exact edge counts
and the client-context release cursor, refresh
[`latest-verification.md`](latest-verification.md), then select the next
wire-contract family from [`baseline.json`](baseline.json).
