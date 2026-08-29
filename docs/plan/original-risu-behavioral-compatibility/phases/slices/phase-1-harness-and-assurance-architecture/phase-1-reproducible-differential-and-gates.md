# Phase 1 Slice — Reproducible Differential And Gates

Status: In progress
Phase: [Phase 1](../../phase-1-harness-and-assurance-architecture.md)
Opened from Fastify: `9ea7aa20dd5a93ac7e5c9112e8c8fbcb9fca1438`

## Outcome

Turn the Phase 0 local proof into a closed-world assurance lane whose cases,
normalizers, expected differences, fixture provenance, affected selection,
automation cadence, artifacts, and release ownership fail closed.

## Exact Inputs And Owners

- Baseline preparation and preflight: `util/compat-baseline.ts` and
  `util/compat-baseline.test.ts`.
- Differential runners, case registry, result contract, goldens, and comparisons:
  `test/compat-harness/`.
- Register authority: `inventory/*.json`, `findings/*.json`, and
  `util/validate-original-risu-compatibility-registers.ts`.
- Local/aggregate selection: `util/affected-tests.ts`, `util/test-all.ts`, and
  `package.json`.
- Automation and release ownership: `.github/workflows/`, `docs/tests/`, and the
  active planning/verification records.

## Work Packages

1. Classify every harness case, golden, normalizer, and expected difference;
   require stable inventory and signed-decision ownership for exceptions.
2. Make baseline/current runners emit the same semantic result schema and add
   adversarial mutations proving semantic fields cannot normalize away.
3. Record fixture provenance and make golden updates an explicit reviewed action
   instead of an incidental test side effect.
4. Verify affected-path, aggregate, CI, nightly, artifact, and release ownership;
   add the smallest missing structural gates and documentation.
5. Run current-only, full pinned differential, mutation, affected, aggregate,
   formatting, and integrity checks.

## Stop And Escalate

- A current expected difference lacks an individually signed decision.
- A case has no exact production owner or uses an unverifiable source artifact.
- Automation needs credentials, infrastructure, or release authority outside
  this repository.
- A deliberate semantic mutation survives every applicable comparison.

## Handoff

Phase 1 closes only when a clean checkout can prepare and run the pinned lane,
every exception is owned, deliberate semantic mutations fail, local and CI
selection are tested, and the first domain slice can consume the shared evidence
contract without inventing new normalization or authority.
