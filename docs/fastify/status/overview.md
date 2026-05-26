# Status Overview

Date: 2026-05-26

Concise snapshot of each original migration workstream. Active
post-closeout audit work lives in `docs/fastify-followup`; historical
detail is in [`../phases-completed/`](../phases-completed/).

## Phase Progress

| Phase                                   | Status   | Notes                                                                |
| --------------------------------------- | -------- | -------------------------------------------------------------------- |
| 0 - Removals                            | Complete | Closed 2026-05-20; follow-up tracks a public Drive artifact.         |
| 1 - Foundation                          | Complete | Closed 2026-05-20.                                                   |
| 2 - Storage / import / assets / backups | Complete | Closed 2026-05-20.                                                   |
| 3 - Proxy migration                     | Complete | Closed 2026-05-21; follow-up tracks stream-job header filtering.     |
| 4 - sendChat tests                      | Complete | Closed 2026-05-20.                                                   |
| 5 - sendChat extraction                 | Complete | Closed 2026-05-22.                                                   |
| 6 - Server-side generation              | Complete | Closed 2026-05-22 for `/completion`; streaming error follow-up open. |
| 7 - Server-side prompt assembly         | Complete | Closed 2026-05-24; regenerate/provider/stop-trigger follow-up open.  |
| 8 - Hypa V3 memory server-side          | Complete | Closed 2026-05-25; memory follow-up open.                            |
| 9 - Client thinning                     | Complete | Closed 2026-05-26 for Fastify web; direct-write follow-up open.      |

## Workstreams

- Server: Fastify owns the live server path. See [`server.md`](server.md).
- sendChat: send/continue and preview paths can use server assembly
  behind `db.useServerPromptAssembly`; regenerate follow-up is reopened.
  See [`sendchat.md`](sendchat.md).
- Provider coverage: the current routed matrix lives in
  [`../coverage/providers.md`](../coverage/providers.md).
- Phase 9 command map:
  [`phase-9-command-map.md`](phase-9-command-map.md).
- Historical logs: old removals, server, and sendChat slice records are
  archived in [`../phases-completed/`](../phases-completed/).
