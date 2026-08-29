# BardWiki Memory Status

Date: 2026-08-29

The workstream is open. Phases 0-1 are complete and Phase 2 is current.
BardWiki persistence, manual commands, targeted resources, and backup recovery
are implemented; prompt, worker, and UI behavior has not started.

## Snapshot

- Plan state: runtime implementation in progress.
- Current phase: Phase 2, no slices complete.
- Current implementation cursor: add canonical global settings keys/defaults
  and the lazy fifth Memory settings tab.
- Blockers: none.
- Runtime changes in this workstream: schema v33, low-level repository,
  revisioned settings/manual-document commands, shared wire schemas, targeted
  ETag reads, resident browser resource invalidation, exhaustive backup
  ownership, and transactional derived-projection repair.
- Validation: Phase 0 Prettier contract check passed on 2026-08-29.
- Phase 0 commit: the contract/status commit that records this completion.
- Phase 1 slice 3 validation: protocol/invalidation passed 2 files, 103 tests;
  repository/routes/protection passed 3 files, 35 tests; all server-facing
  typechecks passed on 2026-08-29.
- Phase 1 slice 4 validation: repository/backup passed 2 files, 63 tests;
  server-facing typechecks passed on 2026-08-29.
- Residual risk: no end-user settings or workspace surface exists until Phase 2.
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
| [0. Contract and architecture](phases/phase-0-contract-and-architecture.md) | Complete | Exact types, states, routes, events, inheritance, errors, and test matrix are locked in [`CONTRACT.md`](CONTRACT.md). |
| [1. Persistence and resources](phases/phase-1-persistence-and-resources.md) | Complete | Authoritative persistence, manual commands/resources, cascade lifecycle, and backup/restore recovery are proven. |
| [2. Settings and workspace](phases/phase-2-settings-and-workspace.md) | In progress (0/4) | Global BardWiki settings and a chat-scoped manual document workspace are usable. |
| [3. Prompt retrieval](phases/phase-3-prompt-retrieval.md) | Pending | Committed documents are selected and injected deterministically under budget. |
| [4. Jobs and explicit confirmation](phases/phase-4-jobs-and-explicit-confirmation.md) | Pending | Separate durable worker execution and explicit event-document generation are reliable. |
| [5. Automatic and canonical updates](phases/phase-5-automatic-and-canonical-updates.md) | Pending | Prior-turn automatic confirmation, canonical patches, and stale reconciliation land. |
| [6. Lifecycle and interchange](phases/phase-6-lifecycle-and-interchange.md) | Pending | Edit/delete/fork/import/export/restore/rebuild and operational edges are complete. |
| [7. Verification and closeout](phases/phase-7-verification-and-closeout.md) | Pending | Full regression, recovery, performance, browser, docs, and rollout proof closes the workstream. |

## Next Action

Execute Phase 2, slice 1: add global memory-group settings ownership/defaults,
parity coverage, and the lazy fifth Memory settings tab.

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
