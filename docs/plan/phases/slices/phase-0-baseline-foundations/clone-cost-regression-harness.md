# Clone-Cost Regression Harness

Status: planned. Phase 0. Adds the reusable proof the later narrowings assert
against. No runtime code changes.

## Scope

Provide one importable test helper that makes "this hot path no longer clones the
whole characters array / whole `Database`" assertable, generalizing the reference
fix's two tests
(`src/ts/compatibilityAdapters.test.ts`: the structural `not.toHaveProperty`
assertion and the failed-command rollback-correctness assertion). This is the
frontend analog of the mutation-range plan's `writtenTables` / `tableRowidsById`
gate template.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the clone-site inventory (the universe a gate must eventually cover) and each
  finding's "why it is expensive" measurement.
- `src/ts/compatibilityAdapters.test.ts` - the reference-fix tests to generalize.
- `src/ts/polyfill.ts:19` - `safeStructuredClone` (the clone primitive to
  instrument).
- `src/ts/chatCommands.ts:68`, `src/ts/characterCommands.ts:52`, … - the per-file
  `cloneJsonValue` definitions (the JSON-round-trip primitive to instrument).

## Harness Surface

- `assertSnapshotIsScalar(snapshot)` — asserts a snapshot object omits
  `characters`, `characterOrder`, `modules`, and any `message`/`localLore`
  payload; the cheap structural gate every narrowed snapshot passes.
- `assertRollbackRestoresOnly(setup, mutate, restore, expectations)` — drives the
  optimistic-write-then-failure flow and asserts only the mutated slice is
  restored while a seeded unrelated row keeps its values (the reference fix's
  second test, parameterized).
- `withCloneInstrumentation(fn)` — spies on `safeStructuredClone` and the relevant
  `cloneJsonValue` exports, returning the number of clone calls and the max cloned
  collection size, so a test can assert a hot path performed zero whole-DB /
  whole-characters clones. Implemented by spying the exported primitives (or a
  seeded multi-MB DB + a size threshold) — pick whichever the existing test setup
  supports without a runtime hook.

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
