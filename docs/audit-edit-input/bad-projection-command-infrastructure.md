# Projection And Command Infrastructure Audit

Date: 2026-06-16

Status: bad

## Scope

Verified command response handling, own-event reconciliation, projection
hydration, bridge rollback, backend row writers, plugin storage fallback, and
message projection granularity.

## Result

The covered tests pass, but the infrastructure has real hazards that explain why
user-input update fixes recur. Most importantly, own command echoes are skipped,
so every same-tab update must apply local optimistic projection or explicitly
apply returned data.

## Findings

- `src/ts/server/commands.ts:2817` runs commands and handles rollback/revision.
  It does not apply command resource data to local projection.
- `src/ts/bootstrap.ts:335` skips own command events. Missing optimistic writes
  therefore remain stale in the originating tab.
- Hydration revision gating looks normal: chat/lorebook hydration captures
  request-start baselines and drops older responses.
- Bridge rollback same-row overwrite risk is real:
  `src/ts/chatCommands.ts:380` restores all allowed metadata keys,
  `src/ts/characterCommands.ts:203` replaces a whole row, and
  `src/ts/server/characterBridge.svelte.ts:420` assigns the captured profile
  back. Settings rollback is safer because it restores only when current still
  equals attempted.
- Embedded fallback zero-row update hazard is real:
  `server/fastify/src/repository.ts:1365` can read fallback embedded chat state,
  but `server/fastify/src/repository.ts:530` uses unchecked `UPDATE`. Routes
  such as `server/fastify/src/routes/commands.ts:3617` can treat that as
  success.
- Plugin storage fallback is conditional but real for legacy embedded settings:
  empty `plugin_custom_storage` can preserve embedded values while delete/clear
  only touch table rows.
- Duplicate active message `uid` ambiguity exists because
  `server/fastify/src/messageStore.ts:72` keys messages by `(chat_id, seq)`, and
  `:232` resolves `uid` with `LIMIT 1`.
- `server/fastify/src/routes/projection.ts:37` maps ordinary `message` events to
  broad `characters`; only generation has the more precise `generation-chat`
  projection.

## Verification

Targeted tests passed:

- `pnpm test src/ts/bootstrap.test.ts src/ts/server/chatMessageHydration.test.ts src/ts/server/chatBridge.svelte.test.ts src/ts/server/characterBridge.svelte.test.ts src/ts/pluginCommands.test.ts src/ts/plugins/plugins.test.ts`
- `pnpm api:test server/fastify/__tests__/projection.test.ts server/fastify/__tests__/messageStore.test.ts server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts server/fastify/__tests__/commandMutationReadNarrowing.test.ts server/fastify/__tests__/commandSingleRowPaths.test.ts`
- Main backend command/projection run: 11 files, 368 tests passed.

These tests validate many happy paths and guards, but they do not remove the
need for local optimistic projection on every originating-tab command.
