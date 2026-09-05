# Phase 1: Baselines and Acceptance Budgets

Findings: F02–F10. Dependency: Phase 0 accepted. Progress and decisions belong
in [status.md](../status.md).

## Objective

Make each remaining optimization comparable and falsifiable using current
fixtures and instrumentation. Establish only the measurements needed for these
findings; do not build a general observability framework.

## Existing Foundations

- [Development and observability](../../../../docs/structure/development-and-observability.md),
  [test workflow](../../../../docs/tests/README.md), and the
  [prior mutation-range baseline](../../../protocol-and-persistence/mutation-range-narrowing/phases/phase-0-baseline-foundations.md).
- `server/fastify/src/protocolMetrics.ts` and
  `server/fastify/__tests__/helpers/commandMetricGates.ts`.
- `src/ts/__tests__/renderCostHarness.ts`,
  `src/ts/__tests__/sendCloneCountProbe.ts`, `util/initial-preload-report.ts`,
  and `util/bundle-boundary-report.ts`.
- `server/fastify/browser-smoke/startupCachePopulationMatrix.spec.ts` and
  `server/fastify/browser-smoke/chatStartupRendering.spec.ts`.

## Measurement Matrix

| Finding | Controlled fixture dimensions | Primary evidence |
| --- | --- | --- |
| F02 | Fixed target chat; increasing unrelated characters, chat metadata, modules, presets, and assets; separately increasing target history | SQL/read scope, serialized/cloned bytes and count, preflight versus assembly CPU/allocation |
| F03 | Fixed target folder; increasing unrelated resident characters and hydrated histories | Snapshot scope, clone count/bytes, unrelated message identity, failed/queued rollback behavior |
| F04 | Same resource response; small versus populated cache, cold/warm entries, burst reads | Prune count, IndexedDB enumerations, resource completion ordering, cache size after maintenance |
| F05 | Mutable and immutable intents; small, large, multi-request, near-limit payloads | Normalization/clone count, bytes processed, staging time, snapshot ownership |
| F06 | Identical production build; English and selected non-English startup | Initial and immediate-startup closures, unused locale membership, first-ready behavior |
| F07 | Increasing synthetic asset file count/bytes and reference corpus; backup/GC with a concurrent lightweight API request | Event-loop delay, API response progress, copy/scan duration, memory, correctness under interleaving |
| F08 | Short/long history; repeatedly loading older rows; variable-height Markdown/media; desktop/mobile | Mounted components/DOM, heap, scroll/layout time, anchor and streaming behavior |
| F09 | Inventory prompt-boundary consumers and accessed settings/extension fields | Narrow-view/type coverage; list of unchecked boundaries and their owners |
| F10 | Current browser/server diagnostics on the same nested definitions | Behavioral parity and consumer/import ownership |

Keep synthetic fixtures deterministic and record their exact dimensions. Choose
small and large cases plus an intermediate scaling point; do not manufacture
production representativeness without evidence. Include a low-resource browser
profile where it changes the UI decision, and label it as a simulation.

## Acceptance Policy

1. Record source anchor, runtime/browser versions, hardware/CPU throttling,
   fixture sizes, warmup, repetitions, and cache state. Run timing probes in
   isolation; concurrency with builds or research workers invalidates comparisons.
2. Separate preflight, provider wait, assembly, rendering, and persistence timing.
   Use stubbed providers for deterministic local measurements; no paid provider
   requests or production data are required.
3. Set numeric budgets before optimizing the relevant phase, based on the
   measured baseline and intended supported fixture envelope. Prefer stable work
   counters as CI gates; use enough timing samples to expose noise.
4. For F08 record the mounted-row/time/memory conditions that justify a bounded
   residency implementation. If those conditions are absent, retain the
   measurement and revisit trigger rather than precommitting to virtualization.
5. Reuse existing test routing and metric helpers. Add a new fixture/probe only
   for an uncovered behavioral or scaling question. Do not weaken existing gates
   or copy stale benchmark numbers from archived work.

## Exit Criteria

- Each finding has a reproducible baseline or an explicit statement that its
  acceptance is structural/type-based rather than timing-based.
- Each performance phase has counters and proposed numeric targets recorded in
  its evidence entry before implementation. F08 has a recorded decision rule.
- Measurements distinguish the required cost from avoidable unrelated work.
- Evidence is tied to source and fixture definitions; temporary paths or a
  passing aggregate alone cannot serve as the baseline.

Run exact existing or newly added probes through the focused runner, and use
`pnpm build:initial-preload` for bundle evidence. Validate completed harness
changes with `pnpm test:agent`. Instrumentation must be test-only or negligible
when disabled; it must not expose payloads/secrets or affect request behavior.
