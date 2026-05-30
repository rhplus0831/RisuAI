# Lazy Projection Phases

Date: 2026-05-30

Seven phases in dependency order. Each shard states goal / changes / seams /
risks / exit criteria. All are PLANNED.

The order differs from the order items were first proposed: **surgical sync was
pulled ahead of stub-loading** because the debounced full refetch would otherwise
re-stub every hydrated entity on each command event.

1. [`phase-1-asset-gc-server.md`](phase-1-asset-gc-server.md) — move asset GC to
   the server; delete the dead client GC. Independent, low-risk enabler.
2. [`phase-2-surgical-sync.md`](phase-2-surgical-sync.md) — echo-skip +
   revision-gap detection + targeted fetch. **Prerequisite for Phases 4–5.**
3. [`phase-3-unify-generation-persistence.md`](phase-3-unify-generation-persistence.md)
   — server owns the result write for all generation (remove B2). Eases Phase 4.
4. [`phase-4-chats-messages-sqlite-stub.md`](phase-4-chats-messages-sqlite-stub.md)
   — messages → SQLite table; chat/message stubs + hydrate-on-open. The big one.
5. [`phase-5-lorebook-stub.md`](phase-5-lorebook-stub.md) — stub `globalLore` +
   module `lorebook`; rework `lorebookBridge`; keep enabled modules resident.
6. [`phase-6-durable-continue-regenerate.md`](phase-6-durable-continue-regenerate.md)
   — durable `continue`/`regenerate`; chat-level reroll buffer; remove auto-continue.
7. [`phase-7-browser-auto-reattach.md`](phase-7-browser-auto-reattach.md) — reloaded
   browser re-attaches to a live in-flight generation. Capstone; movable.

## Dependency graph

```
Phase 1 (asset GC)        ── independent
Phase 2 (surgical sync)   ── prerequisite for Phases 4 & 5
Phase 3 (unify persist)   ── eases Phase 4; precondition for clean Phase 6
Phase 4 (chats→SQLite)    ── needs Phase 2; eased by Phase 3
Phase 5 (lorebooks stub)  ── needs Phase 2; shares lorebookBridge rework with Phase 4
Phase 6 (durable 4b)      ── needs Phase 3; best after Phase 4
Phase 7 (auto-reattach)   ── needs durable send only (exists) → movable
```

Hard rule: **Phase 2 before Phases 4/5.**
