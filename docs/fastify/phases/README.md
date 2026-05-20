# Migration Phases

Date: 2026-05-20

Each phase doc owns its scope, exit criteria, and inline boundary
rules. Status moves through the matching shards under
[`../status/`](../status/).

Read order during planning:

1. [`phase-0-removals.md`](phase-0-removals.md) - Group, peer
   multiuser, Risu Account Sync, Drive sync, legacy memory.
2. [`phase-1-foundation.md`](phase-1-foundation.md) - Fastify
   scaffold, auth, health, env loader.
3. [`phase-2-storage.md`](phase-2-storage.md) - SQLite metadata,
   JSON repository, assets, import, backups.
4. [`phase-3-proxy.md`](phase-3-proxy.md) - provider proxy + hub
   passthrough + stream-job WebSocket.
5. [`phase-4-sendchat-tests.md`](phase-4-sendchat-tests.md) - pin
   sendChat behavior with fixtures.
6. [`phase-5-sendchat-extract.md`](phase-5-sendchat-extract.md) -
   carve sendChat into stage modules.
7. [`phase-6-server-generation.md`](phase-6-server-generation.md) -
   move provider dispatch and helper providers server-side.
8. [`phase-7-prompt-assembly.md`](phase-7-prompt-assembly.md) -
   server walks the prompt template + lorebook.
9. [`phase-8-memory.md`](phase-8-memory.md) - Hypa V3 chunking,
   embeddings, summarization as async jobs.
10. [`phase-9-client-thinning.md`](phase-9-client-thinning.md) -
    client becomes a projection.

## Phase ordering and dependencies

```
0 ─┬─> 1 ─┬─> 2 ─┬─> 8
   │      │      │
   │      └─> 3 ─┴─> 6 ──> 7 ──> 9
   │
   └─> 4 ──> 5 ───────┘
```

- Phase 0 is a hard prerequisite for everything else.
- Phases 1, 2, 3 form a server-side dependency chain.
- Phase 4 (sendChat tests) ran in parallel with 1-3 and is now
  complete.
- Phase 5 (sendChat extraction) needs Phase 4's tests in place;
  that dependency is now satisfied.
- Phase 6 needs both server-side proxy (Phase 3) and extracted
  client stages (Phase 5) so the server can take over Stage 3
  without breaking Stages 1, 2, 4.
- Phase 7 needs Phase 6's dispatch endpoint to call into.
- Phase 8 needs Phase 2's data-dir/repository foundation and Phase
  7's prompt walker.
- Phase 9 closes the loop.

## Per-phase doc shape

Each phase doc has these sections:

- **Goal** - one or two sentences.
- **Preconditions** - which phases must close first.
- **Scope** - what code lands or gets deleted.
- **Boundaries** - what is explicitly out of scope for this
  phase. Read this before adding "while we're here" work.
- **Exit criteria** - what proves the phase is done.
- **Reference** - which `move-to-fastify` commits or metatron
  modules are useful when implementing.
