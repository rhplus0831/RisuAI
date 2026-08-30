# Phase 1: Protocol Contract Completion

Status: queued.

Depends on: Phase 0 accepted import/duplication inventory and package rules.

## Objective

Move remaining serialized request, response, event, version, taxonomy, and
resource contracts into explicit `@risuai/protocol` subpaths without changing
wire behavior.

## Candidate Families

- shell and character-summary resources;
- generation operation submission, projection, cancellation, and lineage;
- provider, embedding, image, TTS, transcription, OAuth, and server-tool
  operation envelopes;
- display-source and other versioned request/response contracts;
- event and durability vocabularies needed by more than one runtime.

The Phase 0 inventory determines actual order. One family is one or more small
slices; never migrate this list as a single batch.

## Required Work

- Define TypeBox/schema-first contracts and compatibility parsers at the shared
  owner.
- Preserve current versions, exact-key behavior, payload limits, masking, and
  forward/unknown handling.
- Export each family through an explicit package subpath.
- Add browser/server parity or differential fixtures before old validators are
  removed.
- Extend the protocol import audit for every new runtime file.

## Mutation And Event Contract

Contract moves do not change accepted mutations, revisions, receipts,
invalidation keys, SSE ordering, or authoritative-read fallback. Any discovered
behavior mismatch becomes a separate remediation slice.

## Exit Criteria

- Migrated consumers import only `@risuai/protocol` for their wire contract.
- Protocol checks and parity fixtures pass in browser and server contexts.
- No Node, application, Svelte, Fastify, or database dependency enters the
  package.
- Stable protocol conventions are recorded as the Workstream 2 release cursor.

## Validation

Focused protocol tests, `pnpm check:protocol`, both typecheck families, affected
frontend/server lanes, formatting, and diff checks.
