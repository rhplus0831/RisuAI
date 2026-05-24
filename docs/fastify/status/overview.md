# Status Overview

Date: 2026-05-24

Concise snapshot of each migration workstream. Historical detail is in
[`../phases-completed/`](../phases-completed/).

## Phase Progress

| Phase | Status | Notes |
| --- | --- | --- |
| 0 - Removals | Complete | Closed 2026-05-20. |
| 1 - Foundation | Complete | Closed 2026-05-20. |
| 2 - Storage / import / assets / backups | Complete | Closed 2026-05-20. |
| 3 - Proxy migration | Complete | Closed 2026-05-21; Express deleted. |
| 4 - sendChat tests | Complete | Closed 2026-05-20. |
| 5 - sendChat extraction | Complete | Closed 2026-05-22. |
| 6 - Server-side generation | Complete | Closed 2026-05-22 for `/completion`. |
| 7 - Server-side prompt assembly | Complete | Closed 2026-05-24 after closeout verification. |
| 8 - Hypa V3 memory server-side | In progress | Next slice: 8-1a-i migration runner + version bump. |
| 9 - Client thinning | Not started | Waits for server-owned prompt, generation, and memory paths. |

## Workstreams

- Server: Fastify owns the live server path. See [`server.md`](server.md).
- sendChat: send-like and preview paths can use server assembly behind
  `db.useServerPromptAssembly`. See [`sendchat.md`](sendchat.md).
- Provider coverage: the current routed matrix lives in
  [`../coverage/providers.md`](../coverage/providers.md).
- Historical logs: old removals, server, and sendChat slice records are
  archived in [`../phases-completed/`](../phases-completed/).
