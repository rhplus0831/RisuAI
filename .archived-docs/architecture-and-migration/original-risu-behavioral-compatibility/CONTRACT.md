# Original RisuAI Behavioral Compatibility Contract

Date: 2026-08-30

## Authority

This contract defines how the behavioral compatibility audit decides whether a
difference is a regression, a verified post-fork port, a signed divergence, an
unsupported/no-port surface, or outside the compatibility promise.

The immutable baseline is
`71c476e9c86263fe907105b011ca4dde0a619d66`. The behavioral sync cursor
`f3f0242fba297d82e0efcc2c31ca1428569b70f2` records completed upstream
disposition through that point but does not replace the baseline or prove that a
native port is behaviorally equivalent.

## Source Obligations

Every inventory row has exactly one primary source obligation.

| Obligation | Meaning | Required proof |
| --- | --- | --- |
| `fork-parity` | Retained behavior existed at the Git fork point. | Match observable baseline behavior or map the difference to a signed decision. |
| `synced-upstream` | Post-fork behavior through the behavioral sync cursor was ported or recorded as already covered. | Link upstream disposition and native port, then independently verify the recorded observable behavior. |
| `signed-divergence` | Maintainer approved a specific user-visible difference. | Link the authoritative decision and prove current behavior still matches it. |
| `standing-unsupported` | Feature/surface is intentionally unavailable. | Prove it is absent, hidden, explicitly rejected, or visibly diagnosed as decided; silent partial behavior is not sufficient. |
| `fastify-only-interaction` | Fastify-only behavior can affect shared compatibility state or workflows. | Prove it does not corrupt, erase, misproject, or make shared data non-interoperable. |

An upstream `DONE` disposition and a Fastify `reproduced` verification are
different facts and remain different inventory fields.

## Semantic Comparison Rules

Compare logical meaning rather than physical implementation. The following are
normally semantic and must not be normalized away:

- missing versus `undefined`, `null`, empty string, empty array, and default;
- value type, role, ordering, multiplicity, identity, ownership, and references;
- message data, durable metadata, reroll/displacement state, and mutation timing;
- prompt row content/order/role and script-visible state;
- provider URL path/query, method, headers, body, model, options, and retries;
- import/export blocks, assets, exclusions, omissions, warnings, and round-trip
  results;
- visible controls, selection, focus, feedback, error/cancel/retry state, and
  rendered content;
- terminal outcome, persisted partial/final text, side effects, and reload state.

The following may be normalized only with a documented reason:

- generated IDs when identity relationships and occurrence order are preserved;
- timestamps when presence/order is the observable rather than exact wall time;
- credentials and secrets, which must be redacted without changing presence or
  credential-selection semantics;
- internal protocol/session/job identifiers invisible to behavior;
- JSON object key order where the consumer is order-insensitive.

Array order, repeated values, event order, and URL path/query are not generic
transport noise.

## Verification Vocabulary

### Evidence state

- `reported`: one audit report with concrete evidence.
- `cross-confirmed`: independently reported by more than one track.
- `code-verified`: current and reference call paths independently checked.
- `reproduced`: deterministic executable proof demonstrates the observable.

### Verification state

- `pending`: claim has not been independently adjudicated.
- `confirmed`: expected and actual behavior are verified.
- `adjusted`: the mechanism or scope is real but differs from the raw report.
- `refuted`: the claimed observable difference does not hold.

### Disposition

- `fix`: restore required behavior or remove an unintended difference.
- `decide`: verified user-visible tradeoff needs maintainer authority.
- `signed-keep`: individual maintainer decision accepts this difference.
- `standing-unsupported`: recorded no-port/unsupported boundary remains in force.
- `resolved`: fixed, refuted, or otherwise closed with evidence.
- `deferred`: valid work has an owner, reason, and concrete revisit trigger.

### Severity

- **Critical:** broad or unrecoverable user-data destruction, secret disclosure,
  arbitrary unsafe execution, or compatibility failure that makes normal data
  unusable without recovery.
- **High:** durable wrong/lost data, materially wrong provider request or billing
  selection, common workflow failure, silent compatibility break, or severe
  lifecycle inconsistency.
- **Medium:** feature-scoped wrong behavior, recoverable artifact loss,
  race-window inconsistency, visible failure/reload mismatch, or noisy but
  bounded interoperability defect.
- **Low:** narrow legacy edge, cosmetic/diagnostic mismatch, or hygiene defect
  with a small observable consequence.

Severity is independent of confidence and disposition.

## Decision Requirements

A user-visible difference cannot become `signed-keep` through a code comment,
test, golden, commit message, or blanket policy. It requires an individual
decision record containing:

- stable decision ID;
- exact baseline and current behavior;
- affected observables and users/data;
- rationale and considered parity alternative;
- maintainer disposition and date;
- implementation and regression owners;
- revisit trigger, if any.

When a decision is overturned, every pin and golden enforcing the prior behavior
is itself an audit target and must change with the new implementation.

## Unsupported And No-Port Requirements

Unsupported behavior is a product boundary, not a missing test result. A standing
unsupported row must prove one of:

- the control/surface is absent from the live UI and cannot be selected;
- legacy imported state is migrated with a visible notice;
- execution rejects explicitly before destructive or paid side effects;
- a visible warning identifies the unsupported effect or provider;
- retained compatibility data round-trips inertly without becoming active.

Silent no-ops, stale visible controls, partial mutation before rejection, or data
loss during normalization are compatibility findings even when the underlying
feature remains unsupported.

## Finding Requirements

Every canonical finding includes:

1. stable ID and raw-report source mapping;
2. primary category, seam tags, source obligation, and inventory row IDs;
3. expected behavior and exact reference authority;
4. actual current behavior and current-code evidence;
5. observable consequence and affected scenario variants;
6. severity, evidence state, verification state, and proposed disposition;
7. deterministic reproduction or explanation why runtime proof is infeasible;
8. decision needed, remediation owner, tests/gates, and residual risk;
9. final commit, verification, and closeout state.

Every raw finding maps exactly once to a canonical finding, existing decision,
or explicit not-a-finding outcome. Agreement is a confidence signal, not proof;
single-track High findings receive the same independent verification as
cross-confirmed findings.

## Golden And Expected-Difference Requirements

- A golden captures observed behavior; it does not authorize it.
- Every intentional baseline/current difference references a signed decision ID.
- A new difference, changed expected difference, or missing expected difference
  fails review until its semantic cause is adjudicated.
- Normalizers are test owners with their own contract and negative cases.
- Fixture provenance records whether data came from the immutable baseline,
  current production code, a historical real-world artifact, or a synthetic
  adversarial case.
- Updating current-only goldens cannot substitute for running the fork-point
  differential when the claim concerns baseline parity.

## Closure Contract

The audit can close only when:

- every in-scope inventory row has a verification state and disposition;
- every raw finding is mapped and every canonical finding is closed or explicitly
  deferred;
- no unexplained differential or unsigned expected difference remains;
- standing unsupported behavior is visible/explicit and regression-pinned;
- Critical/High findings are fixed or individually accepted with a revisit rule;
- structural completeness gates and behavioral owners are live;
- the pinned full differential, current-only compatibility, owning product lanes,
  browser/recovery evidence, and final aggregate pass as required;
- current architecture/test docs and the archived decision record agree with the
  shipped implementation.
