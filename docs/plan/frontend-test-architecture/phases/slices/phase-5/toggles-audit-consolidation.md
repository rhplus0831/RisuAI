# Phase 5 Slice: Toggles Audit Consolidation

Status: Complete

## Scope

Consolidate the two DOM-first Toggles audit files into
`optimisticTogglePaint.dom.test.ts`. Retain all three grouped-rendering and
optimistic-paint cases, the real `Toggles.svelte` owner, DOM-before-store
classification, deferred command transport, and independent per-test setup and
cleanup.

## Ownership And Invariants

- Grouped preset controls still have to paint a named accordion container.
- Jailbreak and custom checkbox controls still have to paint their optimistic
  state before the deferred command settles.
- Store reads and command bodies remain classification aids after the primary
  DOM assertions; they do not replace visible behavior.
- Every case gets a fresh target, resource database, selected-character state,
  command revision, and component. Teardown drains the deferred command before
  unmounting and clearing globals/state.
- `test:gates:audit`, the ordinary frontend lane, and `test:all` continue to own
  the consolidated file.

## Measurement

| Observation | Files / tests | Vitest | Transform | Setup | Import | Tests | Environment | Wall | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Before | 2 / 3 | 12.14s | 19.03s | 256ms | 23.28s | 105ms | 349ms | 13.17s | 1,452,164 |
| After | 1 / 3 | 10.62s | 8.54s | 87ms | 10.26s | 75ms | 123ms | 11.48s | 1,083,596 |

Focused Vitest improves by 1.52s (12.5%) and measured wall by 1.69s (12.8%).
Summed import falls 55.9%, environment falls 64.8%, and peak RSS falls 25.4%,
which confirms the repeated-file mechanism. Transform work is also lower, but
the phase-level benchmark remains the authority for whole-lane impact.

Full discovery changes from 539 to 538 files, standalone ordinary from 537 to
536, and aggregate ordinary from 531 to 530. Runtime ownership changes by one D
file only; all three tests remain ordinary and audit-gate owned.

## Validation

- Focused consolidated owner: 1 file / 3 tests passed.
- Shuffled test-order runs with seeds 101, 202, and 303 passed with isolation
  and retries disabled.
- Frontend inventory regeneration and the three-view completeness proof passed.
- Prettier and `git diff --check` passed.

## Rollback

Restore `groupedToggleRendering.dom.test.ts`, remove its case and grouped seed
from `optimisticTogglePaint.dom.test.ts`, restore the two-file documentation,
and regenerate the inventory.
