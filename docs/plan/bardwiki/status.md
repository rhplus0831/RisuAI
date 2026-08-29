# BardWiki Memory Status

Date: 2026-08-29

The workstream is open. Phase 0 is complete; no BardWiki runtime, schema, route,
prompt, worker, or UI implementation has started. Phase 1 is current.

## Snapshot

- Plan state: implementation contract locked; runtime implementation not started.
- Current phase: Phase 1, schema/repository slice pending.
- Current implementation cursor: add schema migration, constraints, row types,
  and focused low-level repository tests from [`CONTRACT.md`](CONTRACT.md).
- Blockers: none.
- Runtime changes in this workstream: none.
- Validation: Phase 0 Prettier contract check passed on 2026-08-29.
- Phase 0 commit: the contract/status commit that records this completion.
- Residual risk: runtime feasibility is proven only by architecture inspection;
  every locked behavior still requires its owning implementation-phase tests.
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
| [1. Persistence and resources](phases/phase-1-persistence-and-resources.md) | Pending | SQLite schema, repositories, resources, commands, versions, sources, links, and backup ownership land. |
| [2. Settings and workspace](phases/phase-2-settings-and-workspace.md) | Pending | Global BardWiki settings and a chat-scoped manual document workspace are usable. |
| [3. Prompt retrieval](phases/phase-3-prompt-retrieval.md) | Pending | Committed documents are selected and injected deterministically under budget. |
| [4. Jobs and explicit confirmation](phases/phase-4-jobs-and-explicit-confirmation.md) | Pending | Separate durable worker execution and explicit event-document generation are reliable. |
| [5. Automatic and canonical updates](phases/phase-5-automatic-and-canonical-updates.md) | Pending | Prior-turn automatic confirmation, canonical patches, and stale reconciliation land. |
| [6. Lifecycle and interchange](phases/phase-6-lifecycle-and-interchange.md) | Pending | Edit/delete/fork/import/export/restore/rebuild and operational edges are complete. |
| [7. Verification and closeout](phases/phase-7-verification-and-closeout.md) | Pending | Full regression, recovery, performance, browser, docs, and rollout proof closes the workstream. |

## Next Action

Execute Phase 1, slice 1 only: implement the locked schema migration,
constraints, row types, low-level repository, and focused repository tests.
Do not register production routes until that slice passes.

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
