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
- [x] Add first-open tests for every lazy route and modal family, including CSS,
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
modal focus-restoration coverage. The production-browser matrix now uses a
smoke-only Vite asset manifest to account for all 59 registered first-use
entries without hard-coding chunk hashes. It opens all 22 Settings route states,
all 13 Playground tool routes, Grid, character/sidebar panels, chat dialogs, and
the App-owned modal host against the real Fastify-served production build.

The matrix delays emitted JavaScript and CSS separately, proves the shell never
goes blank, checks applied lazy CSS, and verifies modal focus containment and
opener restoration. Offline JavaScript and stale CSS failures remain local to
their lazy owner and recover through route-preserving reload when Chromium's
module map has cached a failed hashed entry. The global `vite:preloadError`
listener now prevents default only while the entry preloader exists; after the
shell mounts, the owning lazy promise is allowed to reject into its localized
recovery surface.

### 1B production-browser verification measurement (2026-08-24)

| Measure | Before matrix | First-open matrix | Change |
| --- | ---: | ---: | ---: |
| Registered first-use entries covered | ad hoc | 59 | enforced by smoke manifest |
| Initial preload files | 12 | 12 | 0 |
| Initial JavaScript gzip | 318,199 bytes | 318,211 bytes | +12 bytes |
| Largest initial chunk gzip | 283,335 bytes | 283,335 bytes | 0 |

The manifest is emitted only by `build:smoke`; ordinary production output and
its preload membership are unchanged apart from the small entry error-boundary
fix. `lazyFirstOpen.spec.ts` runs seven bounded Chromium cases rather than
one browser case per component, while its manifest inventory makes a newly
registered lazy entry fail until it is classified and covered.

### 1C. Store and global API dependency cleanup

- [x] Move shell-safe stores and types behind a small dependency root. Importing
  `loadedStore` or its Phase 3 replacement must not pull database, scripts,
  modules, character-card, chat-command, or complete resource-state code.
- [x] Update consumers incrementally; prevent a compatibility re-export from
  recreating the original eager graph.
- [x] Remove the static `streamsaver` import and load it inside the `LocalWriter`
  path only when a streamed download starts.
- [x] Inspect every Vite static-plus-dynamic warning and remove the static path
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

### 1C redundant dynamic-import cleanup (2026-08-24)

| Measure | Lazy StreamSaver | Redundant imports removed | Change |
| --- | ---: | ---: | ---: |
| Initial preload files | 12 | 12 | 0 |
| Initial JavaScript gzip | 318,260 bytes | 318,215 bytes | effectively flat |
| Largest initial chunk gzip | 283,335 bytes | 283,335 bytes | 0% |
| Ineffective dynamic-import warnings | 12 | 9 | -3 |

The `filePicker`, prompt-template hydration, and active-chat generation-settings
implementations already had unavoidable static owners in the startup/chat graph.
Their local dynamic imports could not create first-use chunks and only obscured
evaluation order, so those call sites now use the existing static dependency.
The remaining warnings are concentrated in character actions and generation
recovery and still require explicit ownership cleanup.

### 1C action and recovery import cleanup (2026-08-24)

| Measure | Redundant imports removed | Action/recovery cleanup | Change |
| --- | ---: | ---: | ---: |
| Initial preload files | 12 | 12 | 0 |
| Initial JavaScript gzip | 318,215 bytes | 318,201 bytes | effectively flat |
| Largest initial chunk gzip | 283,335 bytes | 283,335 bytes | 0% |
| Ineffective dynamic-import warnings | 9 | 5 | -4 |

Character actions, terminal error targeting, reattach-state access, and server
asset helpers now use their existing static owners directly. Static conversion
of bootstrap/hydration imports widened real initialization cycles, so those
changes were rolled back. The remaining five warnings are the core generation
runtime cycle: operations, hydration, transport, orchestration, and recovered
effects. They require a runtime-bridge split to remove evaluation-order deferral
without eagerly importing the implementations.

### 1C generation runtime bridge (2026-08-24)

| Measure | Action/recovery cleanup | Runtime bridge | Change |
| --- | ---: | ---: | ---: |
| Initial preload files | 12 | 12 | 0 |
| Initial JavaScript gzip | 318,201 bytes | 318,199 bytes | effectively flat |
| Largest initial chunk gzip | 283,335 bytes | 283,335 bytes | 0% |
| Ineffective dynamic-import warnings | 5 | 0 | -5 |

A lightweight generation runtime bridge, with type-only references to its
implementations, now owns capability registration for operations, hydration,
transport, orchestration, and recovered effects. Their existing static
production owners register implementations during module evaluation;
cycle-deferring callers read the registered capabilities without importing back
through the strongly connected component. Missing registration fails loudly,
and focused tests cover registration, recovery, writer takeover, hydration,
operations, and transport. The reattach path retains an explicit microtask
boundary so a same-turn chat switch still wins before a projected job is
consumed.

### 1D. Final grouping and enforcement

- [x] Inspect the clean generated graph before adding `manualChunks`.
- [x] Add manual groups only when they improve stable caching or prevent
  accidental merging; document the no-group decision when none qualify.
- [x] Make unexplained static-plus-dynamic warnings and the current Phase 0
  regression ceilings block the local build-report command.
- [x] Ratify the 900/500 KiB Phase 0 milestone budgets from five reproducible
  clean local production builds, then promote them from report-only targets to
  hard gates.
- [x] Confirm no optional screen, export implementation, or full database graph
  remains in the initial preload set.
- [x] Consider self-hosted fonts or lazy noncritical KaTeX CSS only after
  JavaScript is no longer the dominant startup cost.

### 1D generated-graph decision (2026-08-24)

| Measure | Clean automatic graph |
| --- | ---: |
| Generated JavaScript chunks | 367 |
| Initial static files | 12 |
| Initial static modules | 216 |
| Initial JavaScript gzip | 318,211 bytes |
| Largest initial chunk gzip | 283,335 bytes |
| Immediate `appStartup` files | 99 |
| Immediate `appStartup` modules | 1,026 |
| Immediate `appStartup` gzip | 1,294,302 bytes |
| Ineffective dynamic-import warnings | 0 |
| Manual chunk groups | 0 |

The generated graph was inspected before changing Vite grouping. Rolldown's
automatic graph already preserves the behavior boundaries created in 1A-1C:
route and modal facades remain dynamic entries, while very large WebLLM,
tokenizer, Monaco, transformer, and token-data payloads remain outside the
initial closure. No manual group demonstrated a caching or boundary improvement,
so `manualChunks` remains unset. Grouping those packages by name would create a
second source of ownership that could merge unrelated first-use paths or make a
future static dependency look harmless.

`build:initial-preload` now emits a module-level graph as JSON and text, compares
the entry's computed static closure with the module entry/preloads actually
written to `index.html`, and fails when they differ. The same gate rejects the
registered optional surfaces, export implementations, StreamSaver, or the full
database implementation if any enter that closure. The current graph has no
such violations.

Every production build also treats Rolldown's structured
`INEFFECTIVE_DYNAMIC_IMPORT` diagnostic as fatal. There are no exceptions. A
future intentional exception must name the exact imported module and complete
importer set and include a reason, so it cannot hide a new static owner.

The Phase 0 local calibration ran five clean production builds from the same
source revision on 2026-08-24. All five measured 318,246 total gzip bytes and a
283,372-byte largest chunk, for zero observed variance. The 900/500 KiB targets
are therefore hard gates in `build:initial-preload`; the historical
1,650,000/675,000-byte regression ceilings remain visible for baseline context.

JavaScript is still the dominant measured initial resource at 318,211 bytes
gzip, compared with 20,878 bytes gzip for the emitted application stylesheet.
The externally hosted KaTeX stylesheet and decorative Google fonts are therefore
left unchanged in this slice. Revisit self-hosting or lazy stylesheet loading
with resource-timing evidence after the JavaScript startup work, since changing
them now would add font-swap, offline, and equation-layout behavior without
addressing the dominant cost.

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
