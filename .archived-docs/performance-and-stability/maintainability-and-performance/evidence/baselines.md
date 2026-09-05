# Baselines and Acceptance Budgets

Production source: `491cc1820` (Phase 0 accepted). Production code for F02–F10
is unchanged. All fixtures are synthetic; these measurements do not describe
production users. Execution and finding dispositions belong in
[status.md](../status.md).

## Evidence Owners

| Findings | Baseline and numeric budgets | State |
| --- | --- | --- |
| F02, F09 | [Generation preparation and type inventory](generation-baseline.md) | Counters, isolated timings, type inventory accepted |
| F03, F04, F05 | [Browser work](browser-work-baseline.md) | Structural counters accepted |
| F06 | [Locale startup](locale-baseline.md) | Production closures and twelve isolated browser cases accepted |
| F07 | [Maintenance scheduling](maintenance-baseline.md) | Nine isolated asset/corpus samples accepted |
| F08 | [Transcript residency](transcript-baseline.md) | Ten isolated browser cases and measured decision rule accepted |
| F10 | Shared policy below | Structural/behavioral baseline accepted |

## Environment and Measurement Policy

Linux x64; Node 24.19.0; pnpm 11.23.0; AMD Ryzen 9 9950X, ten visible logical
CPUs, 50,509,873,152 bytes reported system memory. Browser reports retain the
Chromium version and throttle settings. A throttled desktop CPU is a simulation,
not a physical mobile device or a low-memory environment.

Structural probes count real live-function work. F03/F04/F05/F09/F10 acceptance
is structural or behavioral; suite runtime is not their latency evidence.
Timing probes run separately from builds, other tests, and research tools.
Production bundle closure accounting and smoke-build browser transfer are
separate comparisons using matched builds on each side.

Each owner records fixtures, repetitions/warmup/cache state, counters, limitations,
and numeric targets before optimization. Captured raw payloads are synthetic;
reports retain counts/timings rather than prompt text or credentials. Generated
per-action logs remain outside this plan.

## F10: Shared Trigger Policy

The two existing implementations have the same SHA-256 digest:
`84e4b4d9d2213d2906cf22d165e0eab3107954276435758a72336209a16077e7`.
`pnpm test -- server/fastify/__tests__/triggerCompatibilityOwnership.test.ts`
passes four cases for ownership, matching literals, exact regex classification,
and stable nested/cyclic diagnostics.

Target: one framework-neutral implementation, two delegating runtime consumers,
zero duplicated effect catalogs/traversals, and unchanged ordered/deduplicated
behavior. This makes no speed claim.
