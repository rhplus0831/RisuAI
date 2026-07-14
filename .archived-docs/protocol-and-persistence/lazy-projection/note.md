# Lazy Projection Note

Date: 2026-05-30

Archived handoff for the Fastify-only lazy-projection workstream. Start with
[`README.md`](README.md) for the closeout summary; the original plan and phase shards
remain below it as the historical design record.

## Status

ARCHIVED — implemented, excluding the lorebook-stub item. This workstream was authored
after the `client-thinning` and `durable-generation` (Milestone 1) workstreams closed
and were archived under [`..`](../../README.md). The plan was designed through a sequence
of design reviews; the decisions are locked in
[`reference/decisions.md`](reference/decisions.md).

## What This Workstream Is

Make the browser hold/receive a lean, lazily-hydrated projection (stubs for
chats/messages, hydrate on open), make the SSE refresh surgical so hydration is not
clobbered, move chat messages into SQLite, and complete durable generation
(`continue`/`regenerate` + browser auto-reattach). Lorebook stubs are intentionally
outside this archive audit.

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
