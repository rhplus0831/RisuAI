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

- [x] Reduce `src/main.ts` to essential environment setup, shell mount, and a
  lightweight startup call.
- [x] Replace the blanket `core-js/actual` import with targeted feature checks
  based on the supported-browser policy.
- [x] Keep `safeStructuredClone` and other required globals available without
  eagerly importing unrelated runtime code.
- [x] Dynamically import stream ponyfills only when native stream constructors
  are absent.
- [x] Dynamically import mobile drag/drop only on affected platforms and verify
  that initialization still occurs before the first supported drag action.
- [x] Capture the preload report before and after the slice.

### 1A measurement (2026-08-24)

| Measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| Initial preload files | 25 | 11 | -14 |
| Initial JavaScript gzip | 1,632,865 bytes | 316,644 bytes | -80.6% |
| Largest initial chunk gzip | 668,643 bytes | 283,335 bytes | -57.6% |
| Cold startup JavaScript transfer | 1,630,413 bytes | 1,545,220 bytes | -5.2% |

The preload boundary now passes the 900/500 KiB milestone targets, but the cold
transfer comparison is the honest current runtime reduction. `appStartup` is
requested immediately after environment setup and still contains the full root
UI/database graph. Slices 1B and 1C must make those implementations truly
on-demand before the Phase 1 exit gate can pass; the preload result alone is not
treated as completion.

### 1B. Lazy root UI and route handlers

- [x] Introduce recoverable lazy boundaries for settings, character/grid editors,
  Playground, import/export tools, and modal families currently imported by
  `src/App.svelte`.
- [x] Keep the loading/error surface accessible and route chunk-load errors
  through localized retry messaging.
- [x] Separate lightweight URL classification from persistence-capable route
  application in `src/ts/router.ts`.
- [x] Dynamically load character, persona, Playground, settings, and chat route
  handlers only for matching routes.
- [ ] Add first-open tests for every lazy route and modal family, including CSS,
  focus restoration, no transient blank screen, and offline/stale chunk failure.

### 1B implementation measurement (2026-08-24)

| Measure | After 1A | 1B implementation | Change |
| --- | ---: | ---: | ---: |
| Initial preload files | 11 | 11 | 0 |
| Initial JavaScript gzip | 316,644 bytes | 317,810 bytes | +0.4% |
| Largest initial chunk gzip | 283,335 bytes | 283,335 bytes | 0% |
| Cold startup JavaScript transfer | 1,545,220 bytes | 1,320,987 bytes | -14.5% |
| Root `appStartup` chunk raw | 1,759,397 bytes | 234,580 bytes | -86.7% |

The initial preload result remains nearly flat because `appStartup` was already
requested dynamically after environment setup. The cold transfer and root chunk
measurements show the actual effect: settings pages, Grid, Playground tools,
character-editor panels, App-owned modal families, chat/module dialogs, and file
transfer implementations now have first-use entry chunks. URL classification is
owned by `routerRoute.ts`; persistence-capable settings, persona, Playground,
character, and chat application lives behind route-specific dynamic handlers.

The reusable lazy host has focused pending, failure, retry, stale-attempt, and
modal focus-restoration coverage. The final 1B test checkbox remains open until
the production-browser first-open matrix covers every registered family and
intercepts real emitted JavaScript/CSS for offline and stale-chunk failures.

### 1C. Store and global API dependency cleanup

- [x] Move shell-safe stores and types behind a small dependency root. Importing
  `loadedStore` or its Phase 3 replacement must not pull database, scripts,
  modules, character-card, chat-command, or complete resource-state code.
- [x] Update consumers incrementally; prevent a compatibility re-export from
  recreating the original eager graph.
- [x] Remove the static `streamsaver` import and load it inside the `LocalWriter`
  path only when a streamed download starts.
- [ ] Inspect every Vite static-plus-dynamic warning and remove the static path
  that defeats the lazy boundary.
- [x] Add focused download and store-effect tests for the moved boundaries.

### 1C store-boundary measurement (2026-08-24)

| Measure | After 1B | Store boundary | Change |
| --- | ---: | ---: | ---: |
| Initial preload files | 11 | 12 | +1 |
| Initial JavaScript gzip | 317,814 bytes | 318,269 bytes | +0.1% |
| Largest initial chunk gzip | 283,335 bytes | 283,335 bytes | 0% |
| Full database chunk raw | 2,199.21 kB | 1,850.14 kB | -15.9% |
| Full database chunk gzip | 650.07 kB | 549.99 kB | -15.4% |
| Ineffective dynamic-import warnings | 13 | 12 | -1 |

The new 323-byte raw `coreStores` preload keeps shell readiness and selection on
a stable singleton without evaluating persistence or feature implementations.
The compatibility store module no longer installs resource/module effects or
imports database, scripts, modules, character cards, chat commands, or complete
resource state. Bootstrap now installs those runtime effects explicitly after
loaded state and the selected character are published. The slight preload
increase buys a reusable stable root; the meaningful graph reduction is the
roughly 100 kB gzip removed from the full database cycle.

### 1C streamed-download measurement (2026-08-24)

| Measure | Store boundary | Lazy StreamSaver | Change |
| --- | ---: | ---: | ---: |
| Initial preload files | 12 | 12 | 0 |
| Initial JavaScript gzip | 318,269 bytes | 318,260 bytes | effectively flat |
| Full database chunk raw | 1,850.14 kB | 1,846.58 kB | -3.56 kB |
| Full database chunk gzip | 549.99 kB | 548.71 kB | -1.28 kB |
| First-use StreamSaver chunk raw | included above | 3,846 bytes | deferred |
| First-use StreamSaver chunk gzip | included above | 1,761 bytes | deferred |

Importing `globalApi`, using ordinary object-URL downloads, and constructing a
`LocalWriter` no longer evaluates StreamSaver. The first `LocalWriter.init()`
loads the dedicated chunk; subsequent streamed downloads reuse the loaded module
while creating independent writable streams.

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
