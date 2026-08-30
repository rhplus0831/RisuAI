# Generation-Finalization Retry Message Seam

Status: complete at `79041383f`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: retained generation-finalization ownership.

## Objective

Replace the retry journal's browser `Message` declaration with the smallest
Fastify-owned retained-message envelope used by replay and projection logic.

## Boundary

- Required role and data fields.
- Optional legacy message ID and generation ID.
- Delivered delta: one production type-only aggregate browser-model edge.

## Behavior Contract

Preserve full JSON serialization, alternate messages, optional legacy IDs,
send/continue/regenerate modes, snapshot freshness and already-committed fences,
retry backoff, projection states, authoritative commit/cleanup distinctions,
revisions, receipts, and events.

## Verification

Finalization retry behavior and closed ownership suites passed 6 and 1 tests.
Both typechecks, the 227-edge architecture inventory, formatting, and diff checks
passed.
