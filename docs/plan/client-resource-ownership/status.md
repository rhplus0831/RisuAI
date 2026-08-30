# Client Resource Ownership Status

Date: 2026-08-31

This is the mutable execution router. Stable scope lives in [`PLAN.md`](PLAN.md),
phase detail in [`phases/`](phases/README.md), the next slice in
[`next-steps.md`](next-steps.md), and exact proof in
[`latest-verification.md`](latest-verification.md).

## Current Snapshot

- Plan state: Active; Phases 0 through 2 are complete. The first runtime
  consumer family has migrated.
- Current phase: [Phase 3 character and chat ownership](phases/phase-3-character-and-chat-ownership.md),
  dependency-blocked.
- Active slice: none until matching Workstream 1 contracts and Workstream 2
  canonical-owner releases exist.
- Opening Fastify code anchor: `c0df82d5240a29a33efa5995e08cc970e0147573`.
- Phase 0 implementation: `0432b32ba1bcb7f8a3d5ca68a5605dd47a26857f`.
- Runtime changes through Phase 2: `lorebookPageOwner` now owns normal page
  reads and explicit stable-id selection. Lorebook collections/bodies and their
  bridge remain unchanged; named plugin and cold-flow compatibility holds are
  closed-world probed.
- Latest implementation: lorebook-page consumer migration at `aaf66b75d`; see
  [`latest-verification.md`](latest-verification.md).

## Inventory Cursor

- 9,900 exact compatibility references grouped into 326 consumer records and 56
  resource-family/role policies.
- Lanes: 3,334 production, 6 server, and 6,560 test references.
- Families: broad settings/shell 1,046; character/chat 1,775; compatibility
  infrastructure 2,062; cross-cutting 1,422; leaf settings/collections 1,854;
  lorebook 615; model/translator 469; prompt template 321; script definition
  336.
- Six bridge families remain: settings, character, chat, lorebook, prompt
  template, and script definition.
- Twenty temporary-seam rows retain the character aggregate endpoint and
  observer-shell rollout markers.

## Dependency Cursors

| Resource family | Workstream 1 contract | Workstream 2 owner | Workstream 3 state |
| --- | --- | --- | --- |
| Inventory/gates | Phase 0 convention released at `b01e88b03` | Not required for read-only inventory | Complete at `0432b32ba`. |
| Lorebook page standalone pointer | Standalone setting at `33d1643ae`; durable operation at `3f275e9dc`; route metadata at `6a6d0ac1f` | Already-singular settings row; lorebook bodies remain held | Consumer migration complete at `aaf66b75d`; explicit plugin/database and cold-flow compatibility probes retained. |
| Leaf settings/collections | Per owner pending | Per family pending or already singular, to prove | Runtime blocked. |
| Character/chat | Character-summary read contract released at `159b6eccf`; remaining resource/command contracts pending | Canonical state must be confirmed | Runtime blocked. |
| Prompt templates | Prompt contract pending | Phase 3 not released | Runtime blocked. |
| Lorebook/script definitions | Per owner pending | Phase 0/4 disposition as applicable | Runtime blocked. |
| Broad settings/shell | Shell read contract released at `159b6eccf`; settings/command contracts pending | Relevant settings owners pending | Runtime blocked. |
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
| [0. Consumer/facade/bridge inventory](phases/phase-0-consumer-facade-and-bridge-inventory.md) | Complete | Closed at `0432b32ba`. |
| [1. Resource-owner foundation](phases/phase-1-resource-owner-foundation.md) | Complete | Closed at `e751edc69`. |
| [2. Leaf settings/collections](phases/phase-2-leaf-settings-and-collections.md) | Complete | Closed the released lorebook-page pointer at `aaf66b75d`. |
| [3. Character/chat](phases/phase-3-character-and-chat-ownership.md) | Blocked | Matching Workstream 1/2 cursors release. |
| [4. Prompt/lorebook/scripts](phases/phase-4-prompt-lorebook-and-script-ownership.md) | Blocked | Workstream 2 canonical owner closes per family. |
| [5. Broad settings/shell](phases/phase-5-broad-settings-and-shell-ownership.md) | Blocked | Narrow owner paths exist for all remaining consumers. |
| [6. Facade/bridge removal](phases/phase-6-facade-and-bridge-removal.md) | Blocked | Inventory reaches zero for all compatibility infrastructure. |
| [7. Seams/verification/closeout](phases/phase-7-temporary-seams-verification-and-closeout.md) | Queued | Phases 0-6 satisfy exit gates. |

## Blockers And Risks

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

Use [`next-steps.md`](next-steps.md). Do not open Phase 3 until the matching
character/chat Workstream 1 contracts and Workstream 2 canonical owners are
released.
