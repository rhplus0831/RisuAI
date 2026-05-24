# Migration Phases

Date: 2026-05-24

These files track current or remaining migration work. Completed
details, landed slice tables, and old status logs live in
[`../phases-completed/`](../phases-completed/).

Use this directory for:

- Goals and boundaries for active or future phases.
- Remaining work and exit criteria.
- Short closeout summaries for phases with no remaining work.

Do not keep long landed-slice logs here. When a phase closes, move the
historical detail into `phases-completed/` and leave a brief summary in
the phase file.

## Phase Index

| Phase                                   | Status            | Open                                                           |
| --------------------------------------- | ----------------- | -------------------------------------------------------------- |
| 0 - Removals                            | Closed 2026-05-20 | [`phase-0-removals.md`](phase-0-removals.md)                   |
| 1 - Foundation                          | Closed 2026-05-20 | [`phase-1-foundation.md`](phase-1-foundation.md)               |
| 2 - Storage / import / assets / backups | Closed 2026-05-20 | [`phase-2-storage.md`](phase-2-storage.md)                     |
| 3 - Proxy migration                     | Closed 2026-05-21 | [`phase-3-proxy.md`](phase-3-proxy.md)                         |
| 4 - sendChat tests                      | Closed 2026-05-20 | [`phase-4-sendchat-tests.md`](phase-4-sendchat-tests.md)       |
| 5 - sendChat extraction                 | Closed 2026-05-22 | [`phase-5-sendchat-extract.md`](phase-5-sendchat-extract.md)   |
| 6 - Server-side generation              | Closed 2026-05-22 | [`phase-6-server-generation.md`](phase-6-server-generation.md) |
| 7 - Server-side prompt assembly         | Closed 2026-05-24 | [`phase-7-prompt-assembly.md`](phase-7-prompt-assembly.md)     |
| 8 - Hypa V3 memory server-side          | In progress       | [`phase-8-memory.md`](phase-8-memory.md)                       |
| 9 - Client thinning                     | Not started       | [`phase-9-client-thinning.md`](phase-9-client-thinning.md)     |

## Dependency Order

```text
0 -> 1 -> 2 -> 8
0 -> 1 -> 3 -> 6 -> 7 -> 9
0 -> 4 -> 5 -> 6
```

Phase 8 is the active phase. Phase 7 is closed, and 8-1a-i has landed,
so the next pickup is 8-1a-ii memory tables in the current schema.
Phase 9 waits for the
server-owned generation, prompt assembly, and memory surfaces to settle.

## Completed Detail

The archived versions of the closed phase docs are indexed in
[`../phases-completed/README.md`](../phases-completed/README.md).
