# Client Resource Ownership Status

Date: 2026-08-30

This is the mutable execution router. Stable scope lives in [`PLAN.md`](PLAN.md),
phase detail in [`phases/`](phases/README.md), the next slice in
[`next-steps.md`](next-steps.md), and exact proof in
[`latest-verification.md`](latest-verification.md).

## Current Snapshot

- Plan state: Active; runtime migration not started.
- Current phase: [Phase 0 consumer, facade, and bridge inventory](phases/phase-0-consumer-facade-and-bridge-inventory.md).
- Active slice: [Facade, trusted-write, and bridge consumer baseline](phases/slices/phase-0-consumer-facade-and-bridge-inventory/facade-and-bridge-consumer-baseline.md), ready to start.
- Opening Fastify code anchor: `c0df82d5240a29a33efa5995e08cc970e0147573`.
- Runtime changes in this activation: none.
- Latest verification: no workstream implementation run yet.

## Dependency Cursors

| Resource family | Workstream 1 contract | Workstream 2 owner | Workstream 3 state |
| --- | --- | --- | --- |
| Inventory/gates | Phase 0 convention pending | Not required for read-only inventory | Ready. |
| Leaf settings/collections | Per owner pending | Per family pending or already singular, to prove | Runtime blocked. |
| Character/chat | Resource/command contracts pending | Canonical state must be confirmed | Runtime blocked. |
| Prompt templates | Prompt contract pending | Phase 3 not released | Runtime blocked. |
| Lorebook/script definitions | Per owner pending | Phase 0/4 disposition as applicable | Runtime blocked. |
| Broad settings/shell | Shell/settings contracts pending | Relevant settings owners pending | Runtime blocked. |
| Facade/bridge infrastructure | All families | All releases/holds resolved | Removal blocked. |

## Opening Research Snapshot

- Explicit resource projections, targeted reads, invalidation, hydration, outbox,
  and command helpers already exist, but the compatibility facade remains a
  common composition and mutation surface.
- Six built-in bridge families and the pending bridge flush registry are covered
  by structural compatibility tests.
- Trusted-write calls are widespread in owner/bridge tests and still appear in
  runtime modules such as prompt preset override handling.
- Current architecture docs explicitly describe the facade, resource write
  guard, bridges, and authoritative-refresh fallback, providing a baseline to
  update only as phases land.
- Broad/temporary seams include the aggregate character read and the observer
  shell rollout flag/override; Phase 7 owns final decisions.

## Phase Router

| Phase | Status | Opens when |
| ---: | --- | --- |
| [0. Consumer/facade/bridge inventory](phases/phase-0-consumer-facade-and-bridge-inventory.md) | Ready | Now; coordinate gate format with Workstream 1 Phase 0. |
| [1. Resource-owner foundation](phases/phase-1-resource-owner-foundation.md) | Queued | Inventory gaps and per-family dependencies are known. |
| [2. Leaf settings/collections](phases/phase-2-leaf-settings-and-collections.md) | Blocked | Matching Workstream 1/2 cursors release. |
| [3. Character/chat](phases/phase-3-character-and-chat-ownership.md) | Blocked | Matching Workstream 1/2 cursors release. |
| [4. Prompt/lorebook/scripts](phases/phase-4-prompt-lorebook-and-script-ownership.md) | Blocked | Workstream 2 canonical owner closes per family. |
| [5. Broad settings/shell](phases/phase-5-broad-settings-and-shell-ownership.md) | Blocked | Narrow owner paths exist for all remaining consumers. |
| [6. Facade/bridge removal](phases/phase-6-facade-and-bridge-removal.md) | Blocked | Inventory reaches zero for all compatibility infrastructure. |
| [7. Seams/verification/closeout](phases/phase-7-temporary-seams-verification-and-closeout.md) | Queued | Phases 0-6 satisfy exit gates. |

## Blockers And Risks

- No blocker prevents Phase 0 read-only inventory and no-new-debt gates.
- Runtime phases are blocked per family until Workstream 1 contracts and
  Workstream 2 canonical-owner releases are recorded.
- A broad helper or common subscription can recreate the aggregate facade under
  a new name; Phase 1 API review must reject it.
- Removing bridges before draft/rollback/reload proof risks data loss.
- Character/chat and prompt/lorebook/script editors have lazy bodies and
  generation fences that a simple store migration may miss.
- Endpoint removal requires payload/startup measurement and explicit external or
  compatibility classification.

## Start Here

Use [`next-steps.md`](next-steps.md). Phase 0 should inventory and gate consumers
without migrating a resource family in the same slice.
