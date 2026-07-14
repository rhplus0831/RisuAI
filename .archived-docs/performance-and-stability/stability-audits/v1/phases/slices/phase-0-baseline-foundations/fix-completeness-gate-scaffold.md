# Fix-Completeness Gate Scaffold

Status: implemented. Phase 0. No runtime change.

## Scope

Create the Phase 8 gate scaffold: a registry from finding id to phase, status,
and eventual regression test. Seed scheduled ids as `PLANNED` and fail on drift.

## What Landed

`src/ts/__tests__/fixCompletenessGate.test.ts` (8 tests, pure static — no app
harness), the path Phase 8 expects:

- `SCHEDULED_FIXES` — all 56 scheduled ids (`H1`-`H3`, the 14 mediums, the 37
  scheduled lows, `U1`, `U4`). Phase 0 seeded them as
  `{ id, phase, fix, status: 'PLANNED' }`; landed fixes flip their entries to
  `DONE` with repo-root-relative `testPath` values (+ optional `testName`
  containment checks). Server-side gates are referenced by path so this one
  client-suite test asserts their existence.
- `INTENTIONALLY_GATED` (L4, L7, L26, U2) and `NO_ACTION` (U3 + the dismissed
  R1-R5, in the audit's bullet order), each with a reason.
- Self-checks parse the docs rather than trusting the registry:
  - the finding universe is scraped from
    `audit-stability-and-performance.md` (H/M headings, L table rows, U
    bullets) — a new audit id without a registry entry fails, as does a
    double-classified or unknown id;
  - phase routing and gated bullets are mirrored against
    `active-risk-analysis.md` — rerouting a finding in the doc fails the gate
    until the registry follows (and vice versa);
  - status is kept in lockstep: a doc row flipped to `DONE (<commit>)` fails
    until the registry entry is `DONE` with a real test, and vice versa;
  - `collectGateProblems` validates `DONE` entries (existing `testPath`,
    contained `testName`, no test claimed while `PLANNED`) — proven by
    negative cases (missing path, renamed test, pathless DONE, premature
    PLANNED claim) plus a real-path positive control.
- Drift behavior verified by hand: doc-DONE-only, new audit id `L41`, and a
  phase reroute each fail exactly one self-check.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  the full finding universe (`H1`-`H3`, `M1`-`M14`, `L1`-`L40`, `U1`-`U4`, the
  dismissed R-set).
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) - the
  finding -> phase -> status map this gate mirrors.
- `src/ts/__tests__/cloneCostGateCompleteness.test.ts` - the landed
  self-checking gate modeled (scan + assert; `INTENTIONALLY_BROAD` exclusions).

## Behavior / Invariants

- Test-only. At Phase 0 landing every scheduled id was `PLANNED`; later phases
  flip ids to `DONE`. Flipping requires updating BOTH the registry and
  `active-risk-analysis.md` — the lockstep check enforces the pairing.

## Done Criteria

- [x] The gate scaffold exists, enumerates all audit finding ids, and passed at
      Phase 0 landing with everything `PLANNED`.
- [x] The gate fails in a unit test when a `DONE` entry points at a missing
      test (the negative self-proof case).

## Validation

- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts`.
- `pnpm test`, both TypeScript checks.
