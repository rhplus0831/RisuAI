# Phase 0 Slice — Baseline, Authority Import, And Pilot

Status: Complete
Phase: [Phase 0](../../phase-0-cursors-contract-and-inventory.md)<br>
Opened from Fastify: `1933c43ff7b4d35b57b0852013d95f3881a8cb28`

## Outcome

Produce a reviewable Phase 0 packet that keeps the fork-point parity source and
the upstream sync ledger distinct, restores reproducible access to the pinned
baseline, imports existing authority, and tests the method on four recent
compatibility-risk patterns.

## Frozen Inputs

- Fork-point compatibility baseline:
  `71c476e9c86263fe907105b011ca4dde0a619d66`.
- Upstream behavioral sync cursor:
  `f3f0242fba297d82e0efcc2c31ca1428569b70f2`.
- Planning anchor: `1933c43ff7b4d35b57b0852013d95f3881a8cb28`.
- Existing implementation close evidence begins at `be74a491b`; later docs-only
  closure at `c7b33238b` is provenance, not the implementation anchor.
- Historical sources: archived 2026-08 original-compatibility audit, upstream
  sync ledger, later compatibility fixes, current harness, `STRUCTURE.md`, and
  `docs/tests/` ownership records.

The moving `/home/codex/Risuai` checkout may supply upstream intent and Git
objects. It may not supply fork-point expected output unless checked out at the
exact baseline commit.

## Work Packages

### 1. Baseline reproducibility

- Verify that the baseline object exists and record its repository provenance.
- Document idempotent creation of a detached
  `/home/codex/risu-baseline-71c476e9c` worktree, dependency preparation, and
  integrity checks without modifying the moving upstream checkout.
- Run the harness's baseline preflight/smoke when dependencies permit; record
  actionable diagnostics otherwise.
- Record Node/pnpm versions and prohibit golden generation from a dirty or
  incorrectly pinned baseline.

### 2. Authority import

- Enumerate upstream commits/units in `71c476e9c..f3f0242fb` from the archived
  sync ledger and source history.
- For each unit, record upstream behavior/disposition, relevant native port
  commit, exact current owners, and a separately initialized current
  verification state.
- Import historical accepted divergences and no-port decisions only when the
  original record contains individual maintainer authority.
- Map every historical raw finding to a canonical finding, decision, or
  not-a-finding outcome; do not bulk-reopen closed reports without new evidence.

### 3. Register validation

- Validate JSON schema, stable ID uniqueness, finding/inventory/decision
  references, commit formats, and allowed vocabularies.
- Add a repository command or focused test so later register drift fails closed.
- Ratify observable comparison and normalization fields with at least one
  adversarial missing/null/order/endpoint example.

### 4. Pilot recurrence classes

Create candidate inventory rows before comparison, then trace both sides and add
the smallest faithful evidence for:

| Pilot | Initial current owner | Required comparison |
| --- | --- | --- |
| Legacy preset additional parameters | `server/fastify/src/commands/presets.ts` and runtime consumers | Save/apply/reset completeness for default, absent, null, legacy, and non-default values. |
| Translation runtime/profile dispatch | Profile/settings commands and translation runtime dispatch | Selected profile/model/options, missing/default behavior, request shape, failure, and reload. |
| Responses endpoint preservation | Provider/model resolution and request construction | Endpoint/path override selection, body/options, streaming and retry/fallback path. |
| Portable reroll candidates | Message portability/import/export and transcript mutation owners | Candidate order, metadata, identity/reference preservation, current round trip, and supported cross-app round trip. |

Exact symbols and baseline owners must be added to the inventory during tracing;
the table is an entry hypothesis, not evidence.

## Allowed Changes

- This workstream's plan, inventory, findings, decisions, phases, and verification
  records.
- Compatibility harness/register validation, deterministic fixtures, and owning
  focused tests needed by the pilot.
- Narrow production fixes only after the behavior is reproduced, the obligation
  is unambiguous, and the same slice records regression evidence. Otherwise open
  a dedicated remediation slice.

## Stop And Escalate

- The recorded sync interval or a historical decision cannot be reconstructed.
- A pilot behavior depends on post-sync upstream state without a disposition.
- Baseline/current output cannot be compared without a new semantic
  normalization rule.
- A user-visible difference has credible tradeoffs or unclear product authority.
- A proposed production change touches multiple domains or shared protocol/data
  shape beyond the verified pilot finding.

## Validation And Handoff

- Run register schema/referential checks and pilot-focused tests.
- Run `pnpm test:affected --dry-run` and all lanes selected for any code/test
  changes.
- Run `pnpm test:compat-current`; run the full pinned differential when the
  prepared baseline is available.
- Run formatting and `git diff --check`.
- Update `status.md`, `latest-verification.md`, all touched rows/findings, and
  name the exact Phase 1 and first domain slices.

The slice is complete only when every work package has evidence and all Phase 0
exit criteria pass. Baseline absence may remain a recorded environmental blocker
for this short slice, but it cannot be waived for Phase 1 or final closure.

## Completion Record

- Baseline preparation and integrity enforcement landed in `bcb45b330605ba1cf021468e8cd4250fd19f24db`.
- Fail-closed schema, relationship, authority, commit, upstream-range, and
  canonicalization validation landed in `cfb36c1922fb5876f2b6233ff3f654277d187714`.
- The exact 85-unit upstream interval and historical authority/raw-report import
  landed in `9022d5bb45660ba50784e2324c93d339e75c96f9`.
- Pilot regression evidence landed in
  `9ea7aa20dd5a93ac7e5c9112e8c8fbcb9fca1438`.
- Four incomplete historical authority statements remain visible as proposed
  decisions; none is treated as an accepted expected difference.
- Direct Original-app reroll save exchange remains infeasible because the pinned
  harness has no such seam. Current raw, compressed, stream, and block `.risu`
  codecs instead prove export, decode, fresh import, and reload without losing
  candidate order, identity, metadata, references, transcript separation, or
  bookmarks.
