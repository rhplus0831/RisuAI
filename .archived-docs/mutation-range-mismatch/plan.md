# Command Mutation-Range Narrowing Plan

Date: 2026-06-03

## Goal

Narrow each command route in `server/fastify/src/routes/commands.ts` so its
physical writes, and any refresh projection, match the state it logically
changes. Preserve `baseRevision`, the single revision bump, the single command
event, transaction ordering, and projection contracts.

End state:

- Settings-scalar commands issue one `UPDATE settings`.
- Single character, chat, or collection-row commands write only that row, plus
  settings when a pointer scalar moved.
- Plugin custom storage writes touch only `plugin_custom_storage`.
- Narrow writes have matching narrow projection resources when broad refreshes
  would otherwise re-ship whole arrays.
- Existing projection-field bugs are fixed.
- Blocked routes stay at the `message-free` floor with the blocker and unblock
  condition recorded.
- Every new narrow path has a `dbJsonWriteMs: 0` metric gate and a
  rowid-stability regression test.

## Boundary Sources

- [`mutation-range-mismatch.md`](mutation-range-mismatch.md) seeded the
  route inventory, per-tier findings, severity, and prerequisites for this plan;
  [`status.md`](status.md) records which items have since closed.
- `server/fastify/src/routes/commands.ts` owns the 79 command routes and which
  mutation helper each currently uses.
- `server/fastify/src/commands/mutations.ts` owns the four mutation helpers and
  their `mutationPath` labels.
- `server/fastify/src/repository.ts` owns the SQLite table writers, the broad
  `replaceAll*` writers, and the reference `writeCharacterSelectionRows`.
- `server/fastify/src/routes/projection.ts` owns `RESOURCE_PROJECTION_FIELDS`
  and the per-resource projection loaders.
- [`../../structure/server-projection-and-bridges.md`](../../docs/structure/server-projection-and-bridges.md)
  and [`../../structure/data-and-events.md`](../../docs/structure/data-and-events.md) own
  projection, hydration, revision, event, and active-writer references.
- The codebase remains the source of truth when docs drift.

## Current Baseline

The JSON `database` is split across SQLite tables:

- `settings`: one row for non-collection, non-character top-level keys
  (`characterOrder`, `currentChar`, `botPresetsId`, `selectedPersona`,
  `enabledModules`, `currentPluginProvider`, `loreBookPage`,
  `translatorPreset*`, `lastLoadedLoadoutName`, etc.).
- `characters`: one row per character.
- `chats`: one row per chat.
- Nine position-keyed collection tables: `modules`, `plugins`, `botPresets`,
  `promptTemplate`, `personas`, `loadouts`, `loreBook`, `translatorPresets`,
  `hypaV3Presets`.
- `plugin_custom_storage`: standalone key/value table.
- Message store: `chats[].message[]`, `hypaV3Data`, and alternates, already with
  surgical writers.

The four mutation helpers in `server/fastify/src/commands/mutations.ts`:

| Helper | `mutationPath` | Physically writes |
| --- | --- | --- |
| `applyJsonCommandMutation` | `hydrated` | loads all chat messages, then surgical `syncChatMessages` plus a rewrite of all characters, chats, nine collection tables, and settings |
| `applyMessageFreeJsonCommandMutation` | `message-free` | no message load, but still rewrites all characters, chats, nine collection tables, and settings |
| `applyTargetedCommandMutation` | custom | loads message-free `db.json` for validation only; callback does its own targeted SQLite writes; runs the broad `replaceAll*` only if `writeDatabase: true` (default off) |
| `applyCharacterSelectionCommandMutation` | `targeted-character-selection` | bespoke: writes exactly one character row plus the settings row — the reference fix |

At the seed audit, 8 of 79 routes were already minimal and 71 were over-broad
(51 high, 18 medium, 3 low). That before-state is preserved in
[`mutation-range-mismatch.md`](mutation-range-mismatch.md). Current runtime
status lives in [`status.md`](status.md): Phases 0-6 have landed, the narrowed
write paths use the Phase 0 targeted vehicles and gates, and the remaining broad
floor is Tier 5 — held at its verified safe floor (Phase 6), with deeper
narrowing deferred behind recorded unblock prerequisites.

## Prerequisites

Phase 0 landed the shared prerequisites before tier writes were narrowed:

1. Writer kit: settings, single character row, single chat row, collection table
   / row, plugin-storage key, and related targeted writers.
2. Normalization policy: targeted paths may compute sibling repairs for
   validation, then persist only the scoped target unless a slice records a
   required co-write.
3. Settings co-write rule: pointer/mirror scalars are updated only when they
   actually changed.
4. `message-free` floor: safe non-message routes can avoid all-message hydration,
   but this remains a stopgap for routes that can narrow further.

## Invariants

- Preserve `baseRevision` conflict behavior and one revision bump per committed
  projected mutation.
- Persist exactly one replayable command event for every revision-tracked
  projected mutation; never emit more than one event per revision bump.
- Preserve `BEGIN IMMEDIATE` serialization (or document an equivalent durability
  rule) before introducing a narrow write path.
- Write `db.json` only after the SQLite revision/event rows commit, so the next
  bootstrap or resync never observes JSON ahead of the durable rows.
- A targeted path re-normalizes only its target row and treats global
  normalization as validate-only (Prerequisite 2); it never silently drops a
  message row, an orphan cleanup, or a pointer clamp that the broad path
  performed and a reader still depends on.
- Narrowing a write never desyncs its projection: the foreign/recovery refresh
  reads SQLite fresh, so a narrowed write that leaves a broad projection is
  correct but incomplete, and a narrowed projection must ship every field the
  narrowed write changed.
- Keep route auth, route-manifest coverage, and active-writer classification
  unchanged.

## Phase Overview

| Phase | Goal |
| --- | --- |
| [0. Baseline Foundations](phases/phase-0-baseline-foundations.md) | Add the writer kit, targeted paths, metric gates, and normalization policy. |
| [1. Message-Free Floor](phases/phase-1-message-free-floor.md) | Swap safe non-message `hydrated` routes to `message-free`. |
| [2. Settings And Plugin-Storage Paths](phases/phase-2-settings-and-plugin-storage-paths.md) | Narrow settings and plugin-storage writes. |
| [3. Single Row Paths](phases/phase-3-single-row-paths.md) | Narrow single character-row and chat-row edits. |
| [4. Collection-Table Paths](phases/phase-4-collection-table-paths.md) | Narrow collection edits to one table plus needed settings. |
| [5. Projection-Range Narrowing](phases/phase-5-projection-range-narrowing.md) | Add narrow projection resources and fix projection-field bugs. |
| [6. Message-Free Ceiling](phases/phase-6-message-free-ceiling.md) | Record routes that stop at the `message-free` floor. |
| [7. Verification Budgets](phases/phase-7-verification-budgets.md) | Maintain written-table, rowid, and `dbJsonWriteMs: 0` gates. |

## Execution Cursor

Phases 0-6 are implemented. Phase 6 verified the nine Tier-5 routes at their safe
floor (`hydrated` where the message load is load-bearing — the two deletes' orphan
cleanup and chats-create's corpus-wide validation — else the `message-free`
broad-set floor) with each blocker + unblock condition recorded and proven by
`commandMessageFreeCeiling.test.ts`; the seed audit's `DELETE chats/:id` floor was
corrected to `hydrated`. The message-delete, message-validation, cross-table
reference, and normalization blockers stay deferred as gated unblock
prerequisites. Phase 7 is the next focus as ongoing verification maintenance; keep
[`latest-verification.md`](latest-verification.md) current after each focused or
full run.

For every targeted path: re-normalize the target row, treat global de-dup as
validate-only (Prerequisite 2), conditionally co-write settings (Prerequisite 3),
and add a regression test asserting unrelated rows are not rewritten (the
reference fix's `tableRowidsById` rowid-stability assertion is the template).

## Not In This Plan

- Replacing the command/event protocol or the bootstrap/projection/revision
  model with a new sync model.
- Scoping the global normalization passes themselves into validate-only helpers
  — that is the prerequisite that unblocks Phase 6, tracked there but not done as
  part of the write-range narrowing.
- Re-enabling browser-local persistence, multi-user isolation, or any widening of
  unsupported plugin, MCP, tool, or legacy generation behavior.
- Changing message-store, `hypaV3Data`, or alternate split-store semantics; the
  six message commands and `generation.persisted` are already targeted.
- Treating a `message-free` downgrade as the final fix for any route the audit
  marks reachable to a per-row write.
