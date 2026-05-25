# Phase 9-4g - Compatibility Sweep

Date: 2026-05-26

Status: complete.

## Summary

9-4g swept the 9-4 command-backed resource families for residual
server-backed web write bypasses and tightened the plugin database bridge
where plugin-facing setters still touched module/provider state without
dispatching the matching typed commands.

## Landed

- Added `currentPluginProvider` to the plugin-visible database allowlist so
  plugin `getDatabase()` proxy writes and `setDatabase*` payloads route to
  the existing plugin provider command instead of falling through to
  plugin custom storage.
- Routed plugin database `modules` updates through existing module create,
  patch, delete, and reorder command dispatchers in Fastify mode.
- Routed plugin database `enabledModules` updates through existing module
  enable/disable command dispatchers in Fastify mode.
- Added focused plugin bridge tests for provider selection, module
  collection/enablement translation, and unknown top-level plugin database
  keys staying on plugin-storage bulk commands.

## Guardrails

- No new command endpoints were added; this slice uses the 9-4c, 9-4e,
  and 9-4f command surfaces already in place.
- Plugin code execution remains browser-side.
- Unknown plugin database keys continue to persist through
  `pluginCustomStorage`.
- Browser projection, event subscription, bootstrap reload, read-only
  `DBState.db` enforcement, provider-key masking, storage gating, and
  server `.risu` import/export remain deferred.

## Verification

- `pnpm test -- src/ts/plugins/plugins.test.ts` - 697 tests passed, 4
  skipped.
- `pnpm test -- src/ts/plugins/plugins.test.ts src/ts/compatibilityAdapters.test.ts src/ts/server/commands.test.ts`
  - 697 tests passed, 4 skipped.
- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 697 tests passed, 4 skipped.
- `pnpm api:test` - 1115 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Follow-Up

- Continue with 9-5 browser projection.
- 9-5 should add events/bootstrap projection first, then run the residual
  command replacement sweep before enabling the read-only `DBState.db`
  guard.
