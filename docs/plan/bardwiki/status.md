# BardWiki Memory Status

Date: 2026-08-29

The workstream is open. Phases 0-3 are complete and Phase 4 is current.
BardWiki persistence, manual commands, targeted resources, backup recovery,
global settings, and the chat-scoped manual workspace are implemented; prompt
retrieval are implemented; the isolated durable BardWiki worker lane and its
operational controls are implemented.

## Snapshot

- Plan state: runtime implementation in progress.
- Current phase: Phase 4, four of five slices complete.
- Current implementation cursor: expose receipt/job status and retry/cancel
  controls in the chat workspace, including terminal error presentation.
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
- Phase 2 slice 1 validation: settings/localization/manifest passed 4 files,
  77 tests; defaults/parity/routes passed 3 files, 35 tests; server-facing
  typechecks passed on 2026-08-29.
- Phase 2 slice 2 validation: focused workspace/lazy/manifest/localization
  passed 4 files, 59 tests; overflow-menu regression passed; Svelte diagnostics
  passed 6,627 files with zero errors or warnings on 2026-08-29.
- Phase 2 slice 3 validation: workspace passed 7 tests; durable bridge/command
  adapters passed 4 focused tests; all 120 durable route allowlist cases and 6
  server BardWiki route tests passed on 2026-08-29.
- Phase 2 slice 4 validation: UI regressions passed 8 files, 268 tests; server
  settings/commands/routes passed 3 files, 237 tests; the complete durable
  allowlist passed 229 tests; Svelte and server-facing typechecks passed; the
  production browser build and all 37 Playwright smoke tests passed on
  2026-08-29.
- Phase 3 slices 1-2 validation: repository/selector passed 20 tests; prompt,
  memory/template, routes, and assembly passed 6 files, 229 tests; generation
  and allocation passed 2 files, 181 tests; all server-facing typechecks passed
  on 2026-08-29.
- Phase 3 slice 3 validation: selector/adapter/assembly/memory/template/
  generation/allocation passed 7 files, 408 tests; a representative 2,000-doc
  corpus remained bounded to 512 candidates and 32 selected rows in 8.53 ms on
  2026-08-29.
- Phase 3 slice 4 validation: all server-facing typechecks, the production
  browser build, and all 37 Playwright smoke tests passed on 2026-08-29.
- Phase 4 slices 1-2 validation: BardWiki repository/worker/job-route coverage
  passed 10 tests; Hypa route/protection compatibility passed 26 tests; the
  existing 23-test Hypa worker suite passed independently; all server-facing
  typechecks passed on 2026-08-29.
- Phase 4 slice 3 validation: explicit confirmation plus job/command regressions
  passed 238 server tests; the durable browser command and full outbox
  allowlist passed 234 tests; all server-facing typechecks passed on
  2026-08-29.
- Phase 4 slice 4 validation: event schema, analysis/repair, atomic commit,
  crash/replay, prompt retrieval, isolated BardWiki/Hypa worker, and status
  route coverage passed 8 files and 63 tests; all server-facing typechecks
  passed on 2026-08-29.
- Residual risk: Phase 4 must isolate BardWiki job claiming, recovery, abort,
  and retention from the existing Hypa lane while making event commits exactly
  once across crashes.
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
| [2. Settings and workspace](phases/phase-2-settings-and-workspace.md) | Complete | Global/per-chat settings and conflict-safe durable manual document editing are usable. |
| [3. Prompt retrieval](phases/phase-3-prompt-retrieval.md) | Complete | Committed documents are selected and injected deterministically under budget. |
| [4. Jobs and explicit confirmation](phases/phase-4-jobs-and-explicit-confirmation.md) | In progress (4/5) | Separate durable worker execution and explicit event-document generation are reliable. |
| [5. Automatic and canonical updates](phases/phase-5-automatic-and-canonical-updates.md) | Pending | Prior-turn automatic confirmation, canonical patches, and stale reconciliation land. |
| [6. Lifecycle and interchange](phases/phase-6-lifecycle-and-interchange.md) | Pending | Edit/delete/fork/import/export/restore/rebuild and operational edges are complete. |
| [7. Verification and closeout](phases/phase-7-verification-and-closeout.md) | Pending | Full regression, recovery, performance, browser, docs, and rollout proof closes the workstream. |

## Next Action

Execute Phase 4 slice 5: add receipt/job status, retry/cancel controls, and
clear retryable/terminal errors to the targeted chat workspace, then close the
phase with the full owning regression matrix.

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
