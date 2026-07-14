# Explicit Frontend Performance Gates

This directory contains shared clone-cost helpers plus render-cost and send-path
performance gates. They are useful regression protection, but they are heavier
than ordinary feature tests, so the default frontend lane excludes them.

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
| `cloneCostHarness.ts` | Shared snapshot-shape, rollback, and clone-instrumentation helpers used by focused regression tests across `src/`. |
| `renderCostHarness*.ts` | DOM/render-cost regression probes for GUI reload behavior. |
| `sendCloneCountProbe*.ts` | Send-path clone-count regression probe. |
| `largeCorpusFixture.ts` | Shared large-corpus fixture used by client and server cost regressions. |

Keep new performance gates here. UI audit probes belong in `src/lib/_audit`.
Add a new path to `pnpm test:gates` only if it falls outside those directories
or the existing util audit test.
