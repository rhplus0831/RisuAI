# Lazy Projection Note

Date: 2026-05-30

Short handoff for the Fastify-only lazy-projection workstream. Start with
[`plan.md`](plan.md) and [`architecture.md`](architecture.md), then the single
phase shard for the work in flight.

## Status

PLANNED — nothing implemented. This is a fresh workstream authored after the
`client-thinning` and `durable-generation` (Milestone 1) workstreams closed and
were archived under [`../archive/`](../archive/README.md). The plan was designed
through a sequence of design reviews; the decisions are locked in
[`reference/decisions.md`](reference/decisions.md).

## What This Workstream Is

Make the browser hold/receive a lean, lazily-hydrated projection (stubs for
chats/messages/lorebooks, hydrate on open), make the SSE refresh surgical so
hydration is not clobbered, move chat messages into SQLite, and complete durable
generation (`continue`/`regenerate` + browser auto-reattach).

## The One Hard Sequencing Rule

**Phase 2 (surgical sync) must land before Phases 4 and 5 (stub-loading).**
Without surgical sync, the debounced full refetch re-stubs hydrated entities on
every command event, so stub-loading is non-functional. See
[`phases/phase-2-surgical-sync.md`](phases/phase-2-surgical-sync.md) and
[`reference/surgical-sync.md`](reference/surgical-sync.md).

## Storage Decision Locked

A single `data/db.json` is kept (loaded fully into server memory) **minus** chat
messages, which move to a SQLite table. See
[`reference/storage-model.md`](reference/storage-model.md).
