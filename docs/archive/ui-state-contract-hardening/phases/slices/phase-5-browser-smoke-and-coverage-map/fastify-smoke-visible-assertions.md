# Slice: Fastify Smoke Visible Assertions

Phase: [5](../../phase-5-browser-smoke-and-coverage-map.md). Browser smoke test
change.

Status: complete. Depended on relevant Phase 2 selectors.

## Scope

Add sparse visible locators to existing Fastify browser smoke specs.

This slice does not turn the smoke hook into a UI driver.

## Visible Contract

The real Fastify-served browser should visibly leave loading state, show the
fixture character, and render reroll chat row text through the actual app DOM.

## Anchors

- `server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts`
- `server/fastify/browser-smoke/rerollSwipePersistence.spec.ts`
- `src/ts/server/browserSmoke.ts`
- `src/lib/SideBars/SidebarAvatar.svelte`
- `src/lib/ChatScreens/Chat.svelte`

## Target Shape

- After `waitForLoaded()`, assert the loading text/state is gone or the app root
  is visibly active.
- Assert the smoke fixture character through stable DOM, preferably
  `[data-char-id="char-smoke"]` rather than tooltip text.
- In reroll smoke, assert visible rows contain `greet me`, `old reply`,
  `rerolled reply`, then `old reply` again after swipe-back.
- Keep hook usage for state-driving steps that already require it.

## Invariants

- Prefer `pnpm smoke:fastify-browser` because specs serve built `dist`.
- Keep locators semantic and sparse.
- Do not add broad browser automation for component drift.

## Done Criteria

- Existing smoke specs include visible assertions.
- Smoke remains small and deterministic.

## Validation

```bash
pnpm smoke:fastify-browser
```
