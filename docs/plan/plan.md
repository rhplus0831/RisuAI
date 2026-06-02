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
- [`../structure/server-projection-and-bridges.md`](../structure/server-projection-and-bridges.md)
  and [`../structure/data-and-events.md`](../structure/data-and-events.md) own
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

Of 79 routes, 8 are already minimal (the six targeted message commands,
`characters/select`, and the first-run `state/initialize` seed). The other 71
share the exact shape `b57df5cd` fixed — 66 on `hydrated`, 5 on `message-free`,
each rewriting characters plus nine collection tables plus settings for a sub-row
change. Post-verification severity is 51 high, 18 medium, 3 low.

## Prerequisites

Phase 0 handles these prerequisites before any tier write is narrowed.

1. Build the writer kit. `repository.ts` has only `writeCharacterSelectionRows`,
   broad `replaceAll*`, and surgical message-store writers. Add
   `writeSettingsOnly`, `writeSingleCharacterRow`, `writeSingleChatRow`,
   `writeSingleCollectionTable` / `writeSingleCollectionRow`,
   `writePluginStorageKey`, and `deletePluginStorageKey`.
2. Treat global normalization as validate-only. Broad paths persist sibling-row
   repairs; targeted paths compute those repairs for validation, then write only
   the target row. This matches `b57df5cd` and is acceptable here because there
   are no users, no migrations, and backup data may be lost.
3. Co-write settings when a pointer moved. Many row edits also touch settings
   (`characterOrder`, `currentChar`, `lastLoadedLoadoutName`, preset/persona/
   translator pointers). Targeted writers update settings only when the scalar
   actually changed.
4. Use `message-free` as the cheap floor. Most `hydrated` routes never touch
   `chat.message[]`, so the message load and `syncChatMessages` no-op can go.
   This is mechanical and safe, but it is only a stopgap because it still rewrites
   characters, collections, and settings.

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

## Suggested Execution Order

1. Capture the Phase 0 metric baseline and land the reusable
   rowid-stability / `dbJsonWriteMs: 0` gate.
2. Land the Phase 1 floor. Skip the message-dependent routes: 2390, 2495, 2617,
   2655, and the message commands.
3. Finish Phase 0: writer kit, targeted mutation paths, normalization policy.
4. Do Phase 2 first among write tiers: highest amplification, cleanest fix.
5. Do Phase 3 with its matching Phase 5 character/chat projections.
6. Do Phase 4, plugins first, then the other families with pointer co-writes and
   projection-field fixes.
7. Split the Phase 5 `lorebook` resource after a global-lorebook command is
   narrowed.
8. Leave Phase 6 routes at the floor until their normalization/message blockers
   are scoped.
9. Keep Phase 7 gates and [`latest-verification.md`](latest-verification.md)
   current as tiers land.

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
