# Slice: Plugin Storage Key Read Snapshot

Phase: [4](../../phase-4-client-clone-ring-2.md). Finding: M8. Runtime
change.

## Scope

Make `pluginStorage.getItem(key)` read and detach only the requested plugin
storage value. It currently calls the snapshot form of `getDatabase`, cloning
the whole database to return one key.

This slice does not change `setItem`, `removeItem`, `clear`, device-local
plugin storage, or the V2/V3 plugin API surface.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M8.
- `src/ts/plugins/plugins.svelte.ts`: `getV2PluginAPIs().pluginStorage`.
- `src/ts/storage/database.svelte.ts`: `getDatabase({ snapshot: true })`.
- Existing focused tests: `src/ts/plugins/plugins.test.ts`.

## Target Shape

- Change `pluginStorage.getItem` to read from `getDatabase()` without the
  whole-database snapshot path.
- Clone only `db.pluginCustomStorage?.[key]` before returning it so objects and
  arrays are detached from live state.
- Use a nullish fallback: absent keys return `null`, while stored falsey values
  such as `''`, `0`, or `false` remain readable if present.
- Keep sibling methods `key`, `keys`, and `length` on their non-snapshot path.
- Add a clone-cost test with a large seeded database proving `getItem` performs
  zero whole-database snapshots and only clones the selected value.
- Register M8 as `DONE` in the v2 gate with focused test evidence, and flip
  the M8 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Returning an object or array must not expose a mutable live reference to
  `DBState.db.pluginCustomStorage`.
- Reading a key must not create `pluginCustomStorage` as an observable write.
- Plugin compatibility mode and safe local storage error behavior remain
  unchanged.

## Done Criteria

- `pluginStorage.getItem` performs zero whole-database snapshots on the clone
  harness.
- Mutating a returned object or array does not mutate live plugin storage.
- Missing-key and scalar-key behavior remains unchanged.
- The v2 gate and active-risk row mark M8 `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/plugins/plugins.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
