# Slice: Route Refreeze Mounted DOM Test

Phase: [3](../../phase-3-sidebar-route-refreeze-dom.md). Test change.

Status: planned. Depends on Phase 2
[`sidebar-tab-selectors.md`](../phase-2-selector-hardening/sidebar-tab-selectors.md).

## Scope

Add a mounted Svelte DOM regression test for the sidebar route/refreeze bug fixed
by `09eae20d3`.

This slice keeps the existing source-shape guard in `src/App.routeEffect.test.ts`.

## Visible Contract

On `/character/char-a/chat-a`, after the user opens the sidebar Character tab,
a trusted server projection refreeze must not switch the visible sidebar panel
back to Chat. The URL, selected character, active chat index, and
`botMakerMode` must remain stable.

## Anchors

- `src/App.svelte`
- `src/App.routeEffect.test.ts`
- New test home: `src/App.routeEffect.dom.test.ts`
- `src/lib/SideBars/Sidebar.svelte`
- `src/lib/SideBars/CharConfig.svelte`
- `src/lib/SideBars/SideChatList.svelte`
- `src/ts/router.ts`
- `src/ts/server/projectionWriteGuard.svelte.ts`

## Target Shape

- Mount real `App.svelte` and real `Sidebar.svelte`.
- Stub heavy children and always-present overlays with local marker components.
- Seed `DBState.db` with one loaded character, one selected chat, `modules: []`,
  and `enabledModules: []`.
- Set `loadedStore=true`, `selectedCharID=0`, `sideBarStore=true`,
  `DynamicGUI=false`, `settingsOpen=false`, `PlaygroundStore=0`, and related
  stores needed by `App`.
- Use a narrow router mock whose `currentRoute` is
  `/character/char-a/chat-a` and whose `applyRouteToStores()` synchronously
  reads `DBState.db` before resetting `botMakerMode` if it reruns.
- Click the Character tab through the Phase 2 selector.
- Trigger a trusted projection write/refreeze.
- Assert the Character panel marker remains visible and Chat panel marker stays
  absent.

## Invariants

- The router mock must reproduce the tracked-read failure mode by reading
  `DBState.db`.
- Do not build a Playwright smoke for this regression.
- Keep mocks local to this test.
- Avoid direct text selectors once the Phase 2 sidebar selectors exist.

## Done Criteria

- The new DOM test fails if `App.svelte` starts tracking projection reads in
  route application again.
- Existing source-shape test still passes.

## Validation

```bash
pnpm exec vitest run src/App.routeEffect.test.ts src/App.routeEffect.dom.test.ts
pnpm exec vitest run src/lib/SideBars/SideChatList.svelte.test.ts src/ts/router.test.ts
```
