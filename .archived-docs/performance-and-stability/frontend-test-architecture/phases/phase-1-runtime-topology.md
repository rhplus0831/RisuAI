# Phase 1: Runtime Topology

Status: Complete

## Objective

Introduce an exhaustive three-project frontend topology and prove it with a
small representative pilot before broad migration.

## Scope

- Add a `frontend-svelte-node` Vitest project using the Svelte plugin and Node
  environment.
- Keep `frontend-node` for tests requiring neither Svelte transformation nor DOM.
- Keep `frontend-dom` for Happy-DOM/component/browser-shaped contracts.
- Split shared, Svelte-only, and DOM-only setup so each project loads only its
  required contract.
- Preserve aliases, browser resolve conditions where required, focused-test
  rejection, performance gate routing, and UI coverage exclusions.
- Land the exhaustive/disjoint discovery gate against all three projects.
- Migrate only the Phase 0 pilot files.
- Update runner configuration tests and current test documentation.

## Invariants

- The ordinary frontend command runs every prior file exactly once.
- Setup behavior such as `safeStructuredClone`, startup readiness, KaTeX mocks,
  and unexpected DOM fetch rejection remains available where its tests require
  it.
- Adding a third project does not silently duplicate transforms or execute a
  filtered file in multiple projects.
- DOM pilot assertions still use Happy-DOM; S pilot files contain no DOM-shaped
  proof.
- The topology retains isolation and performs no unmocked external requests.

## Decision Gate

Compare the pilot topology with the Phase 0 baseline. If third-project startup
or duplicated plugin work erases the expected benefit, investigate configuration
before Phase 2. Do not begin bulk promotion on an unstable topology.

## Exit Criteria

- Three named projects run independently and through the root command.
- Project inventories are exhaustive and disjoint.
- Representative N, S, and D pilots pass in their intended projects.
- Direct-file invocation, affected-test selection, explicit gates, UI-map
  exclusion, and standalone frontend behavior remain correct.
- Repeated frontend runs show no new flakiness, leaked handles, or unexpected
  network.
- The topology adds no more than 5% median wall time before bulk migration, or an
  accepted measured reason is recorded.
- Current docs and `../status.md` describe the landed topology.

## Validation

- Focused pilot files in each project
- Project-by-project Vitest runs
- `pnpm test:frontend`
- `pnpm test:frontend:all`
- `pnpm test:gates`
- `pnpm coverage:ui-map`
- `pnpm test:affected --dry-run`
- `pnpm test:all`
- `pnpm format:check`
- `git diff --check`
