# Projection Apply Suppression Token

Status: planned; several bridges already keep local baselines, but there is no
shared server-projection apply token.

## Source Anchors

- `src/ts/storage/database.svelte.ts`
- `src/ts/server/projectionWriteGuard.svelte.ts`
- `src/ts/server/settingsBridge.svelte.ts`
- `src/ts/server/chatBridge.svelte.ts`
- `src/ts/server/lorebookBridge.svelte.ts`
- `src/ts/server/scriptDefinitionBridge.svelte.ts`

## Scope

Prevent trusted server projection application from being interpreted as a local
edit by command-backed bridge watchers.

Current behavior: `projectionWriteGuard.svelte.ts` provides the shared trusted
write guard for server-backed projection mutations. Settings, chat, lorebook,
and script-definition bridges still keep their own watcher baselines and
rollback suppression. This slice is only for remaining echo cases or for
replacing duplicated baseline rules with a shared projection-apply signal.

## Protocol Behavior

- Introduce a shared "applying server projection" token or equivalent baseline
  mechanism.
- Watchers should suppress command dispatch for server-origin projection writes.
- Local UI drafts should continue to dispatch commands after projection apply
  completes.

## Done When

- A passive client receiving a foreign projection update does not echo the same
  value back as a command.
- Watchers compare against the correct server-applied baseline.
- Tests cover at least settings and one non-settings bridge.

## Validation

- Focused bridge tests.
- `pnpm test -- src/ts/bootstrap.test.ts`
