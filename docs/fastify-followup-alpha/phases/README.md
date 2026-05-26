# Fastify Follow-Up Alpha Phases

Date: 2026-05-27

This directory is reserved for active or remaining alpha scope. Completed
detail belongs in `../phases-completed/`, not here.

## Open Phase Docs

| Phase               | Finding                                                                                                | Doc                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 9 - Client thinning | Trigger collection/chat effects still write `DBState.db` directly; guard throws in server-backed mode. | [`phase-9-trigger-projection-writes.md`](phase-9-trigger-projection-writes.md) |

## Completed Alpha Slices

| Phase                        | Status | Doc                                                                                                                                  |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 3 - Proxy migration          | Closed | [`../phases-completed/phase-3-hub-response-headers.md`](../phases-completed/phase-3-hub-response-headers.md)                         |
| 5 - sendChat extraction      | Closed | [`../phases-completed/phase-5-sendchat-boundary-alpha.md`](../phases-completed/phase-5-sendchat-boundary-alpha.md)                   |
| 6 - Server-side generation   | Closed | [`../phases-completed/phase-6-sse-line-endings.md`](../phases-completed/phase-6-sse-line-endings.md)                                 |
| 8 - Hypa V3 memory           | Closed | [`../phases-completed/phase-8-memory-event-isolation.md`](../phases-completed/phase-8-memory-event-isolation.md)                     |
| 9 - Client thinning          | Closed | [`../phases-completed/phase-9-projection-write-tails-9b.md`](../phases-completed/phase-9-projection-write-tails-9b.md)               |
| 9 - Scalar trigger/UI writes | Closed | [`../phases-completed/phase-9-trigger-scalar-projection-writes.md`](../phases-completed/phase-9-trigger-scalar-projection-writes.md) |
| Broad closeout - typecheck   | Closed | [`../phases-completed/broad-closeout-typecheck-alpha.md`](../phases-completed/broad-closeout-typecheck-alpha.md)                     |
