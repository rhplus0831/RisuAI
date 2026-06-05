# Slice: Bridge Apply-Epoch Echo Guards

Phase: [6](../../phase-6-bridges-lifecycle-network.md). Findings: M11, M12.
Runtime change.

## Scope

Stop server-originated projection applies from being re-dispatched by the
lorebook and character-profile bridge watchers. This slice adds the missing
apply-epoch gates and covers the foreign character-lorebook apply path that
currently uses a trusted write without advancing the epoch.

This slice does not own broad bridge refactors, debounce timing changes, or
additional snapshot narrowing beyond what is needed for the echo guard.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M11 and M12.
- [`../../phase-6-bridges-lifecycle-network.md`](../../phase-6-bridges-lifecycle-network.md)
  planned shape and exit criteria.
- `src/ts/server/projectionWriteGuard.svelte.ts`:
  `getServerProjectionApplyEpoch`, `withServerProjectionApply`,
  `withTrustedServerProjectionWrite`.
- `src/ts/server/lorebookBridge.svelte.ts`:
  `watchServerBackedLorebooks`, `collectLorebookCollectionSnapshots`,
  `dispatchWatchedReplacement`, hydrated-character lorebook guards.
- `src/ts/server/characterBridge.svelte.ts`:
  `watchServerBackedCharacterProfile`, `queueCharacterPatch`,
  `scalarCharacterProfile`.
- `src/ts/storage/database.svelte.ts`:
  `hydrateServerCharacterLorebook`, `mergeServerProjectionCharacterRow`.
- `src/ts/bootstrap.ts`: `processServerCommandEvent` branches for
  `character-lorebook` and `character-row`.
- Precedent watchers:
  `src/ts/server/chatBridge.svelte.ts`,
  `src/ts/server/scriptDefinitionBridge.svelte.ts`, and
  `src/ts/server/settingsBridge.svelte.ts`.
- Existing lorebook tests:
  `src/ts/server/lorebookBridge.test.ts`,
  `src/ts/server/lorebookBridge.svelte.test.ts`.
- New focused character-profile test home:
  `src/ts/server/characterBridge.svelte.test.ts`.

## Target Shape

- Import and use `getServerProjectionApplyEpoch()` in
  `watchServerBackedLorebooks`.
- Store `previousProjectionApplyEpoch` next to the lorebook watcher's baseline
  snapshots. On the first fire, rollback-suppressed fire, or epoch-advanced
  fire, refresh `previousSnapshots` to the current collection snapshots and
  return without dispatching replacements.
- Import and use `getServerProjectionApplyEpoch()` in
  `watchServerBackedCharacterProfile` with the same baseline-refresh behavior.
  A foreign `character-row` merge should reset `previousProfileSnapshot`, not
  queue `dispatchUpdateCharacter`.
- Make the foreign `character-lorebook` event apply advance the projection
  epoch. Prefer a small explicit foreign-apply wrapper or option over changing
  all user-open lorebook hydration unless that broader behavior is proven safe.
- Keep local edits on both watchers unchanged: after initialization and with no
  epoch advance, a real local lorebook/profile edit still queues exactly the
  expected command.
- Add two-session style tests by simulating an epoch-bumping foreign apply while
  the watcher is mounted, then asserting no outbound command is queued. Add a
  matching local-edit assertion so the test cannot pass by disabling the
  watcher.
- Register M11 and M12 as `DONE` in the v2 gate with focused tests, and flip
  their rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Projection applies, hydration, and rollback writes must refresh watcher
  baselines before any diff loop dispatches.
- Local user edits made after the baseline refresh must still dispatch and keep
  the existing debounce/rollback semantics.
- Character-lorebook stubs remain protected: a non-hydrated character
  `globalLore` must not be persisted as an empty deletion.
- The cached command revision is still advanced exactly as before after a
  foreign event is applied.

## Done Criteria

- A foreign lorebook projection apply produces zero
  `replace*Lorebook*`/`updateGlobalLorebook` commands from a mounted watcher.
- A foreign character-row projection apply produces zero `updateCharacter`
  commands from a mounted profile watcher.
- A local lorebook edit and a local character-profile edit still dispatch their
  existing command shapes.
- M11 and M12 v2 gate entries point at real focused tests and the risk-map rows
  are `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/lorebookBridge.test.ts src/ts/server/characterBridge.svelte.test.ts
pnpm exec vitest run src/ts/bootstrap.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
