# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [image-generation operation contract
slice](phases/slices/phase-1-protocol-contract-completion/image-generation-operation-contract.md).

1. Define schema-first provider taxonomy, credential variants, and every
   provider-discriminated request shape at an explicit protocol subpath.
2. Preserve the opaque NovelAI payload and the exact DALL-E, Stability, Fal,
   Imagen, OpenAI-compatible, WaveSpeed, and Kei fields; add fixtures for every
   discriminator and rejected cross-pairing.
3. Migrate browser image-generation/stable-diff consumers and Fastify image/Lua
   handlers/tests without moving secret resolution, provider calls, URL/Lua
   policy, size limits, error masking, or asset persistence.
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
- Do not move aggregate `Database` or Svelte state into a shared package.
- Do not alter provider payloads, asset persistence, authentication,
  active-writer policy, or authoritative recovery.
- Do not combine unrelated TTS, transcription, generation, or prompt contract
  families.

## Handoff

After the slice passes, update [`status.md`](status.md) with exact edge counts
and the image-generation-operation release cursor, refresh
[`latest-verification.md`](latest-verification.md), then select the next
wire-contract family from [`baseline.json`](baseline.json).
