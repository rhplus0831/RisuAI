# Slice: Draft Mirror Gating

Phase: [6](../../phase-6-reactive-amplification-and-render.md). Finding:
L22. Client character draft performance change.

## Scope

Gate the character-editor draft mirror so local draft keystrokes do not
re-run the server-seed effect's pick, clone, normalize, and double stringify
work.

This slice owns `createServerBackedCharacterDraft` in
`characterBridge.svelte.ts`. It does not change character command patch
sanitization, trusted projection writes, rollback behavior, debounce timing,
or the set of character fields the editor owns.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L22 and I19 context.
- `src/ts/server/characterBridge.svelte.ts`:
  `createServerBackedCharacterDraft`, `pickCharacterFields`,
  `normalizeCharacterDraft`, `snapshotJson`, `cloneJsonValue`,
  `sanitizeCharacterPatch`, and `watchServerBackedCharacterProfile`.
- `src/ts/server/projectionWriteGuard.svelte.ts`:
  `getServerProjectionApplyEpoch` and trusted write/apply epoch semantics.
- `src/ts/characterCommands.ts`: command and rollback helpers.
- Focused test: `src/ts/server/characterBridge.svelte.test.ts`.

## Target Shape

- Split the draft mirror into separate concerns:
  a server-seed effect keyed by selected character / character id /
  projection-apply epoch, and a local-draft dispatch effect keyed by
  `draft.value`.
- The seed effect should not deep-read `draft.value` as part of its normal
  dependency set. Use stored snapshots or untracked reads where a comparison
  with local draft state is unavoidable.
- Re-seed the draft when the selected character changes, the selected
  character id changes, or a real server projection apply advances the epoch.
- Do not re-seed merely because the user typed into the local draft and the
  dispatch effect applied an optimistic trusted write.
- Keep the existing conflict-safe comparison:
  a server push should replace the draft when the server snapshot changes and
  no longer matches the current draft, while local unsent edits should not be
  clobbered by their own optimistic mirror write.
- Preserve `previousServerSnapshot` or an equivalent baseline so local
  command dispatch continues to avoid redundant self-reconciliation.
- Register L22 as `DONE` in the v3 gate and flip only the L22 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).

## Invariants

- Character editor fields, default normalization, and excluded command patch
  keys are unchanged.
- A character switch must always show the newly selected character's current
  server-backed values.
- A server projection apply must still refresh stale draft values.
- Local keystrokes still dispatch through the existing trusted-write and
  command path.
- The fix must not suppress rollback restoration or pending patch cleanup.

## Done Criteria

- A focused test proves editing nested draft fields does not re-run the seed
  pick/clone/stringify path.
- A character switch still re-seeds the draft.
- A server projection apply with changed character fields still re-seeds the
  draft.
- Local draft edits still produce sanitized character patches and optimistic
  projection updates.
- L22 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/server/characterBridge.svelte.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
