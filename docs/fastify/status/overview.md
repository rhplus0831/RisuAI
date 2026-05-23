# Status Overview

Date: 2026-05-23

Concise snapshot of where each workstream stands. Detail per
workstream lives in the sibling shards.

## Phase progress

| Phase                                   | Status      | Notes                                                             |
| --------------------------------------- | ----------- | ----------------------------------------------------------------- |
| 0 - Removals                            | complete    | Closed 2026-05-20; see removals shard.                            |
| 1 - Foundation                          | complete    | Closed 2026-05-20; health/auth smoke.                             |
| 2 - Storage / import / assets / backups | complete    | Closed 2026-05-20; server routes + Docker.                        |
| 3 - Proxy migration                     | complete    | Closed 2026-05-21; Express deleted.                               |
| 4 - sendChat tests                      | complete    | Closed 2026-05-20; 17 initial fixtures.                           |
| 5 - sendChat extraction                 | complete    | Closed 2026-05-22; all 28 slices landed.                          |
| 6 - Server-side generation              | complete    | Completion route closed in Phase 6-28; helpers remain follow-ups. |
| 7 - Server-side prompt assembly         | in progress | 29 slices landed through 7-9f; next is 7-10a (template front).    |
| 8 - Hypa V3 memory server-side          | not started | Blocked on Phase 2 + Phase 7.                                     |
| 9 - Client thinning                     | not started | Blocked on all of the above.                                      |

## Workstreams

- **Removals.** Captured in [`removals.md`](removals.md). Feature
  removal is complete; a couple of stale, unreachable group-chat UI
  checks remain documented as cleanup debt.
- **Server.** Captured in [`server.md`](server.md). Phases 1-3 are
  landed; Phase 6 completion routing is closed with
  `/api/v1/generate/completion` routed through the current provider
  matrix. Phase 7 has added the `/api/v1/generate/chat` scaffold,
  prompt leaves through history shaping, regex scripts, module
  helpers, lorebook activation through budget truncation, and the
  tokens / budget chain, plus the Phase 7-safe trigger runner
  through V2 safe data helpers.
  The Docker runtime targets Fastify, Express has been deleted, and
  the production image
  installs the runtime dependencies needed by `pnpm api:start`.
  The Fastify-served SPA wires its self-host gates via `__NODE__`
  and `__FASTIFY__` injection in `index.html`.
- **sendChat.** Captured in [`sendchat.md`](sendchat.md). Phase 5
  is closed: `src/ts/process/index.svelte.ts` is 445 lines, with
  prompt assembly, request budgeting, dispatch, response
  orchestration, Stage 4 closeout, and entry-context setup
  extracted into focused modules. The current guardrail is 38 local
  snapshots plus 12 server-backed provider-parity fixtures; the
  Phase 5 slice history lives in
  [`sendchat-slicing.md`](sendchat-slicing.md).

## Reference state

The `move-to-fastify` branch (68 commits ahead of `main`) is a
worked example of Phases 1-6 in one push. It is reference, not
plan: this roadmap reshapes the API surface (no whole-state PUT,
no group-chat commands, simpler memory tables) and sequences
removals first.
