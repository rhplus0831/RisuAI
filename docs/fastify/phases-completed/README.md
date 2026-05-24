# Completed Phase Archive

Date: 2026-05-24

This directory holds completed phase plans, landed slice tables, and
historical status logs that used to make the active docs noisy. Treat it
as an archive: useful for auditing and archaeology, not the place to
track the next piece of work.

## Phase Closeouts

| Phase                                   | Archive                                                                                | Notes                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 0 - Removals                            | [`phase-0-removals.md`](phase-0-removals.md)                                           | Full removal plan and exit criteria.                                    |
| 1 - Foundation                          | [`phase-1-foundation.md`](phase-1-foundation.md)                                       | Fastify scaffold, auth, health, and smoke harness.                      |
| 2 - Storage / import / assets / backups | [`phase-2-storage.md`](phase-2-storage.md)                                             | Storage, import, assets, backups, bootstrap, Docker.                    |
| 3 - Proxy migration                     | [`phase-3-proxy.md`](phase-3-proxy.md)                                                 | Proxy, hub passthrough, stream jobs, Express deletion.                  |
| 4 - sendChat tests                      | [`phase-4-sendchat-tests.md`](phase-4-sendchat-tests.md)                               | Characterization harness and initial fixtures.                          |
| 5 - sendChat extraction                 | [`phase-5-sendchat-extract.md`](phase-5-sendchat-extract.md)                           | Extraction plan and closeout.                                           |
| 6 - Server-side generation              | [`phase-6-server-generation.md`](phase-6-server-generation.md)                         | Provider dispatch closeout and deferred work.                           |
| 7 - Prompt assembly through 7-12c       | [`phase-7-prompt-assembly-through-7-12c.md`](phase-7-prompt-assembly-through-7-12c.md) | Historical Phase 7 plan, landed slices, and prior roadmap.              |
| 7-12d-i - Mutation payload              | [`phase-7-prompt-assembly-7-12d-i.md`](phase-7-prompt-assembly-7-12d-i.md)             | Typed mutation contract and `varChanged` persistence.                   |
| 7-12d-ii - Message patch applier        | [`phase-7-prompt-assembly-7-12d-ii.md`](phase-7-prompt-assembly-7-12d-ii.md)           | `message_patch` SSE event, browser applier, and local-dispatch wiring.  |
| 7-12d-iii-a - Chunk transport           | [`phase-7-prompt-assembly-7-12d-iii-a.md`](phase-7-prompt-assembly-7-12d-iii-a.md)     | Provider-agnostic `/chat` token/error/done transport and tests.         |
| 7-12d-iii-b - Server dispatch           | [`phase-7-prompt-assembly-7-12d-iii-b.md`](phase-7-prompt-assembly-7-12d-iii-b.md)     | Production `/chat` dispatch, browser stream adapter, and fixture sweep. |
| 7-12d-iv - Side effects / rollback      | [`phase-7-prompt-assembly-7-12d-iv.md`](phase-7-prompt-assembly-7-12d-iv.md)           | Typed TTS side effect and terminal error restoration rollback.          |
| 7 - Prompt assembly closeout            | [`phase-7-prompt-assembly-closeout.md`](phase-7-prompt-assembly-closeout.md)           | Final exit-criteria check and Phase 8 handoff.                          |
| 8-1a-i - Migration runner               | [`phase-8-memory-8-1a-i.md`](phase-8-memory-8-1a-i.md)                                 | `risu.db` migration runner and schema version 1 bump.                   |
| 8-1a-ii - Memory tables                 | [`phase-8-memory-8-1a-ii.md`](phase-8-memory-8-1a-ii.md)                               | Hypa V3 memory tables and schema version 2 bump.                        |
| 8-4d - Summary ordered writes           | [`phase-8-memory-8-4d.md`](phase-8-memory-8-4d.md)                                     | Summarize batch rate limiting and consecutive-success commits.          |
| 8-5a - Embedding provider contract      | [`phase-8-memory-8-5a.md`](phase-8-memory-8-5a.md)                                     | API-backed/custom embedding resolver, adapter, and validation.          |

## Historical Status Logs

| Archive                                                                    | Former home                               |
| -------------------------------------------------------------------------- | ----------------------------------------- |
| [`status-next-steps-through-7-12c.md`](status-next-steps-through-7-12c.md) | `docs/fastify/status/next-steps.md`       |
| [`status-removals.md`](status-removals.md)                                 | `docs/fastify/status/removals.md`         |
| [`phase-5-sendchat-slicing.md`](phase-5-sendchat-slicing.md)               | `docs/fastify/status/sendchat-slicing.md` |
| [`status-sendchat-2026-05-24.md`](status-sendchat-2026-05-24.md)           | `docs/fastify/status/sendchat.md`         |
| [`status-server-2026-05-24.md`](status-server-2026-05-24.md)               | `docs/fastify/status/server.md`           |

## Maintenance

- Update [`../status.md`](../status.md) and
  [`../status/next-steps.md`](../status/next-steps.md) for live handoff
  state.
- Keep active phase files focused on remaining work.
- When a phase closes, move its detailed closeout here and leave only a
  short summary in `../phases/`.
