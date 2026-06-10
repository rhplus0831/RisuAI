# Phase 5: Browser Smoke And Coverage Map

Status: planned.

Goal: make browser smoke prove a tiny number of visible app states and add an
opt-in coverage-map workflow for critical UI integration paths.

## Scope

- Add sparse Playwright locator assertions to existing Fastify browser smoke.
- Avoid growing `window.__RISU_FASTIFY_BROWSER_SMOKE__` into a UI driver.
- Add a dedicated coverage-map script/profile or documented command. Do not
  enable coverage on default `pnpm test`.

## Anchors

- `package.json`
- `playwright.fastify-smoke.config.ts`
- `server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts`
- `server/fastify/browser-smoke/rerollSwipePersistence.spec.ts`
- `src/ts/server/browserSmoke.ts`
- `vitest.config.ts`

## Target Shape

Browser smoke assertions:

- After `waitForLoaded()`, the app has visibly left loading state.
- The fixture character is visible in the app, using fixture text or stable
  selectors.
- In reroll smoke, visible chat rows contain `greet me`, `old reply`,
  `rerolled reply`, then `old reply` again after swipe-back.

Coverage map:

- Use `@vitest/coverage-v8` as a mapping tool for `src/lib/ChatScreens`,
  `src/lib/Others`, `src/lib/SideBars`, and `src/ts/server`.
- Produce text, JSON summary, and HTML reports under `coverage/ui-map`.
- Do not add threshold gates during this phase.

## Invariants

- Prefer `pnpm smoke:fastify-browser` over direct Playwright config runs because
  the specs serve built `dist`.
- Direct `playwright test -c playwright.fastify-smoke.config.ts` must be
  preceded by `pnpm build:site`.
- Keep browser checks semantic and fixture-text based.
- Add a helper such as `waitForActiveChatHydrated()` only if direct locator
  assertions prove flaky.

## Done Criteria

- Existing smoke specs include visible assertions without becoming broad UI
  automation.
- Coverage-map command/profile is documented or scripted.
- Status and latest verification are updated.

## Validation

```bash
pnpm smoke:fastify-browser
pnpm exec vitest run \
  src/lib/Others/GridCatalog.svelte.test.ts \
  src/lib/Others/ChatList.svelte.test.ts \
  src/lib/SideBars/SideChatList.svelte.test.ts \
  src/lib/SideBars/Sidebar.charList.test.ts \
  src/lib/ChatScreens/ChatBody.svelte.test.ts \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts \
  --coverage \
  --coverage.provider=v8 \
  --coverage.reportsDirectory=coverage/ui-map \
  --coverage.reporter=text \
  --coverage.reporter=json-summary
```
