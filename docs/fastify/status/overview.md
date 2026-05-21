# Status Overview

Date: 2026-05-21

Concise snapshot of where each workstream stands. Detail per
workstream lives in the sibling shards.

## Phase progress

| Phase                                   | Status      | Notes                                      |
| --------------------------------------- | ----------- | ------------------------------------------ |
| 0 - Removals                            | complete    | Closed 2026-05-20; see removals shard.     |
| 1 - Foundation                          | complete    | Closed 2026-05-20; health/auth smoke.      |
| 2 - Storage / import / assets / backups | complete    | Closed 2026-05-20; server routes + Docker. |
| 3 - Proxy migration                     | complete    | Closed 2026-05-21; Express deleted.        |
| 4 - sendChat tests                      | complete    | Closed 2026-05-20; all 17 fixtures landed. |
| 5 - sendChat extraction                 | in progress | Phase 5-1 through 5-12 landed.             |
| 6 - Server-side generation              | not started | Blocked on Phase 5 closeout.               |
| 7 - Server-side prompt assembly         | not started | Blocked on Phase 6.                        |
| 8 - Hypa V3 memory server-side          | not started | Blocked on Phase 2 + Phase 7.              |
| 9 - Client thinning                     | not started | Blocked on all of the above.               |

## Workstreams

- **Removals.** Captured in [`removals.md`](removals.md). Feature
  removal is complete; a couple of stale, unreachable group-chat UI
  checks remain documented as cleanup debt.
- **Server.** Captured in [`server.md`](server.md). Phases 1 +
  2 + 3 are landed; Docker targets Fastify and Express has been
  deleted. The current production-image dependency layout still
  needs follow-up before the image is self-contained. The
  Fastify-served SPA wires its self-host gates via `__NODE__` +
  `__FASTIFY__` injection in `index.html`.
- **sendChat.** Captured in [`sendchat.md`](sendchat.md). Phase
  5 extraction is active: `src/ts/process/index.svelte.ts` is
  currently 1713 lines, with auto-continue, error reporting, and
  several post-generation / response-loop helpers extracted into
  focused modules while the 17-fixture characterization harness
  keeps observable behavior pinned.

## Reference state

The `move-to-fastify` branch (68 commits ahead of `main`) is a
worked example of Phases 1-6 in one push. It is reference, not
plan: this roadmap reshapes the API surface (no whole-state PUT,
no group-chat commands, simpler memory tables) and sequences
removals first.
