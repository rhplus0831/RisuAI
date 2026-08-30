# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [server-tool contract
slice](phases/slices/phase-1-protocol-contract-completion/server-tool-contract.md).

1. Define schema-first server-tool definitions, calls, results, rounds, limits,
   and validation results at an explicit protocol subpath.
2. Preserve provider-safe names, duplicate detection, JSON cloning, byte
   limits, thought signatures, allowed-tool checks, and call/result matching;
   add fixtures for accepted and rejected boundary cases.
3. Migrate browser completion callers and Fastify generation routes/providers
   without moving tool execution, provider translation, prompt construction,
   authorization, or active-writer policy.
4. Remove the superseded application-tree protocol module after every consumer
   moves.
5. Refresh the boundary baseline for the exact eight removed cross-runtime edges
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
- Do not alter tool limits, payload validation, provider behavior, tool
  execution, authentication, active-writer policy, or authoritative recovery.
- Do not combine unrelated generation, OAuth, display-source, or prompt contract
  families.

## Handoff

After the slice passes, update [`status.md`](status.md) with exact edge counts
and the server-tool release cursor, refresh
[`latest-verification.md`](latest-verification.md), then select the next
wire-contract family from [`baseline.json`](baseline.json).
