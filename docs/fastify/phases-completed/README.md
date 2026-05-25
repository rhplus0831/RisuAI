# Completed Phase Archive

Date: 2026-05-25

This directory holds completed phase plans, landed slice tables, and
historical status logs that used to make the active docs noisy. Treat it
as an archive: useful for auditing and archaeology, not the place to
track the next piece of work.

## Phase Closeouts

| Phase                                   | Archive                                                                                | Notes                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 0 - Removals                            | [`phase-0-removals.md`](phase-0-removals.md)                                           | Full removal plan and exit criteria.                                             |
| 1 - Foundation                          | [`phase-1-foundation.md`](phase-1-foundation.md)                                       | Fastify scaffold, auth, health, and smoke harness.                               |
| 2 - Storage / import / assets / backups | [`phase-2-storage.md`](phase-2-storage.md)                                             | Storage, import, assets, backups, bootstrap, Docker.                             |
| 3 - Proxy migration                     | [`phase-3-proxy.md`](phase-3-proxy.md)                                                 | Proxy, hub passthrough, stream jobs, Express deletion.                           |
| 4 - sendChat tests                      | [`phase-4-sendchat-tests.md`](phase-4-sendchat-tests.md)                               | Characterization harness and initial fixtures.                                   |
| 5 - sendChat extraction                 | [`phase-5-sendchat-extract.md`](phase-5-sendchat-extract.md)                           | Extraction plan and closeout.                                                    |
| 6 - Server-side generation              | [`phase-6-server-generation.md`](phase-6-server-generation.md)                         | Provider dispatch closeout and deferred work.                                    |
| 7 - Prompt assembly through 7-12c       | [`phase-7-prompt-assembly-through-7-12c.md`](phase-7-prompt-assembly-through-7-12c.md) | Historical Phase 7 plan, landed slices, and prior roadmap.                       |
| 7-12d-i - Mutation payload              | [`phase-7-prompt-assembly-7-12d-i.md`](phase-7-prompt-assembly-7-12d-i.md)             | Typed mutation contract and `varChanged` persistence.                            |
| 7-12d-ii - Message patch applier        | [`phase-7-prompt-assembly-7-12d-ii.md`](phase-7-prompt-assembly-7-12d-ii.md)           | `message_patch` SSE event, browser applier, and local-dispatch wiring.           |
| 7-12d-iii-a - Chunk transport           | [`phase-7-prompt-assembly-7-12d-iii-a.md`](phase-7-prompt-assembly-7-12d-iii-a.md)     | Provider-agnostic `/chat` token/error/done transport and tests.                  |
| 7-12d-iii-b - Server dispatch           | [`phase-7-prompt-assembly-7-12d-iii-b.md`](phase-7-prompt-assembly-7-12d-iii-b.md)     | Production `/chat` dispatch, browser stream adapter, and fixture sweep.          |
| 7-12d-iv - Side effects / rollback      | [`phase-7-prompt-assembly-7-12d-iv.md`](phase-7-prompt-assembly-7-12d-iv.md)           | Typed TTS side effect and terminal error restoration rollback.                   |
| 7 - Prompt assembly closeout            | [`phase-7-prompt-assembly-closeout.md`](phase-7-prompt-assembly-closeout.md)           | Final exit-criteria check and Phase 8 handoff.                                   |
| 8-1a-i - Migration runner               | [`phase-8-memory-8-1a-i.md`](phase-8-memory-8-1a-i.md)                                 | `risu.db` migration runner and schema version 1 bump.                            |
| 8-1a-ii - Memory tables                 | [`phase-8-memory-8-1a-ii.md`](phase-8-memory-8-1a-ii.md)                               | Hypa V3 memory tables and schema version 2 bump.                                 |
| 8-1b - Memory repositories              | [`phase-8-memory-8-1b.md`](phase-8-memory-8-1b.md)                                     | Typed row mappers and repository primitives.                                     |
| 8-1c - Legacy memory import             | [`phase-8-memory-8-1c.md`](phase-8-memory-8-1c.md)                                     | Legacy `hypaV3Data` import/backfill into memory rows.                            |
| 8-2a - Queue state machine              | [`phase-8-memory-8-2a.md`](phase-8-memory-8-2a.md)                                     | Enqueue, claim, complete, fail, cancel, and list primitives.                     |
| 8-2b - Worker lifecycle                 | [`phase-8-memory-8-2b.md`](phase-8-memory-8-2b.md)                                     | In-process worker start/stop/tick behavior.                                      |
| 8-2c - Retry recovery                   | [`phase-8-memory-8-2c.md`](phase-8-memory-8-2c.md)                                     | Attempt counts, retry backoff, and boot recovery.                                |
| 8-2d - Progress event contract          | [`phase-8-memory-8-2d.md`](phase-8-memory-8-2d.md)                                     | Memory job events and Hypa V3 progress side effects.                             |
| 8-2e - Memory job routes                | [`phase-8-memory-8-2e.md`](phase-8-memory-8-2e.md)                                     | Auth-gated enqueue/list/cancel routes.                                           |
| 8-3a - Planner contract                 | [`phase-8-memory-8-3a.md`](phase-8-memory-8-3a.md)                                     | Standard Hypa V3 settings and pure planner contract.                             |
| 8-3b - Orphan cleanup                   | [`phase-8-memory-8-3b.md`](phase-8-memory-8-3b.md)                                     | Summary/chunk cleanup with embedding cascade behavior.                           |
| 8-3c - Planner closeout                 | [`phase-8-memory-8-3c.md`](phase-8-memory-8-3c.md)                                     | Deterministic planner output and diagnostics.                                    |
| 8-3d - Chunk job bridge                 | [`phase-8-memory-8-3d.md`](phase-8-memory-8-3d.md)                                     | Deterministic chunks plus planned summarize jobs.                                |
| 8-4a - Summary prompt builder           | [`phase-8-memory-8-4a.md`](phase-8-memory-8-4a.md)                                     | Hypa V3 summary prompt and scrub helpers.                                        |
| 8-4b - Summary provider adapter         | [`phase-8-memory-8-4b.md`](phase-8-memory-8-4b.md)                                     | API-backed summary adapter over OpenAI-compatible dispatch.                      |
| 8-4c - Summarize job handler            | [`phase-8-memory-8-4c.md`](phase-8-memory-8-4c.md)                                     | Executable summarize jobs against planned chunks.                                |
| 8-4d - Summary ordered writes           | [`phase-8-memory-8-4d.md`](phase-8-memory-8-4d.md)                                     | Summarize batch rate limiting and consecutive-success commits.                   |
| 8-5a - Embedding provider contract      | [`phase-8-memory-8-5a.md`](phase-8-memory-8-5a.md)                                     | API-backed/custom embedding resolver, adapter, and validation.                   |
| 8-5b - Embed job handler                | [`phase-8-memory-8-5b.md`](phase-8-memory-8-5b.md)                                     | Embed job handler, vector persistence, idempotence, and batch limits.            |
| 8-5c - Voyage contextual embeddings     | [`phase-8-memory-8-5c.md`](phase-8-memory-8-5c.md)                                     | Voyage grouped embeddings with flat-table group metadata.                        |
| 8-5d - Pure similarity ranking          | [`phase-8-memory-8-5d.md`](phase-8-memory-8-5d.md)                                     | Pure cosine ranking over summaries, chunks, and embedding rows.                  |
| 8-5e - Pure memory budget allocator     | [`phase-8-memory-8-5e.md`](phase-8-memory-8-5e.md)                                     | Pure important/recent/similar/random summary budget selection.                   |
| 8-5f - Memory selection service facade  | [`phase-8-memory-8-5f.md`](phase-8-memory-8-5f.md)                                     | Read-only repository/ranking/allocation facade for prompt integration.           |
| 8-6a - Prompt memory adapter contract   | [`phase-8-memory-8-6a.md`](phase-8-memory-8-6a.md)                                     | Prompt-facing contract, diagnostics, and no-hot-path-work guardrails.            |
| 8-6b - Summary prompt-row assembly      | [`phase-8-memory-8-6b.md`](phase-8-memory-8-6b.md)                                     | Canonical `hypaMemory` prompt rows from selected memory summaries.               |
| 8-6c - Assemble integration             | [`phase-8-memory-8-6c.md`](phase-8-memory-8-6c.md)                                     | Root assembler integration for selected canonical Hypa memory rows.              |
| 8-6d - Missing-memory follow-up enqueue | [`phase-8-memory-8-6d.md`](phase-8-memory-8-6d.md)                                     | Best-effort summarize/embed enqueue from prompt-memory diagnostics.              |
| 8-7a - Chunk + summary read routes      | [`phase-8-memory-8-7a.md`](phase-8-memory-8-7a.md)                                     | Auth-gated chunk/summary read routes for the browser adapter.                    |
| 8-7b - Browser memory API adapter       | [`phase-8-memory-8-7b.md`](phase-8-memory-8-7b.md)                                     | Gated browser client for memory reads, jobs, and cancellation.                   |
| 8-7c - Browser progress listener        | [`phase-8-memory-8-7c.md`](phase-8-memory-8-7c.md)                                     | Gated `hypav3_progress` side effects into `hypaV3ProgressStore`.                 |
| 8-7d - Memory job list/cancel UI        | [`phase-8-memory-8-7d.md`](phase-8-memory-8-7d.md)                                     | Fastify-gated Hypa V3 modal job list, refresh, and cancellation.                 |
| 8-7e - `hypav3-memory` fixture parity   | [`phase-8-memory-8-7e.md`](phase-8-memory-8-7e.md)                                     | Server-backed memory fixture, progress, list/cancel, and diagnostics.            |
| 8-8 - Live chunk-planning hook          | [`phase-8-memory-8-8.md`](phase-8-memory-8-8.md)                                       | Prompt-assembly chunk planning and idempotent summarize job enqueue.             |
| 8-9 - Phase 8 closeout                  | [`phase-8-memory-8-9.md`](phase-8-memory-8-9.md)                                       | Final verification, exit-criteria confirmation, and Phase 9 handoff.             |
| 9-0 - Mutation inventory / command map  | [`phase-9-client-thinning-9-0.md`](phase-9-client-thinning-9-0.md)                     | Phase 9 mutation inventory, command contract, and implementation handoff.        |
| 9-1 - Command foundation                | [`phase-9-client-thinning-9-1.md`](phase-9-client-thinning-9-1.md)                     | Command route plumbing, JSON mutation helper, event sink, and harness command.   |
| 9-2a-i - Scalar settings commands       | [`phase-9-client-thinning-9-2a-i.md`](phase-9-client-thinning-9-2a-i.md)               | Grouped scalar settings commands, browser helper, and data-driven bridge.        |
| 9-2a-ii - Manual scalar settings pages  | [`phase-9-client-thinning-9-2a-ii.md`](phase-9-client-thinning-9-2a-ii.md)             | Fastify-only manual settings bridge, scalar map extensions, and rollback tests.  |
| 9-2b - Bot presets                      | [`phase-9-client-thinning-9-2b.md`](phase-9-client-thinning-9-2b.md)                   | Preset lifecycle/select/apply commands, browser helpers, and UI/storage bridge.  |
| 9-2c - Prompt templates/items           | [`phase-9-client-thinning-9-2c.md`](phase-9-client-thinning-9-2c.md)                   | Prompt settings/items commands, browser helpers, and prompt UI bridge.           |
| 9-2d - Personas                         | [`phase-9-client-thinning-9-2d.md`](phase-9-client-thinning-9-2d.md)                   | Persona lifecycle/select commands, browser helpers, and mirror-field bridge.     |
| 9-2e - Translator presets               | [`phase-9-client-thinning-9-2e.md`](phase-9-client-thinning-9-2e.md)                   | Translator preset lifecycle/select commands, browser helpers, and sync bridge.   |
| 9-2f - Loadouts                         | [`phase-9-client-thinning-9-2f.md`](phase-9-client-thinning-9-2f.md)                   | Loadout save/delete/favorite/touch commands, browser helpers, and UI bridge.     |
| 9-3a - Characters                       | [`phase-9-client-thinning-9-3a.md`](phase-9-client-thinning-9-3a.md)                   | Character catalog/profile commands, browser helpers, and UI bridge.              |
| 9-3b - Chats                            | [`phase-9-client-thinning-9-3b.md`](phase-9-client-thinning-9-3b.md)                   | Chat/folder lifecycle, metadata commands, browser helpers, and UI bridge.        |
| 9-3c - Messages                         | [`phase-9-client-thinning-9-3c.md`](phase-9-client-thinning-9-3c.md)                   | Message append/update/delete/truncate/replace commands, helpers, and UI bridge.  |
| 9-3d - Generation persistence           | [`phase-9-client-thinning-9-3d.md`](phase-9-client-thinning-9-3d.md)                   | Generation result command, helper, and server-backed sendChat handoff.           |
| 9-3e - Chat scriptstate                 | [`phase-9-client-thinning-9-3e.md`](phase-9-client-thinning-9-3e.md)                   | Chat scriptstate command, browser helper, and scripting side-effect bridge.      |
| 9-3f - Compatibility adapters           | [`phase-9-client-thinning-9-3f.md`](phase-9-client-thinning-9-3f.md)                   | Legacy setters, plugin/MCP adapters, and explicit later-slice unsupported paths. |
| 9-4a - Lorebook collections             | [`phase-9-client-thinning-9-4a.md`](phase-9-client-thinning-9-4a.md)                   | Lorebook commands, browser helpers, UI bridge, and MCP lorebook routing.         |
| 9-4b - Scripts/triggers                 | [`phase-9-client-thinning-9-4b.md`](phase-9-client-thinning-9-4b.md)                   | Script/trigger commands, browser helpers, UI bridge, and MCP regex/Lua routing.  |
| 9-4c - Modules                          | [`phase-9-client-thinning-9-4c.md`](phase-9-client-thinning-9-4c.md)                   | Module records, enablement, reorder/link commands, helpers, and UI/MCP routing.  |
| 9-4d - Asset references                 | [`phase-9-client-thinning-9-4d.md`](phase-9-client-thinning-9-4d.md)                   | Asset-reference validation, upload helper routing, and owning command coverage.  |
| 9-4e - Plugins                          | [`phase-9-client-thinning-9-4e.md`](phase-9-client-thinning-9-4e.md)                   | Plugin record/config commands, helpers, provider selection, and UI/API routing.  |
| 9-4f - Plugin storage                   | [`phase-9-client-thinning-9-4f.md`](phase-9-client-thinning-9-4f.md)                   | Plugin-storage commands, helpers, and plugin database adapter routing.           |
| 9-4g - Compatibility sweep              | [`phase-9-client-thinning-9-4g.md`](phase-9-client-thinning-9-4g.md)                   | Plugin database provider/module bridge sweep and focused compatibility coverage. |

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
