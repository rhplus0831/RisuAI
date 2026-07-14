# Phase 8: Verification Budgets

Status: implemented.

Goal: turn protocol measurements into maintained request, payload, timing, and
latest-verification gates.

## Source Anchors

- [`../../../AUDIT.md`](../audits/fastify-side-effect-audit.md)
- `server/fastify/src/protocolMetrics.ts`
- `src/ts/server/protocolDiagnostics.ts`
- `server/fastify/__tests__/`
- `src/ts/server/`
- `util/client-thinning-audit.ts`

## Slices

- [`request-count-budgets.md`](slices/phase-8-verification-budgets/request-count-budgets.md) -
  implemented
- [`payload-size-budgets.md`](slices/phase-8-verification-budgets/payload-size-budgets.md) -
  implemented
- [`command-metric-thresholds.md`](slices/phase-8-verification-budgets/command-metric-thresholds.md) -
  implemented
- [`latest-verification-log.md`](slices/phase-8-verification-budgets/latest-verification-log.md) -
  implemented

## Exit Criteria

- Tests or diagnostics can catch request-count regressions in hot workflows.
  All-chat and all-character-lorebook hydration are covered.
- Bootstrap/projection/import/export payload sizes have documented budgets.
  Bootstrap and targeted projection are covered; import/export are documented as
  large-payload flows.
- Command mutation metrics have review gates for hot families.
- The latest verification result is recorded in one maintained location:
  [`../latest-verification.md`](../latest-verification.md).

## Validation

- Budget tests introduced by this phase.
- `pnpm api:test`
- `pnpm test`
- `pnpm client-thinning:audit`
