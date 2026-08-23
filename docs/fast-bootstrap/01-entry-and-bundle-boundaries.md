# Phase 1: Entry and Bundle Boundaries

## Outcome

Make the initial browser graph contain only environment setup, the minimal shell,
and startup orchestration. Optional screens and feature implementations must be
downloaded on first use rather than preloaded by `index.html`.

This phase begins after [Phase 0](00-measurement-and-budgets.md) and may run in
parallel with [Phase 2](02-thin-character-summaries.md).

## Current owners

- Entry composition: `src/main.ts` and `index.html`
- Polyfills: `src/ts/polyfill.ts`
- Root UI: `src/App.svelte`
- URL parsing and route application: `src/ts/router.ts`
- Root stores: `src/ts/stores.svelte.ts` and `src/ts/stores/coreStores.svelte.ts`
- Export writer: `src/ts/globalApi.svelte.ts`
- Build grouping: `vite.config.ts`

## Review slices

### 1A. Entry and conditional polyfills

- [ ] Reduce `src/main.ts` to essential environment setup, shell mount, and a
  lightweight startup call.
- [ ] Replace the blanket `core-js/actual` import with targeted feature checks
  based on the supported-browser policy.
- [ ] Keep `safeStructuredClone` and other required globals available without
  eagerly importing unrelated runtime code.
- [ ] Dynamically import stream ponyfills only when native stream constructors
  are absent.
- [ ] Dynamically import mobile drag/drop only on affected platforms and verify
  that initialization still occurs before the first supported drag action.
- [ ] Capture the preload report before and after the slice.

### 1B. Lazy root UI and route handlers

- [ ] Introduce recoverable lazy boundaries for settings, character/grid editors,
  Playground, import/export tools, and modal families currently imported by
  `src/App.svelte`.
- [ ] Keep the loading/error surface accessible and route chunk-load errors
  through localized retry messaging.
- [ ] Separate lightweight URL classification from persistence-capable route
  application in `src/ts/router.ts`.
- [ ] Dynamically load character, persona, Playground, settings, and chat route
  handlers only for matching routes.
- [ ] Add first-open tests for every lazy route and modal family, including CSS,
  focus restoration, no transient blank screen, and offline/stale chunk failure.

### 1C. Store and global API dependency cleanup

- [ ] Move shell-safe stores and types behind a small dependency root. Importing
  `loadedStore` or its Phase 3 replacement must not pull database, scripts,
  modules, character-card, chat-command, or complete resource-state code.
- [ ] Update consumers incrementally; prevent a compatibility re-export from
  recreating the original eager graph.
- [ ] Remove the static `streamsaver` import and load it inside the `LocalWriter`
  path only when a streamed download starts.
- [ ] Inspect every Vite static-plus-dynamic warning and remove the static path
  that defeats the lazy boundary.
- [ ] Add focused download and store-effect tests for the moved boundaries.

### 1D. Final grouping and enforcement

- [ ] Inspect the clean generated graph before adding `manualChunks`.
- [ ] Add only a few behavior-oriented manual groups when they improve stable
  caching or prevent accidental merging; document why each group exists.
- [ ] Make unexplained static-plus-dynamic warnings and Phase 0 budget failures
  block CI.
- [ ] Confirm no optional screen, export implementation, or full database graph
  remains in the initial preload set.
- [ ] Consider self-hosted fonts or lazy noncritical KaTeX CSS only after
  JavaScript is no longer the dominant startup cost.

## Verification per slice

- `pnpm build` plus the Phase 0 preload report.
- Owning frontend/DOM tests, including `src/ts/router.test.ts`,
  `src/App.routeEffect.dom.test.ts`, store tests, and
  `src/ts/globalApi.downloadFile.test.ts` as applicable.
- Targeted `pnpm smoke:fastify-browser` coverage for each first-open surface.
- `pnpm test:affected` before handoff.

Record a before/after preload graph for every slice. A reduction in chunk count
is not sufficient if total evaluated bytes grow or an on-demand route becomes
unrecoverable offline.

## Rollback

Each slice must remain independently revertible. Do not combine final manual
chunk grouping with the import-boundary changes it is meant to measure.

## Exit gate

- The ratified initial JavaScript and largest-chunk budgets pass.
- No optional screen or export implementation is in the entry graph.
- Every lazy surface has a tested first-open and recoverable failure state.
- There are no unexplained static-plus-dynamic import warnings.
