# Phase 9 Follow-Up - Client Thinning

Date: 2026-05-26

Status: reopened by audit.

## Goal

Make Fastify-served web a true server projection: durable writes go
through commands or import routes, direct projection writes fail, and
import/export events match the command map.

## Audit Findings

- The read-only projection guard exists but is not enabled in production
  startup. The guard defaults off in
  `src/ts/server/projectionWriteGuard.svelte.ts:5`, and production code
  only imports the helper in tests/storage support rather than calling
  `setServerProjectionWriteGuardEnabled(true)` during Fastify web
  bootstrap.
- Several server-backed web paths still mutate `DBState.db` directly.
  Examples found by audit:
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
- Browser smoke/storage-write audit does not prove import coverage or
  projection guard enforcement.

## Tasks

- Enable the read-only projection guard for Fastify-served web startup
  after trusted bootstrap replacement is in place. Any expected
  projection refresh, optimistic command replay, or rollback must use
  `withTrustedServerProjectionWrite`.
- Sweep remaining direct `DBState.db` writes reachable in Fastify web
  mode. Route durable settings, character, chat, memory-toggle, and
  playground writes through commands or explicitly disable them when they
  are unsupported.
- Add missing command allowlist coverage where a direct write already has
  a natural command group, such as `notification` in display settings if
  it remains durable server state.
- Add `state.imported` and `state.exported` event drafts, pass the
  command event sink into save/import/export routes, and emit events
  after repository revision changes where applicable. If export events
  are intentionally not needed, update the command map and this
  follow-up doc in the same change.
- Extend browser smoke/storage audit to cover `.risu` import and a
  direct projection-write failure.

## Exit Criteria

- Fastify-served browser startup enables the projection guard.
- A direct write to `DBState.db` in Fastify web mode fails unless it is
  wrapped in the trusted projection helper.
- No reachable durable Fastify web workflow persists by direct client
  mutation.
- `.risu` import/export event behavior matches the command map or the
  command map has been deliberately corrected.
- `pnpm smoke:fastify-browser` covers import and guard enforcement.

## Verification

```bash
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts
pnpm api:test -- server/fastify/__tests__/events.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts
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
