# Phase 9 Follow-Up - Client Thinning

Date: 2026-05-26

Status: reopened by audit.

## Goal

Make Fastify-served web a true server projection: durable writes go
through commands or import routes, direct projection writes fail, and
import/export events match the command map.

## Audit Findings

- Landed 2026-05-26: Fastify web bootstrap now enables the projection
  guard, startup projection replacement/normalization uses trusted
  writes, and browser smoke proves a direct projection write fails.
- Landed 2026-05-26: the named direct write examples below were routed
  through settings/character commands or trusted optimistic projection
  helpers:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:1188`,
  `src/lib/ChatScreens/DefaultChatScreen.svelte:1230`,
  `src/ts/stores.svelte.ts:185`,
  `src/lib/Setting/Pages/Display/NotificationToggle.svelte:10`, and
  `src/lib/Playground/PlaygroundMenu.svelte:35`.
- `.risu` import/export event semantics do not match the Phase 9 command
  map. The command map expects `state.imported` and `state.exported` in
  `docs/fastify/status/phase-9-command-map.md:186`; save routes do not
  accept an event sink at `server/fastify/src/routes/save.ts:39`; the
  event catalog only contains `state.restored` at
  `server/fastify/src/commands/events.ts:302`.
- Browser smoke/storage-write audit now proves projection guard
  enforcement, but still does not prove `.risu` import coverage.

## Tasks

- Continue keeping expected projection refresh, optimistic command
  replay, or rollback behind `withTrustedServerProjectionWrite`.
- Sweep remaining direct `DBState.db` writes reachable in Fastify web
  mode. Route durable settings, character, chat, memory-toggle, and
  playground writes through commands or explicitly disable them when they
  are unsupported.
- Add any remaining command allowlist coverage found by the broader
  direct-write audit. The named slice added coverage for `notification`
  and `useAutoSuggestions`.
- Add `state.imported` and `state.exported` event drafts, pass the
  command event sink into save/import/export routes, and emit events
  after repository revision changes where applicable. If export events
  are intentionally not needed, update the command map and this
  follow-up doc in the same change.
- Extend browser smoke/storage audit to cover `.risu` import.

## Exit Criteria

- Fastify-served browser startup enables the projection guard. (Met by
  the 2026-05-26 guard slice.)
- A direct write to `DBState.db` in Fastify web mode fails unless it is
  wrapped in the trusted projection helper. (Met by the 2026-05-26 guard
  slice and browser smoke.)
- No reachable durable Fastify web workflow persists by direct client
  mutation.
- `.risu` import/export event behavior matches the command map or the
  command map has been deliberately corrected.
- `pnpm smoke:fastify-browser` covers import and guard enforcement.

## Verification

```bash
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts
pnpm exec vitest run src/ts/server/commands.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm smoke:fastify-browser
pnpm check
```

## References

- Original phase: `docs/fastify/phases/phase-9-client-thinning.md`
- Original command map:
  `docs/fastify/status/phase-9-command-map.md:186`
- projection guard default: `src/ts/server/projectionWriteGuard.svelte.ts:5`
- direct chat setting write:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:1188`
- direct suggestion setting write:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:1230`
- direct selected-character memory write: `src/ts/stores.svelte.ts:185`
- direct notification setting bind:
  `src/lib/Setting/Pages/Display/NotificationToggle.svelte:10`
- save route registration: `server/fastify/src/routes/save.ts:39`
- current state event catalog: `server/fastify/src/commands/events.ts:302`
