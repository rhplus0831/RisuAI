# Clone-Cost Regression Harness

Status: implemented. Phase 0. Adds reusable proof helpers. No runtime code
changes.

Landed at `src/ts/__tests__/cloneCostHarness.ts` (test-only, excluded from the
client-lib build). Surface: `assertSnapshotIsScalar` and
`assertSnapshotOmitsCollections` (structural), `assertRollbackRestoresOnly`
(rollback-correctness driver), `withCloneInstrumentation` (spies
`JSON.stringify` for `cloneJsonValue` and `structuredClone` for
`safeStructuredClone`, returns clone counts + max cloned payload size), and
`seedCloneCostDb` (multi-character, one multi-message hydrated chat). Imported by
the Phase 0 kit tests; the sanity baseline shows the selection snapshot performs
zero whole-characters clones while the legacy snapshot performs one.

## Scope

Provide one importable test helper that proves a hot path no longer clones the
whole characters array or whole `Database`. Generalize the reference fix's
structural snapshot assertion and rollback-correctness assertion.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the clone-site inventory (the universe a gate must eventually cover) and each
  finding's "why it is expensive" measurement.
- `src/ts/compatibilityAdapters.test.ts` - the reference-fix tests to generalize.
- `src/ts/polyfill.ts:19` - `safeStructuredClone` (the clone primitive to
  instrument).
- `src/ts/chatCommands.ts:68`, `src/ts/characterCommands.ts:52`, ... - the per-file
  `cloneJsonValue` definitions (the JSON-round-trip primitive to instrument).

## Harness Surface

- `assertSnapshotIsScalar(snapshot)`: asserts a snapshot omits `characters`,
  `characterOrder`, `modules`, and `message` / `localLore` payloads.
- `assertRollbackRestoresOnly(setup, mutate, restore, expectations)`: drives an
  optimistic-write failure and checks that only the mutated slice is restored.
- `withCloneInstrumentation(fn)`: spies on `safeStructuredClone` and relevant
  `cloneJsonValue` exports, returning clone count and max cloned collection size.
  If spies are awkward, use a seeded multi-MB DB plus a size threshold.

## Implementation Notes

- The harness is test-only; do not add a runtime instrumentation hook to ship in
  production (the audit's measurements were one-off, not a runtime counter).
- Seed builders should produce a DB with multiple characters and at least one
  multi-message hydrated chat so a full clone is distinguishable from a scoped one
  by size.
- Keep the harness independent of any specific snapshot helper so Phase 2-7
  slices can import it directly.

## Done When

- The helper module exists and is imported by the Phase 0 snapshot-kit tests.
- The reference-fix tests pass through the harness's structural and
  rollback-correctness assertions (no behavior change).
- The harness can demonstrate, on a seeded multi-chat DB, that
  `currentCharacterSelectionSnapshot` performs zero whole-characters clones while
  the legacy `currentCharacterStateSnapshot` performs one (a sanity baseline).

## Validation

- `pnpm test -- src/ts/compatibilityAdapters.test.ts`
- `pnpm test`
