# Normalization-Scope Policy

Status: planned. Codifies Prerequisites 2 and 3 as a written contract.

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Prerequisites 2 and 3.
- `server/fastify/src/routes/commands.ts` - the `ensure*`/`normalize*` repair
  passes at the head of many `mutate` callbacks (`ensureCharacterCollection`,
  `normalizeAllCharacterChats`, `ensureModuleCollection`/`ensureModuleRecords`,
  `ensureLorebookDatabase` → `ensureAllChildLorebooks`,
  `normalizeScriptDefinitionDatabase`, the various `ensure*Collection`).
- `server/fastify/src/repository.ts` - `writeCharacterSelectionRows` /
  `loadCharacterSelectionRows` (the reference's validate-only precedent).

## Scope

This is a policy slice, not runtime code. It writes the contract every targeted
path must follow so narrowing stays faithful rather than "looks narrow but drops
data," and provides one shared assertion helper.

Prerequisite 2 — global de-dup is validate-only. Many `mutate` callbacks open
with a repair pass that mutates sibling/other rows in place (re-IDs duplicate ids
via `randomUUID()`, default-fills, clamps pointers). The broad path
opportunistically persists those repairs for every row; a targeted path computes
them for validation and discards the sibling-row writes. This is the same
tradeoff `b57df5cd` accepted (`loadCharacterSelectionRows` reads one raw row and
skips normalization) and is data-safe under the project posture (no users, no
migrations, dirty-backup data acceptable). Each targeted path still re-normalizes
its own target row.

Prerequisite 3 — "single-X" usually means one row plus the settings row.
Normalization commonly writes a settings scalar alongside the row edit
(`characterOrder`/`currentChar` on character create/trash; `lastLoadedLoadoutName`
on loadout edits; the collection's pointer clamp on preset/persona/translator
edits). The targeted writer conditionally `UPDATE settings` only when that scalar
actually changed, exactly as `writeCharacterSelectionRows` writes both rows.

## Implementation Scope

- Deliverable: this written policy, linked from every tier phase, plus a shared
  test helper `assertOnlyRowsWritten(before, after, expectedChangedIds)` built on
  `tableRowidsById` that fails if any unrelated character/chat/collection row was
  rewritten.
- Each tier slice records, per route, which global normalization it drops to
  validate-only and which settings scalar it conditionally co-writes.
- Non-scope: scoping the normalization passes themselves into reusable
  validate-only helpers — that is the Phase 6 unblock prerequisite, not part of
  the write-range narrowing.

## Protocol Behavior

- A targeted path never silently drops a write a reader still depends on (orphan
  message cleanup, a pointer clamp a client reads, a referenced-id strip); those
  cases are not "global de-dup" and belong in Phase 6 if they block a per-row
  write.
- A dropped sibling-row repair must be an explicit, recorded decision in the
  route's slice, not an accident.

## Done When

- The policy is written and linked from Phases 2-4.
- `assertOnlyRowsWritten` exists and is used by at least one tier's first slice.
- Each tier phase's exit criteria reference the validate-only and settings
  co-write decisions.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `pnpm api:test`
