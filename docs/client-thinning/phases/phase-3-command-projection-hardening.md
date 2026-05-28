# Phase 3: Command And Projection Hardening

Date: 2026-05-28

Status: active only for source-proven invariant drift.

## Goal

Close one command/projection invariant family at a time when source inventory or
the audit proves a live gap.

## Valid Families

- active-writer route classification
- command revision conflict behavior
- command-path id validation and minting boundaries
- composite command fan-out
- projection guard bypasses
- passive refresh writer ownership
- command event invalidation
- asset-reference write validation
- backup data-directory inventory
- bounded process-lifetime accumulators

## Actionable Slices

Work these slices in order. Each implementation batch must select exactly one
valid family above, cite the source inventory or audit failure that proves the
gap is live, and leave unrelated families untouched.

1. Source-proof triage.
   - Objective: pick the next highest-confidence family with current source or
     audit evidence.
   - Scope: inspect the owning route/helper/guard files, matching status shard,
     matching coverage shard, and `pnpm client-thinning:audit` output when the
     audit is the evidence.
   - Done: the batch notes the chosen family, the source paths, the failing or
     missing invariant, and the focused proof commands to run.
2. Active-writer ownership slice.
   - Objective: close one active-writer route classification or passive refresh
     writer ownership gap.
   - Scope: change only the affected route/bootstrap/refresh path, its audit
     rule or classification data, and focused active-writer or bootstrap tests.
   - Proof: rejected stale writer mutation or read-only refresh behavior is
     covered, and the relevant status/coverage shards name the new boundary.
3. Command contract slice.
   - Objective: close one command revision conflict, command-path id validation
     or minting, composite command fan-out, or command event invalidation gap.
   - Scope: keep the change to one command family or browser helper workflow;
     do not combine conflict policy, id policy, fan-out, and events.
   - Proof: server and browser tests cover failure behavior, successful mutation
     behavior, revision/event expectations, and audit coverage where structural
     enforcement is needed.
4. Projection guard slice.
   - Objective: close one projection guard bypass without broadening browser
     write ownership.
   - Scope: classify the bypass as command-needed, browser-local, trusted
     projection write, or no-port, then update only that path and its guard
     proof.
   - Proof: ordinary projected-state mutation still fails in Fastify mode, and
     any trusted write remains scoped and covered by a focused guard test.
5. Durable reference slice.
   - Objective: close one asset-reference write validation or backup
     data-directory inventory gap.
   - Scope: update the single owning command, import/backup path, and matching
     audit inventory rule; do not expand unrelated asset URL support.
   - Proof: invalid references or missing data-directory children fail before
     durable write, valid writes still pass, and backup/restore or asset tests
     cover the changed family.
6. Process-lifetime accumulator slice.
   - Objective: bound one process-lifetime accumulator that can grow across
     requests, projections, events, or command handling.
   - Scope: add the smallest reset, eviction, ownership transfer, or lifecycle
     boundary for the proven accumulator only.
   - Proof: focused tests demonstrate bounded behavior across repeated use, and
     the status/coverage shards record the remaining ownership rule.
7. Closeout sync for the completed family.
   - Objective: make the completed family discoverable for the next agent.
   - Scope: update only the relevant status and coverage shards plus any audit
     fixture notes required by the family.
   - Done: focused proof commands pass, `pnpm client-thinning:audit` is either
     passing or its remaining failures are outside the completed family, and no
     unproven Phase 3 family is marked closed.

## Exit Criteria

- The batch names one invariant family.
- Runtime fix, audit rule or rule update, and proof land together.
- The relevant status and coverage shards are updated after verification.
