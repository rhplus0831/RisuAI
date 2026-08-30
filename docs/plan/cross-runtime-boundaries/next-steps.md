# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [display-source contract
slice](phases/slices/phase-1-protocol-contract-completion/display-source-contract.md).

1. Define schema-first display request/response DTOs, layer/version taxonomies,
   bounds, namespace inputs, and normalizers at an explicit protocol subpath.
2. Preserve page-session normalization, dependency canonicalization, namespace
   ordering, streaming-target semantics, and response fallback statuses.
3. Migrate browser display-source callers plus Fastify bootstrap, route, and
   service consumers without moving rendering, CBS, caches, persistence, or
   active-writer policy.
4. Move the existing parity fixtures to the package owner and extend the protocol
   import audit.
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
- Do not move aggregate `Database`, character state, or Svelte state into a
  shared package.
- Do not move display rendering, parser/CBS execution, caches, persistence,
  authorization, active-writer policy, or recovery into protocol.
- Do not combine unrelated OAuth, standalone-settings, generation, or prompt
  contract families.

## Handoff

After the slice passes, update [`status.md`](status.md) with exact edge counts
and the display-source release cursor, refresh
[`latest-verification.md`](latest-verification.md), then select the next
wire-contract family from [`baseline.json`](baseline.json).
