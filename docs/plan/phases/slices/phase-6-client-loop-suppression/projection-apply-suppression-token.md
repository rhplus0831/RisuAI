# Projection Apply Suppression Token

Status: implemented.

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
write guard for server-backed projection mutations and a shared
server-projection apply epoch. Full and targeted server projection application
advance that epoch; settings, chat, and script-definition watchers read it and
refresh their baselines without dispatching commands. Lorebook still keeps its
hydrated-lorebook guard for no-data-loss behavior.

## Protocol Behavior

- Introduce a shared "applying server projection" token or equivalent baseline
  mechanism. Done.
- Watchers should suppress command dispatch for server-origin projection writes.
  Done.
- Local UI drafts should continue to dispatch commands after projection apply
  completes. Done.

## Done When

- A passive client receiving a foreign projection update does not echo the same
  value back as a command. Done.
- Watchers compare against the correct server-applied baseline. Done.
- Tests cover at least settings and one non-settings bridge. Done.

## Validation

- `pnpm test -- src/ts/server/settingsBridge.svelte.test.ts src/ts/server/chatBridge.svelte.test.ts src/ts/server/scriptDefinitionBridge.svelte.test.ts`
- `pnpm test -- src/ts/server src/ts/bootstrap.test.ts`
