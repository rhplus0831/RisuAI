# Provider-Secret Mask Ownership

Status: complete at `4d033dee4`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move the provider-secret path registry and masking helper to a neutral owner
used by browser exports and Fastify credential projections.

## Boundary And Contract

Preserve the sentinel, wildcard traversal, every registered path, non-empty
string behavior, and in-place mutation contract. Credential storage,
placeholder restoration, authorization, and dispatch stay Fastify-owned.
Delivered delta: two production and one server-test runtime/mixed edges; 181
total edges became 178.

## Verification

Shared boundary/ownership, browser masking, Fastify placeholder restoration,
and profile dispatch passed 2, 1, 2, 9, and 100 tests. Both typechecks, the
178-edge inventory, formatting, and diff checks passed.
