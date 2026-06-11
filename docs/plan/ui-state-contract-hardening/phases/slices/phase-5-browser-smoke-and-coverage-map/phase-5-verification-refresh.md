# Slice: Phase 5 Verification Refresh

Phase: [5](../../phase-5-browser-smoke-and-coverage-map.md). No runtime change.

Status: planned. Depends on
[`fastify-smoke-visible-assertions.md`](fastify-smoke-visible-assertions.md) and
[`coverage-map-profile.md`](coverage-map-profile.md).

## Scope

Refresh Phase 5 proof after visible smoke and coverage-map slices land.

## Anchors

- `docs/plan/ui-state-contract-hardening/status.md`
- `docs/plan/ui-state-contract-hardening/latest-verification.md`
- `server/fastify/browser-smoke/`
- `coverage/ui-map`

## Target Shape

- `latest-verification.md` records browser smoke and coverage-map results.
- The coverage proof records report formats and output location.
- Any generated artifacts are ignored or cleaned up according to the Phase 5
  artifact policy.

## Invariants

- Do not claim HTML output unless the command actually generates it.
- Do not claim coverage thresholds.

## Done Criteria

- Browser smoke passes with visible assertions.
- Coverage-map command passes and produces expected reporters.

## Validation

```bash
pnpm smoke:fastify-browser
pnpm coverage:ui-map
git diff --check
```
