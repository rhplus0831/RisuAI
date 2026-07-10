# Explicit Frontend Gates

This directory contains static completeness, clone-cost, render-cost, and
send-path cost gates. They are useful regression protection, but they are
heavier and more brittle than ordinary feature tests, so the default frontend
lane excludes them.

Run them explicitly with:

```sh
pnpm test:gates
```

Run the full root/browser Vitest lane, including these gates, with:

```sh
pnpm test:frontend:all
```

## Ownership

| Files | Purpose |
| --- | --- |
| `fixCompletenessGate*.test.ts` | Static proof that scheduled audit fixes still have regression coverage; these parse the v1-v3 archived stability/performance audit and risk Markdown as live fixtures. |
| `cloneCostGateCompleteness.test.ts` | Static proof that clone-cost gates remain registered for narrowed hot paths. |
| `cloneCostHarness.ts` | Shared snapshot-shape, rollback, and clone-instrumentation helpers used by registered gates across `src/`. |
| `renderCostHarness*.ts`, `renderCountBaseline.test.ts` | DOM/render-cost regression probes for GUI reload behavior. |
| `sendCloneCountProbe*.ts` | Send-path clone-count regression probe. |
| `largeCorpusFixture*.ts` | Shared large-corpus fixture and sanity coverage used by cost gates. |

Keep new static or perf/completeness gates here. UI audit probes belong in
`src/lib/_audit`. Add a new path to `pnpm test:gates` only if it falls outside
those directories or the existing util audit test.
