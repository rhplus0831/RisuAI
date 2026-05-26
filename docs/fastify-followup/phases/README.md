# Fastify Follow-Up Phases

Date: 2026-05-26

These files track reopened work found by the audit of Phases 0-9. Use
the original `docs/fastify/phases/` files for scope and boundary
context; use this directory for remaining tasks and closeout criteria.

## Phase Index

| Phase                           | State    | Open                                                                         |
| ------------------------------- | -------- | ---------------------------------------------------------------------------- |
| 0 - Removals                    | Reopened | [`phase-0-removals-followup.md`](phase-0-removals-followup.md)               |
| 3 - Proxy migration             | Reopened | [`phase-3-proxy-followup.md`](phase-3-proxy-followup.md)                     |
| 6 - Server-side generation      | Reopened | [`phase-6-generation-followup.md`](phase-6-generation-followup.md)           |
| 7 - Server-side prompt assembly | Reopened | [`phase-7-prompt-assembly-followup.md`](phase-7-prompt-assembly-followup.md) |
| 8 - Hypa V3 memory server-side  | Reopened | [`phase-8-memory-followup.md`](phase-8-memory-followup.md)                   |
| 9 - Client thinning             | Reopened | [`phase-9-client-thinning-followup.md`](phase-9-client-thinning-followup.md) |

## Dependency Order

```text
Phase 9 guard/write sweep should be the first pickup.
Phase 7 should close before relying on server-backed regenerate/manual chat smoke.
Phase 8 should close before relying on memory progress or custom embedding follow-ups.
Phase 6 can close independently but should land before broad generation closeout.
Phase 0 and Phase 3 cleanup can land independently.
```

## No Follow-Up Found

The audit did not identify remaining tasks for Phases 1, 2, 4, or 5.
Do not reopen those phases unless a new code finding appears.
