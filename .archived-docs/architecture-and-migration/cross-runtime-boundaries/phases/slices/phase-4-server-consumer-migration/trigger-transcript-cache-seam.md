# Trigger Transcript-Cache Seam

Status: complete at `68883eba5`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: prompt-row ownership at `6adc180fe`.

## Objective

Replace `triggerRunCache.ts`'s aggregate browser chat/message declarations with
the exact transcript inputs needed to key the request-local trigger cache.

## Boundary

- Message input: the transcript fields read while constructing a cache key.
- Chat input: the message collection and identity observed by the WeakMap.
- Delivered delta: one production type-only browser-application-model edge.

## Behavior Contract

Preserve WeakMap identity, cache hits and misses, transcript invalidation, and
trigger ordering. Do not change trigger execution, script state, persistence,
revisions, receipts, or events.

## Verification

The focused cache/ownership tests, the 143-test trigger suite, server typecheck,
architecture inventory, formatting, and diff checks passed.
