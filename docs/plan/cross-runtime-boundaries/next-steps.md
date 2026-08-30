# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [TTS synthesis contract
slice](phases/slices/phase-1-protocol-contract-completion/tts-synthesis-contract.md).

1. Define schema-first synthesis operation and OpenAI-format taxonomies,
   credential variants, provider inputs, caller-owned OpenAI configuration, and
   discriminated requests at an explicit protocol subpath.
2. Preserve exact operation/input pairing and optional configuration placement;
   add fixtures for all five operations, four credentials, six formats, and
   rejected cross-pairings.
3. Migrate browser TTS callers and Fastify handler/tests without moving stored
   secret or character resolution, endpoints, input/response limits, provider
   calls, audio validation, or error masking.
4. Remove the superseded application-tree protocol module after every consumer
   moves.
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
- Do not alter audio payloads, endpoints, provider behavior, authentication,
  active-writer policy, or authoritative recovery.
- Do not combine unrelated transcription, generation, OAuth, or prompt contract
  families.

## Handoff

After the slice passes, update [`status.md`](status.md) with exact edge counts
and the TTS-synthesis release cursor, refresh
[`latest-verification.md`](latest-verification.md), then select the next
wire-contract family from [`baseline.json`](baseline.json).
