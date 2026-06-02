# Command Mutation-Range Narrowing Plan

Date: 2026-06-03

## Goal

Narrow every command route in `server/fastify/src/routes/commands.ts` so the
state it physically writes (and the projection it re-ships on refresh) matches
the state it logically changes, without weakening the `baseRevision`, single
revision-bump, single command-event, transaction-ordering, or projection
contracts.

End state:

- A command that changes one settings scalar issues one `UPDATE settings`.
- A command that changes one character row, one chat row, or one element of one
  collection writes only that row (plus the settings row when a pointer scalar
  genuinely moved), never every character row and all nine collection tables.
- Key-addressable plugin custom storage writes touch only `plugin_custom_storage`.
- Narrowed mutations have matching narrow projection resources where a foreign or
  recovery refresh would otherwise re-ship whole arrays, and the pre-existing
  projection-field bugs are corrected.
- Routes whose deeper narrowing is genuinely blocked (cross-table spans,
  load-bearing message or normalization dependencies) sit at the safe
  `message-free` floor with the blocker and unblock condition recorded.
- Every new narrow path has a `dbJsonWriteMs: 0` metric review gate and a
  rowid-stability regression test proving unrelated rows are not rewritten.

## Boundary Sources

- [`../mutation-range-mismatch.md`](mutation-range-mismatch.md) seeded the
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

The JSON `database` is split across SQLite tables: a single `settings` row holds
every non-collection, non-character top-level key (pointers and scalars such as
`characterOrder`, `currentChar`, `botPresetsId`, `selectedPersona`,
`enabledModules`, `currentPluginProvider`, `loreBookPage`, `translatorPreset*`,
`lastLoadedLoadoutName`); `characters` holds one row per character; `chats` holds
one row per chat; nine position-keyed collection tables hold `modules`, `plugins`,
`botPresets`, `promptTemplate`, `personas`, `loadouts`, `loreBook`,
`translatorPresets`, and `hypaV3Presets`; `plugin_custom_storage` is a standalone
key/value table; and the message store holds `chats[].message[]`, `hypaV3Data`,
and alternates with surgical writers.

The four mutation helpers in `server/fastify/src/commands/mutations.ts`:

| Helper | `mutationPath` | Physically writes |
| --- | --- | --- |
| `applyJsonCommandMutation` | `hydrated` | loads ALL chat messages, then surgical `syncChatMessages` plus a rewrite of ALL characters, ALL chats, ALL nine collection tables, and settings |
| `applyMessageFreeJsonCommandMutation` | `message-free` | no message load, but still rewrites ALL characters, ALL chats, ALL nine collection tables, and settings |
| `applyTargetedCommandMutation` | custom | loads message-free `db.json` for validation only; callback does its own targeted SQLite writes; runs the broad `replaceAll*` only if `writeDatabase: true` (default off) |
| `applyCharacterSelectionCommandMutation` | `targeted-character-selection` | bespoke: writes exactly one character row plus the settings row — the reference fix |

Of 79 routes, 8 are already minimal (the six targeted message commands,
`characters/select`, and the first-run `state/initialize` seed). The other 71
share the exact shape `b57df5cd` fixed — 66 on `hydrated`, 5 on `message-free`,
each rewriting characters plus nine collection tables plus settings for a sub-row
change. Post-verification severity is 51 high, 18 medium, 3 low.

## Prerequisites

These cross-cutting prerequisites (from the audit's adversarial verifier) keep
the fixes faithful rather than "looks narrow but drops data," and are realized in
Phase 0 before any Tier write is narrowed.

1. **The targeted writers do not exist yet.** `repository.ts` has only
   `writeCharacterSelectionRows` plus the broad `replaceAll*` and the surgical
   message-store writers. A small writer kit is required: `writeSettingsOnly`,
   `writeSingleCharacterRow`, `writeSingleChatRow`, `writeSingleCollectionTable`
   / `writeSingleCollectionRow`, and `writePluginStorageKey` /
   `deletePluginStorageKey`.
2. **Whole-collection normalization is a deliberate dropped write.** Many
   `mutate` callbacks open with a repair pass that re-IDs duplicate ids,
   default-fills, or clamps pointers across sibling rows. The broad path
   opportunistically persists those repairs for every row; a targeted write
   computes them and discards them. This is the same tradeoff `b57df5cd` already
   accepted and is data-safe under the project posture (no users, no migrations,
   dirty-backup data acceptable). Each targeted path re-normalizes only its own
   target row and treats global de-dup as validate-only.
3. **"Single-X" usually means one row plus the settings row.** Normalization
   commonly writes a settings scalar alongside the row edit (`characterOrder` /
   `currentChar` on character create/trash, `lastLoadedLoadoutName` on loadout
   edits, the collection's pointer clamp on preset/persona/translator edits). The
   targeted writer conditionally `UPDATE settings` only when that scalar actually
   changed, exactly as `writeCharacterSelectionRows` writes both rows.
4. **The universal cheap floor: drop `hydrated` to `message-free`.** 64 of the
   66 `applyJsonCommandMutation` routes never read or write `chat.message[]`, so
   `loadPersistedWithMessages` plus `syncChatMessages` is pure waste (the sync is
   a guaranteed no-op). Swapping those routes to
   `applyMessageFreeJsonCommandMutation` is mechanical, helper-free, and
   correctness-risk-free; it is a stopgap, not the fix, because it still rewrites
   all characters plus nine collection tables plus settings.

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
| [0. Baseline Foundations](phases/phase-0-baseline-foundations.md) | Build the targeted writer kit, the targeted mutation paths, the mutation-range metric + review gates, and the normalization-scope policy that every later tier depends on. |
| [1. Message-Free Floor](phases/phase-1-message-free-floor.md) | Mechanically swap the ~62 non-message `hydrated` routes to `message-free` (Prerequisite 4) — the safe, helper-free first commit. |
| [2. Settings And Plugin-Storage Paths](phases/phase-2-settings-and-plugin-storage-paths.md) | Narrow Tier-1 pure-settings/pointer writes to `UPDATE settings` and Tier-2 plugin custom storage to single-key writes. |
| [3. Single Row Paths](phases/phase-3-single-row-paths.md) | Narrow Tier-3 single character-row and single chat-row metadata edits to one-row writes. |
| [4. Collection-Table Paths](phases/phase-4-collection-table-paths.md) | Narrow Tier-4 edits from all nine collection tables to one table (single-row or one-table rewrite), with pointer-settings co-writes. |
| [5. Projection-Range Narrowing](phases/phase-5-projection-range-narrowing.md) | Add narrow projection resources for the narrowed writes, split the broad `lorebook` resource, and fix the pre-existing projection-field bugs. |
| [6. Message-Free Ceiling](phases/phase-6-message-free-ceiling.md) | Keep Tier-5 routes at the `message-free` floor where deeper narrowing is genuinely blocked, recording each blocker and unblock condition. |
| [7. Verification Budgets](phases/phase-7-verification-budgets.md) | Turn written-table-set, rowid-stability, and `dbJsonWriteMs: 0` checks into maintained gates and keep the latest verification log. |

## Suggested Execution Order

1. Capture the Phase 0 mutation-range metric baseline for the 71 over-broad
   routes against the existing message-heavy harness, and land the
   rowid-stability / `dbJsonWriteMs: 0` review-gate template. This proves the
   before-state.
2. Land the Phase 1 mechanical floor next; it depends on no new helper and
   removes the all-messages load and chat-row rewrite from ~62 routes with zero
   correctness risk. (Skip the genuinely message-dependent routes: 2390, 2495,
   2617, 2655, and the message commands.)
3. Finish the rest of Phase 0 (writer kit, targeted mutation paths,
   normalization-scope policy); Phases 2-5 depend on it.
4. Phase 2 first among the write tiers — highest amplification, cleanest fix,
   projection already safe or sprawling-by-design.
5. Phase 3, landing the matching Phase 5 character/chat projection branches in
   the same batches.
6. Phase 4 (plugins family first — projection already narrow, lowest risk), then
   the remaining families with their pointer-settings co-writes and the
   Phase 5 collection-projection and field-bug co-fixes.
7. The Phase 5 `lorebook` resource split once a global-lorebook command is
   narrowed.
8. Defer Phase 6 deeper narrowing until the relevant normalization passes are
   scoped to validate-only; until then leave those routes at the floor.
9. Keep Phase 7 gates and [`latest-verification.md`](latest-verification.md)
   current as each tier lands.

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
