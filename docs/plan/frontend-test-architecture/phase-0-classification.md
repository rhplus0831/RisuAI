# Phase 0 Classification And Routing Decision

Date: 2026-08-28

## Ratified Capability Rules

- **N — Node:** no Svelte transformation and no DOM/browser behavior is
  required by the proof.
- **S — Svelte+Node:** Svelte compilation, runes, or stores are required, but
  mounting, rendered state, DOM events, focus, browser navigation, and
  browser-only storage semantics are not.
- **D — Svelte+Happy-DOM:** the contract depends on mounting, rendered output,
  DOM/browser globals, focus/events, history/location, observers,
  accessibility, or browser-shaped integration behavior.
- **B — Built browser:** the contract needs the built SPA, Chromium,
  Fastify/SQLite, reload/direct-link behavior, or a browser lifecycle.

The static classifier records direct evidence and proposes the smallest target
class. It does not authorize a migration. A current Happy-DOM file proposed for
N or S retains a `target-runtime probe required` marker until it passes in that
project without mocking away its contract. Direct-file scanning cannot prove
transitive runtime needs, so negative evidence has medium confidence.

## Recorded Universe

The checked inventory is [`phase-0-inventory.tsv`](phase-0-inventory.tsv). Its
header documents the required per-file fields, including current project,
target class, direct Svelte/DOM and dependency evidence, gate ownership,
blocker, domain, slice, and reason.

| View | Files | Distribution |
| --- | ---: | --- |
| Full frontend Vitest universe | 537 | 126 Node / 411 Happy-DOM |
| Standalone ordinary frontend | 535 | 126 Node / 409 Happy-DOM |
| `test:all` ordinary frontend | 529 | 125 Node / 404 Happy-DOM |
| Browser smoke | 7 | 7 built-browser specs |

The full universe includes two explicit performance-gate files. The standalone
ordinary view excludes those two. The `test:all` ordinary subprocess also
excludes the six UI-map sentinels because the following coverage lane owns them.
The 529-file measurement therefore differs intentionally from the 537-file
classification universe.

The candidate distribution is 174 N, 129 S, 234 D, and 7 B. All 177 proposed
N/S promotions that currently run in Happy-DOM require a target-project probe.

## Completeness Proof

`pnpm check:frontend-test-inventory` independently enumerates frontend test
files under the root, `packages`, `src`, and `util`, then compares that universe
with resolved `vitest list --filesOnly` output. It rejects missing, unexpected,
or multiply assigned files in all three views:

1. gates included and UI-map included;
2. ordinary standalone, with performance gates excluded;
3. aggregate ordinary, with performance gates and UI-map sentinels excluded.

The same command verifies that the committed TSV is byte-for-byte current. Use
`pnpm update:frontend-test-inventory` only when intentionally updating
classification evidence. Browser-smoke `*.spec.ts` files are inventoried as B
but remain outside the Vitest union.

## Routing Decision

Suffix routing is the ratified end state:

- `*.test.ts` defaults to N;
- `*.svelte-node.test.ts` routes to S;
- `*.svelte.test.ts` and `*.dom.test.ts` route to D;
- Playwright `*.spec.ts` routes to B.

The migration uses explicit legacy inventories until default inversion is safe.
Phase 1 adds an explicit S inventory while retaining the Node allowlist and
Happy-DOM fallback. Later slices rename only files whose suffix must express
runtime ownership. Phase 6 may make suffixes authoritative only after the
completeness gate is green, every fallback file is classified, affected-test
routing and coverage agree, and repeated full frontend runs are stable.

The generated Phase 0 TSV is classification evidence, not runtime routing
configuration. This keeps static hints from silently moving a test.

## Setup Boundary

- Every frontend project loads `vitest.setup.ts`: KaTeX mocking,
  `safeStructuredClone`, and the default startup-readiness baseline are shared
  contracts.
- S loads the Svelte Vite plugin with the Node environment and no DOM setup.
  IndexedDB or other browser-shaped dependencies must be installed explicitly
  by the owning test.
- D loads the Svelte plugin, Happy-DOM, shared setup, and
  `vitest.dom.setup.ts`, including the unexpected loopback-fetch guard.
- N does not load the Svelte plugin or Happy-DOM.

## Phase 1 Pilots

| Role | File | Expected project/setup |
| --- | --- | --- |
| Obvious N | `src/ts/parser/sentenceBreaks.test.ts` | Existing Node project and shared setup only. |
| Representative S | `src/ts/parser/tests/chatVar.svelte.test.ts` | Svelte plugin + Node + shared setup; its stores and module fakes are explicit. |
| Retained D | `src/lib/UI/GUI/CheckInput.svelte.test.ts` | Svelte + Happy-DOM + DOM fetch guard; retains rendered, focus, and keyboard assertions. |
| Classifier stress probe | `src/ts/stores.runtimeEffects.svelte.test.ts` | Probe S first; it uses `flushSync` and Svelte runtime modules without a DOM fixture. |

These files are small and avoid persistence-heavy bridges, mega-suites, and
production refactors. The stress probe must remain D if the S project reveals a
real DOM requirement.
