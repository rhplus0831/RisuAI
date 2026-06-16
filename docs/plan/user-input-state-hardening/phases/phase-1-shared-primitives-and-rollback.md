# Phase 1: Shared Primitives & Rollback

Status: pending.

Goal: add reusable stale-state primitives and convert the common broad rollback
paths that later phases depend on.

## Scope

- Add operation-token helpers for latest-run checks by target.
- Add attempted-value rollback helpers for scalar, keyed object, and keyed list
  patches.
- Convert common command wrappers that currently restore broad snapshots after
  failure.
- Make rollback behavior observable in tests without requiring artificial
  network sleeps in every domain.
- Keep server `baseRevision` behavior unchanged unless a targeted test exposes
  a missing route-level check.

## Anchors

- `src/ts/server/commands.ts`
- `src/ts/chatCommands.ts`
- `src/ts/server/settingsBridge.svelte.ts`
- `src/ts/server/characterBridge.svelte.ts`
- `server/fastify/src/routes/commands.ts`
- Existing tests near `src/ts/server/commands.test.ts`,
  `src/ts/chatCommands.test.ts`, and server command tests.

## Target Shape

- Failed command rollback compares the live value with the failed attempted
  value before restoring the previous value.
- Chat, message, folder, character, preset, persona, loadout, module, plugin,
  lorebook, script, and trigger helpers have a path away from whole-snapshot
  rollback.
- Helper tests cover:
  - rollback skips when a newer local edit is present;
  - rollback restores only the attempted key;
  - rollback for keyed lists does not replace sibling rows;
  - sequential failures do not unwind newer successful commands.

## Out Of Scope

- Domain-specific callback guards for uploads, imports, fetches, and
  generation. Those land in later phases.
- Full draft projection merge. Phase 2 owns dirty draft behavior.

## Exit Criteria

- Shared helpers exist with focused coverage.
- At least the chat/message command helper family has a narrow rollback path or
  a documented phased adapter for conversion.
- The remaining broad rollback families are listed in `../status.md` with the
  phase that owns each one.

## Validation

```bash
pnpm exec vitest run src/ts/server/commands.test.ts src/ts/chatCommands.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/commandSingleRowPaths.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Risks

- Rollback helpers can accidentally treat arrays as positional snapshots.
  Prefer keyed entries and ids, and document any unavoidable positional cases.
- Some existing helpers may mutate objects in place before command dispatch.
  Tests should catch rollback comparisons against mutated references.
