# Status Overview

Date: 2026-05-20

Concise snapshot of where each workstream stands. Detail per
workstream lives in the sibling shards.

## Phase progress

| Phase                                   | Status      | Notes                                      |
| --------------------------------------- | ----------- | ------------------------------------------ |
| 0 - Removals                            | complete    | Closed 2026-05-20; see removals shard.     |
| 1 - Foundation                          | complete    | Closed 2026-05-20; health/auth smoke.      |
| 2 - Storage / import / assets / backups | complete    | Closed 2026-05-20; server routes + Docker. |
| 3 - Proxy migration                     | not started | Unblocked; next server slice.              |
| 4 - sendChat tests                      | not started | Can start now, parallel with 3.            |
| 5 - sendChat extraction                 | not started | Blocked on Phase 4.                        |
| 6 - Server-side generation              | not started | Blocked on Phases 3 + 5.                   |
| 7 - Server-side prompt assembly         | not started | Blocked on Phase 6.                        |
| 8 - Hypa V3 memory server-side          | not started | Blocked on Phase 2 + Phase 7.              |
| 9 - Client thinning                     | not started | Blocked on all of the above.               |

## Workstreams

- **Removals.** Captured in [`removals.md`](removals.md). Feature
  removal is complete; a couple of stale, unreachable group-chat UI
  checks remain documented as cleanup debt.
- **Server.** Captured in [`server.md`](server.md). Phase 1 and
  server-side Phase 2 Fastify code exists; Docker now runs Fastify.
  Express remains in-tree for `pnpm runserver` and unported proxy /
  hub / legacy file-storage routes until Phase 3.
- **sendChat.** Captured in [`sendchat.md`](sendchat.md). The
  function is currently 2090 lines, no characterization tests.

## Reference state

The `move-to-fastify` branch (68 commits ahead of `main`) is a
worked example of Phases 1-6 in one push. It is reference, not
plan: this roadmap reshapes the API surface (no whole-state PUT,
no group-chat commands, simpler memory tables) and sequences
removals first.
