# BardWiki Memory Status

Date: 2026-08-29

The workstream is planned and open. No BardWiki runtime, schema, route, prompt,
worker, or UI implementation has started. Phase 0 is the next phase.

## Snapshot

- Plan state: planning complete; implementation not started.
- Current phase: Phase 0, pending.
- Current implementation cursor: lock exact contracts before creating schema or
  runtime code.
- Blockers: none.
- Runtime changes in this workstream: none.
- Verification runs for implementation: none required yet; planning files only.
- Source investigation: complete for RisuBard semantics and the local settings,
  finalization, jobs/events, storage/API, and prompt-retrieval boundaries.

## Locked Decisions

- SQLite is authoritative; Markdown vaults are import/export only.
- Global configuration lives in a BardWiki tab under the existing Memory page.
- The document workspace is scoped to the active chat.
- A newly generated assistant is a candidate, not immediately confirmed memory.
- Automatic confirmation processes the preceding assistant after a later
  successful `send`; regenerate/continue do not confirm the current assistant.
- Explicit confirmation is available as a server command.
- Manual documents and deterministic retrieval precede autonomous writes.
- Explicit confirmation initially generates event documents only.
- Canonical updates are atomic, versioned, provenance-backed, and added later.
- Prompt-time retrieval is deterministic and provider-free.
- Hypa and BardWiki background work use separate execution lanes.
- Existing chats are not silently backfilled.

## Phase Router

| Phase | Status | Outcome |
| --- | --- | --- |
| [0. Contract and architecture](phases/phase-0-contract-and-architecture.md) | Pending | Exact types, states, routes, events, inheritance, errors, and test matrix are locked. |
| [1. Persistence and resources](phases/phase-1-persistence-and-resources.md) | Pending | SQLite schema, repositories, resources, commands, versions, sources, links, and backup ownership land. |
| [2. Settings and workspace](phases/phase-2-settings-and-workspace.md) | Pending | Global BardWiki settings and a chat-scoped manual document workspace are usable. |
| [3. Prompt retrieval](phases/phase-3-prompt-retrieval.md) | Pending | Committed documents are selected and injected deterministically under budget. |
| [4. Jobs and explicit confirmation](phases/phase-4-jobs-and-explicit-confirmation.md) | Pending | Separate durable worker execution and explicit event-document generation are reliable. |
| [5. Automatic and canonical updates](phases/phase-5-automatic-and-canonical-updates.md) | Pending | Prior-turn automatic confirmation, canonical patches, and stale reconciliation land. |
| [6. Lifecycle and interchange](phases/phase-6-lifecycle-and-interchange.md) | Pending | Edit/delete/fork/import/export/restore/rebuild and operational edges are complete. |
| [7. Verification and closeout](phases/phase-7-verification-and-closeout.md) | Pending | Full regression, recovery, performance, browser, docs, and rollout proof closes the workstream. |

## Next Action

Execute Phase 0 only:

1. Resolve the exact shared type and wire names.
2. Lock settings inheritance and initial defaults.
3. Lock receipt/job/document state machines and error codes.
4. Lock command/read/event/resource contracts.
5. Lock the confirmation source-selection algorithm against send, continue,
   regenerate, explicit confirmation, edits, deletes, and replay.
6. Record the final contract and focused test fixtures in the Phase 0 file.

Do not create SQLite tables or production routes until those decisions are
recorded and Phase 0 exit criteria are met.

## Maintenance Rules

- This file is the only live phase router.
- Update it when a slice lands, a validation command runs, or a risk/blocker
  changes.
- Keep cross-phase product and architecture decisions in [`PLAN.md`](PLAN.md).
- Keep implementation details and exit proof in the owning phase file.
- Do not mark a phase complete while tests are failing or an unrecorded
  correctness gap remains.
- Any UI phase adds strings under `src/lang`.
- Any route phase updates `server/fastify/src/routeManifest.ts` and protection
  coverage.
- Any durable table phase updates backup ownership/parity coverage.
