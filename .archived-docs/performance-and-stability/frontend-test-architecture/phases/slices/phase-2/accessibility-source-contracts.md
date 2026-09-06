# Phase 2 Slice: Accessibility Source Contracts

Status: Complete

## Scope

Promote these existing source-level accessibility contract suites from the
Happy-DOM fallback to the explicit Node inventory without changing their test
bodies or the Svelte components they inspect:

- `src/lib/Others/AccessibleIconActions.test.ts`
- `src/lib/Setting/Pages/BotSettings.accessibility.test.ts`
- `src/lib/Setting/Pages/OtherBotSettings.slider-accessibility.test.ts`

The three files contain 25 tests. They move from D to N ownership. The tests
continue to inspect the production Svelte source text, but they do not compile,
import, mount, or execute those components.

## Source Anchors And Dependencies

- `AccessibleIconActions.test.ts` imports `readFileSync` and `resolve`, reads
  four Svelte sources as UTF-8, and checks their accessible action names.
- `BotSettings.accessibility.test.ts` reads `BotSettings.svelte` once and uses
  string, regular-expression, and source-order assertions for accessible names,
  visibility, pending persistence, model flags, and preset ownership.
- `OtherBotSettings.slider-accessibility.test.ts` reads
  `OtherBotSettings.svelte` once and checks the direct slider count and label
  wiring through source text.
- The suites import only Node filesystem/path APIs and Vitest. They do not
  import a `.svelte` module, use Svelte transforms, access a DOM/browser global,
  perform network or storage work, or depend on DOM setup.
- `vitest.node-tests.ts` is the transitional N ownership inventory;
  `vitest.dom.config.ts` excludes every path in that inventory.
- `phase-0-inventory.tsv` remains generated classification evidence rather
  than routing authority.

## Behavior Invariants

- Standalone icon buttons retain names for parameter, color-scheme, prompt-diff,
  home, Patreon, email, and fullscreen actions.
- Bot settings retain names for direct icon, slider, text, textarea, number,
  select, and secret controls; model-section slider counts and unique names
  remain pinned.
- Additional-parameter visibility, prompt-draft flushing, prompt-template
  structural mutation ordering, Claude xhigh capability exposure, and preset
  regex ownership retain their existing source-policy assertions.
- Other bot settings retain nine directly named sliders and the per-LoRA label
  wiring.
- No rendered accessibility or DOM contract changes ownership. Existing mounted
  component suites remain in D.
- The 537-file full universe, 535-file standalone ordinary universe, and
  529-file aggregate ordinary universe remain exhaustive and disjoint.

## Performance Mechanism And Result

The files no longer start Happy-DOM or load `vitest.dom.setup.ts`. Their focused
run changed from 1.13s wall / 351ms Vitest / 397,384 KiB peak RSS / 473ms
aggregate environment time in D to 0.93s / 188ms / 298,708 KiB / 0ms in N.

A paired same-host ordinary run kept 529 files and 6,413 tests while moving the
distribution from 131 N / 2 S / 396 D to 134 N / 2 S / 393 D. Wall time changed
from 72.99s to 72.03s (-0.96s, -1.3%), Vitest duration changed from 72.15s to
71.19s, and peak RSS changed from 4,784,700 KiB to 4,919,184 KiB (+2.8%). The
small RSS movement is within observed ordinary-lane variability and is not a
material regression; the paired DOM project fell from 67.74s to 66.68s while
the Node project remained effectively flat at 4.56s to 4.53s.

This is a single paired slice observation, not a phase-level timing claim. The
Phase 0 three-run median remains the comparison baseline until the next
phase-level measurement gate.

## Validation

- The pre-promotion focused Happy-DOM run passed 3 files / 25 tests.
- The focused `frontend-node` probe passed 3 files / 25 tests with no aggregate
  environment time.
- `pnpm check:frontend-test-inventory` proved full ownership at 135 N / 2 S /
  400 D, standalone ordinary ownership at 135 N / 2 S / 398 D, and aggregate
  ordinary ownership at 134 N / 2 S / 393 D.
- Complete standalone Node and DOM project runs, `pnpm test:frontend`, the
  selected affected-test plan, formatting, and `git diff --check` passed.
- No production, setup, coverage-map, CI, rendered UI contract, or browser-smoke
  file changed, so the periodic Phase 2 `test:all` checkpoint remains satisfied
  by the preceding test-runtime-tooling slice.

Exact commands, resource observations, and cumulative Phase 2 counts are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Done Criteria

- All three target-project probes and repeated owning-run executions pass.
- The generated inventory removes all three target-N probe markers.
- File and test totals are unchanged, and rendered accessibility contracts
  remain in D.
- The paired ordinary lane does not materially regress.

## Rollback

Remove the three paths from `vitest.node-tests.ts` and regenerate
`phase-0-inventory.tsv`. The existing DOM fallback will resume ownership; no
production, test-body, component, or setup rollback is required.
