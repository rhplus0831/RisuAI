# Status Overview

Date: 2026-05-20

Concise snapshot of where each workstream stands. Detail per
workstream lives in the sibling shards.

## Phase progress

| Phase                           | Status      | Notes                                  |
| ------------------------------- | ----------- | -------------------------------------- |
| 0 - Removals                    | not started | Active phase. Inventory is captured.   |
| 1 - Foundation                  | not started | Blocked on Phase 0.                    |
| 2 - Storage / import / export   | not started | Blocked on Phase 1.                    |
| 3 - Proxy migration             | not started | Blocked on Phase 1.                    |
| 4 - sendChat tests              | not started | Can start in parallel with Phases 1-3. |
| 5 - sendChat extraction         | not started | Blocked on Phase 4.                    |
| 6 - Server-side generation      | not started | Blocked on Phases 3 + 5.               |
| 7 - Server-side prompt assembly | not started | Blocked on Phase 6.                    |
| 8 - Hypa V3 memory server-side  | not started | Blocked on Phase 2 + Phase 7.          |
| 9 - Client thinning             | not started | Blocked on all of the above.           |

## Workstreams

- **Removals.** Captured in [`removals.md`](removals.md). Nothing
  has been deleted yet.
- **Server foundation.** Captured in [`server.md`](server.md). No
  Fastify code exists.
- **sendChat.** Captured in [`sendchat.md`](sendchat.md). The
  function is currently 2245 lines, no characterization tests.

## Reference state

The `move-to-fastify` branch (68 commits ahead of `main`) is a
worked example of Phases 1-6 in one push. It is reference, not
plan: this roadmap reshapes the API surface (no whole-state PUT,
no group-chat commands, simpler memory tables) and sequences
removals first.
