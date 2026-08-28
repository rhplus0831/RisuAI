# Phase 6: Routing And CI Enforcement

Status: Pending

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
