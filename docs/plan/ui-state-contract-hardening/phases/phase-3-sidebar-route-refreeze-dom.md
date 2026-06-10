# Phase 3: Sidebar Route/Refreeze DOM Backfill

Status: planned.

Goal: add a visible DOM regression test for the sidebar tab stability bug fixed
by `09eae20d3`.

## Scope

Add a sibling test such as `src/App.routeEffect.dom.test.ts`. Keep the existing
`src/App.routeEffect.test.ts` source-shape guard.

## Visible Contract

On a loaded character route such as `/character/char-a/chat-a`, after the user
clicks the sidebar `Character` tab and `CharConfig` is visible, a server
projection refreeze must not switch the sidebar back to the `Chat` tab. The URL,
selected character, and selected chat should remain stable.

## Anchors

- `src/App.svelte`
- `src/App.routeEffect.test.ts`
- `src/lib/SideBars/Sidebar.svelte`
- `src/lib/SideBars/CharConfig.svelte`
- `src/lib/SideBars/SideChatList.svelte`
- `src/ts/router.ts`
- `src/ts/server/projectionWriteGuard.svelte.ts`

## Target Shape

- Mount real `App.svelte` with real `Sidebar.svelte`.
- Mock heavy app children and sidebar panel bodies with markers.
- Seed `DBState.db`, `loadedStore`, `selectedCharID`, `sideBarStore`,
  `DynamicGUI`, `settingsOpen`, `PlaygroundStore`, and `botMakerMode`.
- Use a narrow router mock that exposes a character route and makes
  `applyRouteToStores` read `DBState.db` and reset `botMakerMode` if it reruns.
- Click the Character tab.
- Trigger a trusted projection write/refreeze.
- Assert `CharConfig` remains visible, `SideChatList` remains absent,
  `botMakerMode` remains true, and route/selection are unchanged.

## Invariants

- Do not build a full browser smoke for this regression; a mounted Svelte DOM
  test is the right layer.
- Seed `modules: []` or mock `moduleUpdate` to avoid unrelated store setup
  errors.
- Keep mocks local to this test.

## Done Criteria

- New DOM test fails if `App.svelte` route application starts tracking
  projection reads again.
- Existing source-shape test still passes.
- Status and verification logs are updated.

## Validation

```bash
pnpm exec vitest run src/App.routeEffect.test.ts src/App.routeEffect.dom.test.ts
pnpm exec vitest run src/lib/SideBars/SideChatList.svelte.test.ts src/ts/router.test.ts
pnpm check
```
