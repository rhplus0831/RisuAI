# Status Overview

Date: 2026-05-27

Concise snapshot of each original migration workstream. The
post-closeout audit is archived under `phases-completed/`;
historical detail is in [`../phases-completed/`](../phases-completed/).

## Phase Progress

| Phase                                   | Status   | Notes                                                                 |
| --------------------------------------- | -------- | --------------------------------------------------------------------- |
| 0 - Removals                            | Complete | Closed 2026-05-20; public Drive artifact follow-up closed 2026-05-27. |
| 1 - Foundation                          | Complete | Closed 2026-05-20.                                                    |
| 2 - Storage / import / assets / backups | Complete | Closed 2026-05-20.                                                    |
| 3 - Proxy migration                     | Complete | Closed 2026-05-21; stream-job header follow-up closed 2026-05-27.     |
| 4 - sendChat tests                      | Complete | Closed 2026-05-20.                                                    |
| 5 - sendChat extraction                 | Complete | Closed 2026-05-22.                                                    |
| 6 - Server-side generation              | Complete | Closed 2026-05-22 for `/completion`; streaming error follow-up closed 2026-05-27. |
| 7 - Server-side prompt assembly         | Complete | Closed 2026-05-24; follow-up closed again 2026-05-27.                 |
| 8 - Hypa V3 memory server-side          | Complete | Closed 2026-05-25; memory follow-up closed 2026-05-27.                |
| 9 - Client thinning                     | Complete | Closed 2026-05-26 for Fastify web; follow-up closed again 2026-05-27. |

## Workstreams

- Server: Fastify owns the live server path. See [`../status/server.md`](../status/server.md).
- sendChat: send, continue, regenerate, preview, and preview-prompt can
  use server assembly behind `db.useServerPromptAssembly`.
  See [`../status/sendchat.md`](../status/sendchat.md).
- Provider coverage: the current routed matrix lives in
  [`../coverage/providers.md`](../coverage/providers.md).
- Phase 9 command map:
  [`phase-9-command-map.md`](phase-9-command-map.md).
- Historical logs: old removals, server, and sendChat slice records are
  archived in [`../phases-completed/`](../phases-completed/).
