# Browser Smoke Findings

No new defect or ineffective test is confirmed by this planning task.
The [inventory](inventory.md) is pending review. Apply the evidence rules in
[PLAN.md](PLAN.md) before promoting a lead or closing a repair.

## Opening Review Leads

| Lead                        | Evidence and question                                                                                                                                      | Initial owner  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Shared controls             | Browser hooks mix direct store assignments and real command dispatch. Determine the role of each call against its scenario's claim.                        | Phase 1        |
| Input and layout simulation | Existing tests fabricate geometry, set scroll positions, and override browser APIs. Determine which claims need actual browser input/layout overlap.       | Phases 1–2     |
| Fixture-to-producer gaps    | Imported/handcrafted state can pre-complete authoring, omit sparse legacy values, or bypass serialization. Trace only the boundaries each scenario claims. | Phases 1–3     |
| Assertions and scheduling   | Snapshots, settled-only checks, and request interception may miss visible pending states or change the ordering under review.                              | Phases 1–3     |
| Historical residuals        | Prior browser fault/composition limits may have changed. Confirm current evidence before opening new work.                                                 | Phases 0 and 2 |

These are questions, not defects or removal recommendations. The repaired Realm
and transcript incidents are calibration examples; do not assign them new open
finding IDs merely to populate this register.

One specific artifact lead surfaced during plan review:
`server/fastify/browser-smoke/fastBootstrapIntegrationArtifact.ts` initializes
empty recovery collections and validates them structurally as arrays, whereas
its direct-link merge checks expected cases. Phase 1 must determine whether a
required final artifact can consequently claim complete recovery evidence from
empty/partial results. Reproduce this with the actual invocation/merge contract
before promoting it; partial artifacts can be legitimate diagnostics, and this
observation does not show that a failed browser run was reported as passing.

## Finding Record

Assign stable IDs `BSE-001`, `BSE-002`, and so on when a review produces a
concrete finding. Each record contains:

1. Contract, risk, scenario IDs, production owner, and current source anchor.
2. Evidence classification: source-supported gap, reproduced missed fault,
   reproduced product defect, or inaccurate evidence claim. Distinguish an
   ineffective test from an actual current application bug.
3. Existing fixture/control, the exact boundary it skips, and why the present
   assertion fails to detect the named behavior.
4. Bounded repair, responsible phase, affected consumers, and dependencies.
5. Fault-detection experiment: fixture, independently specified expected outcome,
   observation proving the claimed production path was reached, unchanged test,
   production fault diff, commands, expected assertion failure, observed failure,
   and restored pass. Explain why the failure is caused by the named transition.
6. Focused and aggregate verification references, source anchor, and limitations.
7. Disposition and rationale: open, implementing, verified repair, retained
   with accurate scope, disproved, or deferred by recorded scope amendment.

Production defects receive distinct records/changes from harness cleanup.
Retaining a useful narrow test with corrected scope is a valid decision, but
does not supply missing critical browser coverage. Removed/merged cases require
an equivalent or stronger replacement for every named protected behavior and
a consumer/fixture/routing check. No numeric mock, coverage, or mutation score
determines the decision.

## Closure Rules

A material test repair is verified only with the plan's fault-detection evidence
and a passing restored run. A source-only review cannot be upgraded to an
executed reproduction. Every deferred record names impact, owner, revisit
condition, and the status amendment; deferred is not fixed. Open high-risk gaps
in Phase 2 prevent full closeout.

Keep compact reproduction evidence in this record. Add a linked finding-specific
file only when the fault diff or evidence becomes too large to review here.
Temporary logs and expired CI attachments cannot be the sole reproduction source.
