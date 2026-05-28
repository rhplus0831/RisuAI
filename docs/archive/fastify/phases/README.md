# Migration Phases

Substantive scope and design documents for the ten Fastify migration
phases. Each file captures the phase's goal, scope, boundaries, exit
criteria, and the design decisions that were locked in during
implementation. Per-slice closeout logs have been dropped — the
substantive content is preserved in these files.

The follow-up [`fastify-only.md`](fastify-only.md) summarizes the
post-migration lockdown that removed the residual non-Fastify runtime
surfaces (alternative server adapters, legacy client wrappers, service
worker, browser-side persistence, legacy client endpoints).

The client-thinning workstream that grew out of Phase 9 lives in
[`../client-thinning/`](../client-thinning/), including the locked
[`command-map.md`](../client-thinning/command-map.md).

## Phase Index

| Phase                                          | Closed     | Document                                              |
| ---------------------------------------------- | ---------- | ----------------------------------------------------- |
| 0 — Removals                                   | 2026-05-20 | [`phase-0-removals.md`](phase-0-removals.md)          |
| 1 — Foundation                                 | 2026-05-20 | [`phase-1-foundation.md`](phase-1-foundation.md)      |
| 2 — Storage / import / assets / backups        | 2026-05-20 | [`phase-2-storage.md`](phase-2-storage.md)            |
| 3 — Proxy migration                            | 2026-05-21 | [`phase-3-proxy.md`](phase-3-proxy.md)                |
| 4 — sendChat tests                             | 2026-05-20 | [`phase-4-sendchat-tests.md`](phase-4-sendchat-tests.md) |
| 5 — sendChat extraction                        | 2026-05-22 | [`phase-5-sendchat-extract.md`](phase-5-sendchat-extract.md) |
| 6 — Server-side generation                     | 2026-05-22 | [`phase-6-server-generation.md`](phase-6-server-generation.md) |
| 7 — Server-side prompt assembly                | 2026-05-24 | [`phase-7-prompt-assembly.md`](phase-7-prompt-assembly.md) |
| 8 — Hypa V3 memory server-side                 | 2026-05-25 | [`phase-8-memory.md`](phase-8-memory.md)              |
| 9 — Client thinning (migration milestone)      | 2026-05-26 | [`phase-9-client-thinning.md`](phase-9-client-thinning.md) |
| Fastify-only lockdown                          | 2026-05-27 | [`fastify-only.md`](fastify-only.md)                  |

## Dependency Order

```text
0 → 1 → 2 → 8 → 9
0 → 1 → 3 → 6 → 7 → 8
0 → 4 → 5 → 6 → 7
```

## Locked Decisions

- **Stack.** Fastify + TypeScript.
- **Storage.** SQLite via `node:sqlite` (Node 24+) for metadata/
  revision. Domain state in `data/db.json`; content-addressed assets
  on disk.
- **No compatibility migrations.** No users yet; edit current shapes.
- **Sequence.** Remove first, then port. Phase 0 stripped deprecated
  features before server work began.
- **Client modes.** Server-backed web only. All non-Fastify client
  modes (legacy native and mobile wrappers, installable-app, and
  browser-side persistence) are no-port and were removed by the
  Fastify-only lockdown.
- **Memory.** Only Hypa V3. Supa, Hypa V2, Hanurai removed.
- **Drive.** Google Drive sync removed in Phase 0.
