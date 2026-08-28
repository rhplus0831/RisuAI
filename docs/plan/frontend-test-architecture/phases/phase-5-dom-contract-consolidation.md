# Phase 5: DOM Contract Consolidation

Status: In Progress

## Progress

- [Baseline and candidate profile](slices/phase-5/baseline-and-candidate-profile.md)
  accounts for every current Happy-DOM owner, records the fresh ordinary-D
  profile, selects three coherent consolidation families, and defines the
  explicit static-source-policy follow-up.
- [Toggles audit consolidation](slices/phase-5/toggles-audit-consolidation.md)
  moves the three grouped and optimistic visible-paint cases under one mounted
  owner and removes one repeated environment/import boundary.
- [Alert component consolidation](slices/phase-5/alert-component-consolidation.md)
  retains all 15 visible dialog contracts under one real-component mount and
  cleanup harness while removing two file boundaries.
- [Provider control consolidation](slices/phase-5/provider-control-consolidation.md)
  retains four Ooba/OpenRouter accessibility cases under one provider-control
  lifecycle while keeping the real inputs under test.
- Next: move the remaining source-string policies out of mixed D suites and
  into one explicitly labeled static Node architecture gate.

## Objective

Make the remaining Happy-DOM suite an intentional set of visible-behavior
contracts and reduce repeated setup/import cost where related tiny files can
share a coherent harness.

## Scope

- Confirm every D file actually proves DOM/browser-shaped behavior.
- Consolidate closely related tiny files only when they share the same component,
  production graph, and lifecycle harness.
- Centralize repeated mount, cleanup, focus, race, and persistence harnesses where
  ownership remains clear.
- Replace incidental source-string assertions with mounted behavior or one
  explicitly labeled static architecture gate.
- Keep optimistic-paint, rollback, accessibility, focus, keyboard/pointer,
  routing, hydration, and visible-state assertions in D or B.
- Split a mega-suite only when scheduling or ownership evidence outweighs the
  additional environment/import cost.

## Non-Goals

- Maximizing the number of merged tests.
- Hiding unrelated behaviors in one enormous file.
- Removing domain-owned edge cases because a shared contract exists elsewhere.
- Relaxing isolation for the full DOM project.

## Consolidation Rule

Prefer consolidation when two or more files:

- import the same expensive production component/graph;
- create the same Happy-DOM fixture and teardown;
- protect adjacent behaviors owned by the same domain;
- remain readable as one behavior-oriented suite.

Do not consolidate merely because files are small.

## Exit Criteria

- Every remaining D file has an explicit visible/browser behavior reason.
- Repeated harnesses targeted by the phase are centralized with ownership tests.
- Consolidated suites retain deterministic cleanup and independent case setup.
- Repeated and shuffled runs find no order coupling.
- UI coverage ownership and thresholds remain valid.
- The phase records file-count, import/environment, wall-time, and memory deltas.
- `../status.md` lists intentional residual mega-suites or repeated harnesses.

## Validation

- Focused DOM suites, repeated and shuffled where supported
- `pnpm coverage:ui-map`
- Complete frontend run
- Relevant Playwright browser smoke
- `pnpm test:affected --dry-run`
- `pnpm test:all`
- `pnpm format:check`
- `git diff --check`
