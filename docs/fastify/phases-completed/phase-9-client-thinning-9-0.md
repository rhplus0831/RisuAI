# Phase 9 Client Thinning - 9-0 Mutation Inventory And Command Map

Date: 2026-05-25

9-0 is closed as a planning gate. It does not add command routes or
replace browser mutation call sites. It locks the inventory and command
contract that the implementation slices must follow.

## Confirmed

- The active Phase 9 command map lives in
  [`phase-9-command-map.md`](phase-9-command-map.md).
- The audit covered direct `DBState.db` writes, Svelte binds,
  array-mutator writes, `setDatabase` / `setDatabaseLite`, mutable
  `getDatabase()` references, plugin database setters, import/restore
  flows, storage helpers, and helper APIs that mutate through indirection.
- Candidate searches found 453 direct setter/mutator lines, 396 Svelte
  bind lines, and 914 mutable-reference candidate lines. These are
  candidate counts, not unique command counts.
- Write surfaces are classified by resource family, server-backed web
  scope, legacy local-only scope, rollback risk, and owning Phase 9 slice.
- Command endpoint names, payload behavior, id-vs-index rules, child
  replacement behavior, reorder behavior, revision conflict behavior,
  event naming, and test expectations are locked for implementation.
- Plugin writes keep the plugin-facing API and translate allowed
  top-level keys into typed commands. Unknown plugin keys route to
  `pluginCustomStorage` when the bridge lands in 9-4f.

## Out Of Scope

- Command routes and browser command helpers.
- Replacing mutation call sites.
- Enforcing a read-only `DBState.db` guard.
- Bootstrap/event projection implementation.
- Server-side `.risu` import/export implementation.
- Provider-key masking or storage backend removal.

## Verification

Passed:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Results:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 652 tests passed, 4 skipped.
- `pnpm api:test` - 1050 tests passed.
- `pnpm build` - passed with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Start **9-1 - Command foundation**:

- Add shared Fastify command route plumbing.
- Add revision conflict handling and rollback-safe repository mutation
  helpers for the current `db.json` blob.
- Add command event response plumbing.
- Add the typed browser command helper.
- Ship one small allowlisted settings command as the harness test.
