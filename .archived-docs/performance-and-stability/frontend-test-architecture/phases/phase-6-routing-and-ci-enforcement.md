# Phase 6: Routing And CI Enforcement

Status: Complete

## Objective

Make capability ownership explicit and durable for new tests, then align local,
affected, coverage, aggregate, and CI execution with the final topology.

## Scope

- Remove the legacy unclassified-to-Happy-DOM fallback after every legacy file is
  classified.
- Make plain tests Node-default under the ratified convention.
- Route Svelte+Node, Svelte+Happy-DOM, explicit DOM, audit, performance, coverage,
  and Playwright files without overlap.
- Replace or retire the transitional Node/DOM inventories that are no longer
  needed.
- Make the completeness gate fail on unclassified, omitted, duplicate, renamed,
  or stale inventory entries.
- Update `test:affected` routing and conservative runner-change widening.
- Update `test:all` dependencies and resource isolation only when benchmarked.
- Align `.github/workflows/quality.yml` with local lane ownership.
- Update current test and structure documentation.

## Enforcement Rules

- A new test's filename or registered capability must determine its project.
- DOM use is explicit; it is not the fallback for ambiguity.
- A test importing a forbidden capability should fail classification with an
  actionable message where static proof is reliable.
- Static heuristics supplement execution proof; they must not reject legitimate
  dependency-injected tests without an override path.
- Coverage and gate inventories remain separately self-checking where their
  contract requires an exact file map.

## Rollout Gate

Do not invert the default until:

- all current files are classified;
- the project union is exhaustive/disjoint;
- direct-file invocation behaves correctly;
- UI coverage files run exactly once in `test:all`;
- explicit performance gates remain isolated;
- repeated full frontend and affected-test runs are green.

## Exit Criteria

- The legacy fallback and stale inventories are removed or reduced to explicit
  justified exceptions.
- New unclassified or multiply assigned tests fail locally and in CI.
- Package scripts, affected routing, aggregate runner, coverage, and CI agree.
- Current docs describe the final architecture and naming/registration rules.
- Complete local and CI-equivalent verification passes.
- `../status.md` has no unresolved routing or ownership gap.

## Validation

- Completeness/classification gate tests
- Project-by-project frontend runs
- Direct-file invocation probes for every class
- `pnpm test:affected --dry-run` across representative diffs
- `pnpm test:frontend`
- `pnpm test:frontend:all`
- `pnpm test:gates`
- `pnpm coverage:ui-map`
- `pnpm test:all --dry-run`
- `pnpm test:all`
- Workflow YAML parse/check
- `pnpm format:check`
- `git diff --check`

## Result

The Node and Svelte+Node transition allowlists and the unclassified-to-DOM
fallback were retired. Plain `*.test.ts` files now route to Node,
`*.svelte-node.test.ts` routes to Svelte+Node, `.svelte.test.ts` and
`.dom.test.ts` route to Happy-DOM, and 187 already-proven pre-suffix DOM owners
remain in one stale-checked registration. Coverage, performance, and Playwright
ownership remain exact overlays.

The final manifest reports 537 frontend files at 194 N / 17 S / 326 D plus 7
built-browser specs. Independent projects, direct-file probes, affected plans,
standalone ordinary/full frontend, specialized gates, UI coverage, workflow
parsing, formatting, and the complete nine-lane aggregate passed. `test:all`
completed in 3m24.2s with 529 ordinary frontend files / 6,428 tests, 154 server
files / 3,295 passing tests with one skip, 34 browser cases, UI thresholds, and
2 isolated performance files / 6 tests. No routing or ownership gap remains.

The implementation and exact proof are recorded in
[`slices/phase-6/routing-and-ci-enforcement.md`](slices/phase-6/routing-and-ci-enforcement.md)
and [`../latest-verification.md`](../latest-verification.md).
