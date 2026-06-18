# Phase 6: Resync, Memory & Navigation

Status: in progress.

Goal: fence full-state refreshes, memory job updates, and route/selection
transitions so late refreshes cannot overwrite newer local work.

## Completed Slices

- Memory job terminal/cancel ordering: `createMemoryJobRefreshController()` now
  records terminal job ids for the current chat and filters those ids out of
  older list responses and cached `not-modified` refreshes. The Hypa V3 server
  jobs modal routes cancel success and SSE job updates through the controller,
  ignores late old-chat cancel results, and uses a shared memory-job ordering
  fence so stale active SSE progress events cannot reopen Hypa V3 progress UI
  after a local terminal/cancel update.
- Full projection resync latest-request fencing:
  `forceServerProjectionResync()` now increments a latest request id for every
  caller, including callers that join an active coalesced promise. Each
  bootstrap fetch captures its request id, skips all projection apply, cached
  revision, hydration reset, and generation reattach side effects when a newer
  request exists, and returns the final/latest request result. This covers the
  shared full-resync helper used by server backup restore and local bundle
  import.

## Scope

- Realm import finish refresh, popup import flows, and the direct refresh path
  in `src/ts/characterCards.ts`.
- Remaining full save import, route, and bootstrap-adjacent refresh paths not
  already covered by `forceServerProjectionResync()`.
- Character/chat import helper refresh and rollback edges not closed by Phase
  3 or Phase 5.
- Memory job cancel versus polling/SSE/list refresh ordering.
- Route apply, shell hydration, chat selection, character open/select, and
  navigation generation guards.
- Welcome/onboarding delayed setup callbacks and other one-shot setup flows
  that can apply after choices or navigation changed.
- DevTool autopilot and other long sequential loops that append/generate across
  active-chat changes.

## Anchors

- `src/ts/server/backups.ts`
- `src/ts/server/realmImport.ts`
- `src/ts/server/projectionResync.ts`
- `src/ts/server/bootstrap.ts`
- `src/ts/characters.ts`
- `src/ts/process/request/serverMemory.ts`
- `src/lib/Others/WelcomeRisu.svelte`
- `src/ts/server/settingsBridge.svelte.ts`
- `server/fastify/src/routes/save.ts`
- `server/fastify/src/routes/backups.ts`
- `server/fastify/src/routes/realmImport.ts`
- `server/fastify/src/routes/memoryJobs.ts`
- Route and shell hydration helpers under `src/ts/server/`.

## Target Shape

- Intended destructive restore/import is explicit and cannot be confused with
  ordinary delayed projection.
- Non-destructive refresh checks local dirty state, active writer revision, or a
  refresh generation before applying.
- Memory cancel wins over older polling/SSE/list responses for the same job.
- Route/hydration selection applies only if the route generation is still
  current.
- Welcome/onboarding setup callbacks apply only to the same setup run, choice
  set, and navigation scope that started them.
- Long autopilot-style loops lock to an initial chat id or stop when the active
  chat changes.

## Exit Criteria

- Tests cover stale full refresh after a newer local edit, destructive restore
  intent, memory cancel followed by older list/progress update, character/chat
  route selection race, and long-loop active-chat change.
- Any full resync path that remains intentionally destructive is named in
  `../status.md` with the user-facing guard that makes it explicit.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/risuSaveImportRoute.test.ts \
  server/fastify/__tests__/risuSaveBundleImportRoute.test.ts \
  server/fastify/__tests__/realmImport.test.ts
pnpm exec vitest run src/ts/characters.importChat.test.ts \
  src/ts/process/request/tests/serverChat.test.ts
pnpm exec vitest run src/ts/server/projectionResync.test.ts \
  src/ts/server/backups.test.ts src/ts/bootstrap.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Add focused memory and navigation tests near the helpers changed by this phase.

## Risks

- Restore/import flows are sometimes intentionally destructive. The goal is not
  to prevent those paths, but to make the destructive boundary explicit and
  prevent accidental delayed refreshes from behaving the same way.
- Memory job UI may combine SSE, polling, and manual refresh. Ordering guards
  must cover every source of job state.
