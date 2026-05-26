# Phase 9-5e-ii - Command Bridge Guard Integration

Date: 2026-05-26

Status: complete.

## Summary

- Moved the Fastify projection write guard primitive into
  `src/ts/server/projectionWriteGuard.svelte.ts` so command bridge modules
  can import trusted write scopes without creating a runtime cycle with
  `storage/database.svelte.ts`.
- Kept `storage/database.svelte.ts` as the compatibility export surface for
  the guard helpers used by bootstrap/tests.
- Wrapped command-owned rollback restorers for character, chat, module,
  plugin, loadout, persona, settings, lorebook, script-definition, plugin
  V3 theme/settings, and MCP refresh-token paths in trusted projection write
  scopes.
- Wrapped preset helper optimistic writes plus selected character/chat
  compatibility setters in trusted scopes.
- Wrapped lorebook, script-definition, and persona client-id normalization
  helpers that run immediately before command dispatch.
- Added a focused bootstrap guard regression proving trusted writes can
  mutate a guarded Fastify projection and that the projection is read-only
  again after the trusted scope exits.

## Verification

- `pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/commands.test.ts src/ts/compatibilityAdapters.test.ts src/ts/process/modules.test.ts`
  - 51 tests passed.
- `pnpm check`
  - 0 Svelte errors and 0 warnings.

## Follow-Up

- Continue with 9-5e-iii guard audit closeout.
- Enable the guard across the server-backed fixture path and classify any
  failures as missed 9-5d residual writes, intentional local/runtime-only
  state, or larger follow-up residual slices.
- Do not fold storage/provider gating, server-side `.risu` import/export,
  asset byte changes, server-side plugin execution, or per-event surgical
  browser patches into 9-5e-iii.
