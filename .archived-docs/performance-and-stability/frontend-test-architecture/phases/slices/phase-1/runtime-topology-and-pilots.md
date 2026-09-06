# Phase 1 Slice: Runtime Topology And Pilots

Status: Complete

## Scope

- Add the `frontend-svelte-node` Vitest project and explicit transitional S
  inventory.
- Retain the conservative Node inventory and Happy-DOM fallback.
- Route only the Phase 0 N/S/D pilots.
- Extend exhaustive/disjoint discovery to all three projects.
- Preserve direct selection, gate, UI-map, affected-test, aggregate, and CI
  command ownership.
- Update the current testing documentation.

## Source Anchors

- `vitest.config.ts` composes the three frontend projects.
- `vitest.svelte-node.config.ts`, `vitest.svelte-node.environment.ts`, and
  `vitest.svelte-node-tests.ts` own the S project, its Node-backed client
  transform, and its explicit migration inventory.
- `vitest.node-tests.ts` remains the N allowlist.
- `vitest.dom.config.ts` remains the D fallback and excludes both explicit
  inventories.
- `vitest.setup.ts` remains shared; `vitest.dom.setup.ts` remains D-only.
- `util/frontend-test-inventory.ts` proves three-project completeness.

## Runtime And Ownership

- `src/ts/parser/sentenceBreaks.test.ts` remains validated in N.
- `src/ts/parser/tests/chatVar.svelte.test.ts` moves from D to S.
- `src/ts/stores.runtimeEffects.svelte.test.ts` passes the S stress probe and
  moves from D to S.
- `src/lib/UI/GUI/CheckInput.svelte.test.ts` retains rendered, focus, keyboard,
  and accessibility proof in D.

The S project uses the Svelte plugin with Node globals and no DOM setup. Vitest's
built-in Node environment selects the SSR Vite transform, which makes client
`$effect` inert, so the project delegates to the Node environment while
selecting Vite's client transform. This preserves client rune semantics without
installing `document`, `window`, Happy-DOM, or the DOM fetch guard.

## Invariants

- The 537-file full universe remains exhaustive and disjoint.
- Standalone ordinary discovery remains 535 files; aggregate ordinary discovery
  remains 529 files.
- Shared clone/readiness/KaTeX setup applies to N/S/D, while the unexpected
  loopback-fetch guard remains exclusive to D.
- Direct pilot selection reports one N, two S, and one D owner without duplicate
  execution.
- Per-file isolation remains enabled.

## Performance Mechanism And Result

Phase 1 establishes capability topology rather than a bulk optimization. Moving
two pilots to S offsets part of the third-project startup cost. Three warm
like-for-like aggregate-ordinary runs produced a 73.07s median wall time
(70.44-75.22s), 1.1% above the 72.30s Phase 0 baseline and within the 5% topology
budget. Median peak RSS was 4,800,148 KiB, 0.3% above baseline and within the 10%
guard.

## Validation

- Focused N/S/D pilots and direct four-file root selection
- Independent `frontend-node`, `frontend-svelte-node`, and `frontend-dom` runs
- `pnpm check:frontend-test-inventory`
- `pnpm test:frontend`
- `pnpm test:frontend:all`
- `pnpm test:gates`
- `pnpm coverage:ui-map`
- `pnpm test:affected --dry-run` and selected lanes
- three warm aggregate-ordinary measurements
- `pnpm test:all --dry-run` and `pnpm test:all`
- `pnpm format:check`
- `git diff --check`

Exact results and the accepted pre-existing display-source batching observation
are in [`../../../latest-verification.md`](../../../latest-verification.md).

## Rollback

Remove the S project/config/environment/inventory, remove it from root
composition and completeness types, stop excluding its files from D, and
regenerate the inventory. Both S pilots then return to the unchanged Happy-DOM
fallback.
