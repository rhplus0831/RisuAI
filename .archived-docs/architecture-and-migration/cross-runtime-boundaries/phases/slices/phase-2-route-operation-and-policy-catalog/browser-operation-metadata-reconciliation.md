# Browser Operation Metadata Reconciliation

Status: complete at `6a6d0ac1f`.

Parent: [Phase 2](../../phase-2-route-operation-and-policy-catalog.md)

Depends on: shared route operation catalog at `00e49d880` and shared durable
command operation catalog at `3f275e9dc`.

## Objective

Reconcile browser resource, cache, generation, and raw-generation caller
metadata with stable shared operation identifiers so overlapping vocabularies
cannot drift silently.

## Contract

- Map each browser resource request and cache policy to the matching shared
  route operation or record an explicit browser-only distinction.
- Make durable generation submit, cancel, and retry callers consume the shared
  generation operation relation without changing runtime UUIDs or request
  bodies.
- Reconcile raw-generation caller gates with the shared route vocabulary while
  keeping browser capability metadata non-authoritative.
- Reject missing, stale, duplicate, or contradictory mappings in focused parity
  tests.

## Behavior Contract

No route, method, request, response, cache header, stream, retry, persistence,
revision, event, authentication, active-writer, credential, rate-limit, host, or
handler behavior changes. Browser metadata never grants authority.

## Validation

Focused resource/cache/generation/raw-generation parity tests, protocol and
architecture gates, affected frontend/server tests, relevant typechecks,
formatting, and `git diff --check`.

## Done When

- Every overlapping browser operation metadata entry maps uniquely to a shared
  operation identifier or has a reviewed non-overlap reason.
- Resource/cache/generation/raw-generation vocabularies cannot drift silently.
- Phase 2 exit criteria pass and Phase 3 pure-shared-core extraction may start.

Stop if reconciliation would move browser persistence, server policy, or
security authority into the protocol catalog.

## Result

- Added 55 reviewed browser-to-route relations covering 31 resource, 12
  cache/transport, 10 generation, and 2 raw-generation entries.
- Recorded seven explicit browser-only distinctions, including runtime UUIDs,
  cache record keys, diagnostic caller labels, and the unused dedicated
  preview-prompt adapter.
- Corrected the shared cache classification for the two direct bulk `{ids}`
  reads from `request-hash` to `unspecified`; request and server behavior did
  not change.
- Added fail-closed owner, duplicate, stale-ID, method/path, and transport
  parity checks plus architecture inventory coverage.
