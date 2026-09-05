# Phase 6: Shared Policy and Closeout

Finding: F10, followed by all-finding verification. Dependency: prior phase
gates accepted. Progress belongs in [status.md](../status.md).

## 6a: One Trigger Compatibility Owner

Read [shared-core ownership](../../../../packages/shared-core/README.md) and
[scripting](../../../structure/prompt-assembly-and-scripting.md). Owners:
`src/ts/process/triggerServerSupport.ts`,
`server/fastify/src/prompt/triggerCompatibility.ts`, and
`server/fastify/__tests__/triggerCompatibilityOwnership.test.ts`.

- Move the neutral unsupported-effect catalog and diagnostic traversal into one
  shared-core owner. Preserve classifications, result ordering/deduplication,
  nested/cyclic input handling, and browser/server diagnostics exactly.
- Migrate both consumers through narrow package exports. Keep actual execution,
  privileged actions, and server enforcement in their existing runtime owners.
- Replace duplicate-literal comparison with behavioral parity and shared-consumer
  ownership evidence. Preserve relevant architecture inventories; a new shared
  module must not import browser state, Fastify, persistence, or credentials.
- Remove duplicate implementations after both consumers pass. A facade may
  remain when it preserves a useful import seam, but it must delegate all logic.

Exit: one implementation with both live consumers, unchanged diagnostic fixtures,
and passing shared-core import/ownership gates. Use the existing compatibility
ownership test and `packages/shared-core/src/ownership.test.ts` through separate
focused invocations, plus shared-core/server typechecks as appropriate.

## 6b: Closeout Evidence

1. Revisit each finding at the final source anchor. Record implemented changes,
   measured outcomes, disproved observations, and retained/deferred decisions
   separately. F01 must be fixed; known data loss cannot be a performance tradeoff.
2. Re-run the affected deterministic cost gates and representative isolated
   measurements. Compare both the small case and scaling case; include retained
   dynamic-script costs, cache growth, and background-work bounds.
3. Verify combined recovery behavior: accepted/queued/failed UI, reload/replay,
   writer takeover/lineage replacement, background completion, and selected-locale
   startup. Choose exact browser specs from the current test guide; do not imply
   the agent aggregate runs browser tests.
4. Run `pnpm test:agent` after implementation is complete and `pnpm check:docs`
   after current-guide updates. Record exact browser/performance checks and
   user/CI full-quality/compatibility evidence separately. A missing required
   gate remains open; do not write a blanket all-checks-passed claim.
5. Update the current data/events, mutation recovery, resources/cache, prompt,
   assets/backend, and frontend guides for the behaviors that actually changed.
   Keep architecture detail in its current owner, not duplicated in this plan.
6. Archive the intact plan, status, phases, and retained evidence in the existing
   performance-and-stability archive topic. Update its index and the active-plan
   README, repair moved links, and validate the archived workstream's links
   explicitly as well as current documentation.

## Completion and Residual Work

The status ledger must distinguish a completed remedy from a measured decision
to retain current behavior. A legitimate F08 retention decision may close its
decision phase; other deferrals require an explicit scope amendment and remain
visible as residual work. Do not describe deferred findings as fixed or erase
them during archival.

Each retained exception needs a source owner, reason, measurable boundary,
revisit trigger, and downstream reference. The final handoff names the next
action only when work remains; it must not leave an apparently active plan with
no execution cursor or archive an incomplete required correctness fix.
