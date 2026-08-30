# Phase 7: Temporary Seams, Verification, And Closeout

Status: queued.

Depends on: Phases 0-6 complete.

## Objective

Resolve temporary aggregate endpoints and rollout aliases, measure the final
owner architecture, synchronize current docs, and prepare the workstream for
archival.

## Required Work

- Remove or permanently classify broad/compatibility resource endpoints,
  including aggregate character reads, with exact consumers and tests.
- Remove or permanently classify observer-shell rollout aliases/overrides and
  other temporary seams.
- Measure startup, shell/route payloads, hydration requests, reactive wakeups,
  cache behavior, and bundle boundaries against recorded baselines.
- Run owner, command, outbox, receipt, invalidation, replay/gap, recovery,
  generation, browser, typecheck, formatting, and documentation gates.
- Update current server-resource, client-runtime, durable-recovery, testing,
  generated/legacy, and domain-ownership docs.
- Refresh `latest-verification.md` at the exact final candidate.

## Safety Contract

Endpoint removal preserves supported compatibility and authoritative-read
recovery. Measurement does not justify event deltas here; any Workstream 4
activation remains a separate measured decision.

## Exit Criteria

- Every closeout criterion in `PLAN.md` has exact evidence.
- Temporary seams are removed or permanently documented with owner, reason, and
  tests.
- Payload/reactivity/startup/bundle measurements meet budgets or have an explicit
  accepted residual.
- Full verification passes and the intact workstream can move to
  `.archived-docs/architecture-and-migration/`.

## Validation

The portfolio verification ladder, including complete frontend/server owning
lanes, Fastify browser smoke, performance/payload reports, both typechecks,
`pnpm test:all`, Prettier, and `git diff --check`.
