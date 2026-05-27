# Migration Phases

Date: 2026-05-27

All phases (0-9) are closed. Completed plans, slice tables, and
historical logs live in [`../phases-completed/`](../phases-completed/).

This directory is reserved for future phase docs if new work is opened.

## Phase Index

| Phase | Closed | Archive |
|-------|--------|---------|
| 0 - Removals | 2026-05-20 | [`../phases-completed/phase-0-removals-scope.md`](../phases-completed/phase-0-removals-scope.md) |
| 1 - Foundation | 2026-05-20 | [`../phases-completed/phase-1-foundation-scope.md`](../phases-completed/phase-1-foundation-scope.md) |
| 2 - Storage | 2026-05-20 | [`../phases-completed/phase-2-storage-scope.md`](../phases-completed/phase-2-storage-scope.md) |
| 3 - Proxy | 2026-05-21 | [`../phases-completed/phase-3-proxy-scope.md`](../phases-completed/phase-3-proxy-scope.md) |
| 4 - sendChat tests | 2026-05-20 | [`../phases-completed/phase-4-sendchat-tests-scope.md`](../phases-completed/phase-4-sendchat-tests-scope.md) |
| 5 - sendChat extraction | 2026-05-22 | [`../phases-completed/phase-5-sendchat-extract-scope.md`](../phases-completed/phase-5-sendchat-extract-scope.md) |
| 6 - Server-side generation | 2026-05-22 | [`../phases-completed/phase-6-server-generation-scope.md`](../phases-completed/phase-6-server-generation-scope.md) |
| 7 - Prompt assembly | 2026-05-24 | [`../phases-completed/phase-7-prompt-assembly.md`](../phases-completed/phase-7-prompt-assembly.md) |
| 8 - Hypa V3 memory | 2026-05-25 | [`../phases-completed/phase-8-memory.md`](../phases-completed/phase-8-memory.md) |
| 9 - Client thinning | 2026-05-26 | [`../phases-completed/phase-9-client-thinning.md`](../phases-completed/phase-9-client-thinning.md) |

> **Note:** The Phase 9 *migration milestone* closed on the date above and stays
> closed. Client thinning continues as a standing server-projection workstream —
> the invariant, exit criteria, and open findings live in
> [`../client-thinning/`](../client-thinning/), not in this migration index.

## Dependency Order

```text
0 -> 1 -> 2 -> 8 -> 9
0 -> 1 -> 3 -> 6 -> 7 -> 8
0 -> 4 -> 5 -> 6 -> 7
```
