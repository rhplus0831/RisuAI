# Client Resource Ownership Latest Verification

Date: 2026-08-30

Commit under verification: `e751edc69`.

Environment: Node.js `v24.19.0`, pnpm `11.23.0`.

## Owner Contract Proof

- `lorebookPageOwner` owns focused read state plus optimistic page selection,
  accepted/queued/failed outcomes, current-attempt rollback, stale/retry state,
  replay settlement, and authoritative reload.
- Selection stages the exact `lorebook-select` request under the deterministic
  global-selection and stable lorebook-id dependency keys. Retained writer loss
  stays queued; terminal/current failures roll back only the live projection.
- Drafts are explicitly not applicable to the numeric page pointer. Lorebook
  collection bodies and editor drafts do not move.
- No production consumer uses the owner yet. Compatibility remains exactly
  9,917 references across 325 groups, six bridges, and 20 temporary-seam rows.

## Commands

- `pnpm exec vitest run packages/protocol/src/durableCommandOperation.test.ts src/ts/server/lorebookPageOwner.test.ts src/ts/server/lorebookPageSelectionPersistence.test.ts`
  — passed, 3 files and 28 tests.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts`
  — passed, 1 file and 15 tests, including settings-row-only lorebook
  selection.
- `pnpm exec tsx util/architecture-inventory.ts` — passed 336 cross-runtime
  edges, 19 compatibility surfaces/38 probes, the unchanged client inventory,
  and all 56 owner gap rows.
- `pnpm check` — passed with zero errors and zero warnings.
- `pnpm check:server` — passed protocol, architecture, declarations, Fastify,
  and browser-smoke typechecks.
- `pnpm test:watch:status` — generation 36 passed for the current worktree; it
  reused the prior full evidence and executed the changed owner test.
- Focused Prettier and `git diff --check` — passed.

## Verdict

Phase 1 is accepted at `e751edc69`. The owner is fully migratable without an
aggregate facade and can be removed locally because no production consumer has
moved. Phase 2 opens only for the standalone lorebook page pointer.
