# Phase 6: Resync, Memory & Navigation

Status: complete.

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
- Realm import finish refresh fencing: server-backed Realm import completion in
  `src/ts/characterCards.ts` now calls
  `forceServerProjectionResync('realm-import')` instead of directly fetching and
  applying bootstrap projection. A module-level Realm operation token fences
  progress callbacks, always runs the fenced resync after successful server
  commits, and allows only the latest Realm operation to run completion
  progress, post-refresh `changeChar()` navigation, alert clearing, completion
  alerts, or refresh-failure alerts.
- Character route and shell-selection freshness fencing: `applyRouteToStores()`
  now assigns a route application epoch and only the latest application can clear
  `applyingRoute`/`routeApplicationPending`. Character route application passes a
  freshness guard through `changeChar()`, re-resolves the live character index by
  `chaId` after awaits, and verifies the route still owns the selected character
  before selecting a routed chat. `changeChar()` now fences delayed shell
  hydration with a latest selection-attempt id, revalidates the captured
  character id after hydration, and writes `currentChar`/`selectedCharID` using
  the live id-located index. Failed character select command rollback now
  restores the previous selection only while the attempted selection/currentChar
  and attempted `lastInteraction` are still live.
- Character/chat import refresh and post-import navigation freshness:
  `importCharacter()`, `importCharacterProcess()`, and card-spec import helpers
  now return the stable imported `chaId` instead of relying on the array tail.
  Add-character post-import navigation uses a latest import operation token,
  verifies the original selection/navigation scope, re-resolves the returned id
  to a live index, and passes freshness through `changeChar()`. Realm
  unsupported/local fallback navigation also uses the returned id plus the
  existing Realm operation token. Chat import now keeps the originally captured
  character target, while same-character overlapping picker/import operations
  are latest-wins before unshifting chats or resetting `chatPage`.
- Welcome/onboarding delayed setup callback freshness: `WelcomeRisu.svelte` now
  schedules final setup through a local run-token helper that captures provider,
  chat language, and memory choices. The callback applies onboarding settings
  only while the component is still mounted, the run is latest, the step and
  choices still match, and `didFirstSetup` has not already become true. Destroy
  stops the settings watcher, invalidates the setup run, and clears the pending
  timer.
- Long active-chat loop fencing: `chatCommands.ts` now exports
  `captureActiveChatTarget()` and `isActiveChatTargetFresh()` using stable
  character/chat ids. DevTool Autopilot captures the active target once, passes
  it into `appendCurrentChatUserMessageForSend()`, and stops silently if the
  active chat changes before append, before generation, or before the next row.
  Slash `/multisend` uses the same captured target to stop later append/send
  iterations after an active-chat switch.
- Command-event character-selection closure: inbound server command-event
  character-selection projections now re-check the cached/applied command
  revision after delayed shell hydration before selecting. Stale older
  selections do not regress `currentChar`/`selectedCharID`, live selection is
  resolved by `chaId` instead of trusting stale projected indexes, and missing
  current targets fall back to the fenced full-resync path.
- `.po` translation loop closure: `src/ts/process/files/multisend.ts` now
  captures the active chat target once for `.po` translation, uses
  `appendCurrentChatUserMessageForSend()` with that expected target for each
  prompt append, re-checks target freshness before and after `sendChat(-1)`,
  stops on stale active-chat changes, and skips partial `translated.po`
  downloads/results.

## Remaining Residuals

- None. Remaining work moves to Phase 7 final verification and closeout.

## Scope

- Popup import flows and remaining restore/import refresh paths not already
  covered by the fenced Realm and character/chat import slices.
- Remaining full save import, route, and bootstrap-adjacent refresh paths not
  already covered by `forceServerProjectionResync()`.
- Memory job cancel versus polling/SSE/list refresh ordering.
- Route apply, shell hydration, chat selection, character open/select, and
  navigation generation guards.
- Long sequential loops that append/generate across active-chat changes,
  including DevTool Autopilot, slash `/multisend`, and `.po` translation.

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
- Server-backed Realm import completion uses the shared full-resync fence, while
  stale Realm operations cannot overwrite newer progress or post-refresh
  navigation UI.
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
