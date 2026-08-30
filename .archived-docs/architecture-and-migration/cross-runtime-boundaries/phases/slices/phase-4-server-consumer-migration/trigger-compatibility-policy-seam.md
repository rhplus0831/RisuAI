# Trigger-Compatibility Policy Seam

Status: complete at `68d41f2cd` with parity proof at `75b0f6278`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: Phase 3 shared-core close at `96e0dedfb`.

## Objective

Move the server-only unsupported-trigger compatibility policy out of the browser
tree and into Fastify without changing the trigger/effect descriptor contract.

## Boundary

- Exact unsupported trigger-effect set and membership predicate.
- `@@emo` regex-output classifier.
- Empty unsupported server-CBS callback set and sorted diagnostic records.
- Delivered delta: two production and two server-test runtime/mixed root-`src`
  edges.

## Behavior Contract

Preserve exact effect membership, `@@emo ` prefix matching, cycle-safe scans,
deduplication, lexical sorting, and unsupported-effect no-ops. Do not change
trigger descriptors, execution, recursion/budgets, script state, model/profile
resolution, persistence, revisions, receipts, or events.

## Validation

Scripts, triggers, Phase 9 compatibility structure, and closed
ownership/browser-mirror parity suites passed 58, 143, 4, and 4 tests. Both
typechecks, the 228-edge architecture inventory, formatting, and diff checks
passed.
