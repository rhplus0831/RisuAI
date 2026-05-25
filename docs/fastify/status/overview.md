# Status Overview

Date: 2026-05-25

Concise snapshot of each migration workstream. Historical detail is in
[`../phases-completed/`](../phases-completed/).

## Phase Progress

| Phase                                   | Status      | Notes                                                                                        |
| --------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| 0 - Removals                            | Complete    | Closed 2026-05-20.                                                                           |
| 1 - Foundation                          | Complete    | Closed 2026-05-20.                                                                           |
| 2 - Storage / import / assets / backups | Complete    | Closed 2026-05-20.                                                                           |
| 3 - Proxy migration                     | Complete    | Closed 2026-05-21; Express deleted.                                                          |
| 4 - sendChat tests                      | Complete    | Closed 2026-05-20.                                                                           |
| 5 - sendChat extraction                 | Complete    | Closed 2026-05-22.                                                                           |
| 6 - Server-side generation              | Complete    | Closed 2026-05-22 for `/completion`.                                                         |
| 7 - Server-side prompt assembly         | Complete    | Closed 2026-05-24 after closeout verification.                                               |
| 8 - Hypa V3 memory server-side          | Complete    | Closed 2026-05-25 after full closeout verification.                                          |
| 9 - Client thinning                     | In progress | Commands have landed through 9-4a lorebook collections; next slice is 9-4b scripts/triggers. |

## Workstreams

- Server: Fastify owns the live server path. See [`server.md`](server.md).
- sendChat: send-like and preview paths can use server assembly behind
  `db.useServerPromptAssembly`. See [`sendchat.md`](sendchat.md).
- Provider coverage: the current routed matrix lives in
  [`../coverage/providers.md`](../coverage/providers.md).
- Phase 9 command map:
  [`phase-9-command-map.md`](phase-9-command-map.md).
- Historical logs: old removals, server, and sendChat slice records are
  archived in [`../phases-completed/`](../phases-completed/).
