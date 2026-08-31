# Client Resource Ownership Status

Date: 2026-08-31

This is the final execution record. Stable scope lives in [`PLAN.md`](PLAN.md),
phase detail in [`phases/`](phases/README.md), retained operational boundaries
in [`next-steps.md`](next-steps.md), and exact proof in
[`latest-verification.md`](latest-verification.md).

## Final Snapshot

- Plan state: Complete; Phases 0-7 closed.
- Final implementation/inventory candidate: `993222d82`.
- Current-guide reconciliation: `27c41103d`.
- Production aggregate database consumers: 0.
- Bridge families: 0.
- Test-fixture compatibility inventory: 4,221 exact references across 30 groups
  and 9 reviewed policies.
- Owner API gap matrix: 9 complete or not-applicable rows; no open gap.
- Retained seam markers: 20, all reviewed and classified.

## Dependency Cursors

| Resource family | Workstream 1 | Workstream 2 | Final Workstream 3 state |
| --- | --- | --- | --- |
| Shared owner contracts | Archived at `377a3610b` | Per-family releases archived at `1f99b445c` | Complete. |
| Leaf settings and collections | Released | Canonical owners released | Explicit production consumers; test-only aggregate adapter retained. |
| Character/chat/transcript | Released | Stable persisted rows released | Explicit detail, selection, chat, transcript, hydration, and mutation owners. |
| Prompt templates | Released | Modern preset owner released | Explicit hydration, draft, mutation, and assembly owners. |
| Lorebooks/scripts | Released | Stable-id/repair boundaries released | Explicit scoped owners and lifecycle registration. |
| Broad settings/shell/runtime | Released | Canonical settings owners released | Exact owner sets; no any-resource production epoch or facade. |
| Facade/bridge infrastructure | All dependencies resolved | All dependencies resolved | Removed through `f6dca576c`. |

## Phase Router

| Phase | Status | Release |
| ---: | --- | --- |
| [0. Consumer/facade/bridge inventory](phases/phase-0-consumer-facade-and-bridge-inventory.md) | Complete | `0432b32ba` |
| [1. Resource-owner foundation](phases/phase-1-resource-owner-foundation.md) | Complete | `e751edc69` |
| [2. Leaf settings/collections](phases/phase-2-leaf-settings-and-collections.md) | Complete | `aaf66b75d` through final candidate |
| [3. Character/chat](phases/phase-3-character-and-chat-ownership.md) | Complete | Through `1b3638a1a` |
| [4. Prompt/lorebook/scripts](phases/phase-4-prompt-lorebook-and-script-ownership.md) | Complete | `793b2db73`, `975ce3217`, `f62d5878c` |
| [5. Broad settings/shell](phases/phase-5-broad-settings-and-shell-ownership.md) | Complete | Through `bdb8a55c3` |
| [6. Facade/bridge removal](phases/phase-6-facade-and-bridge-removal.md) | Complete | `79e4b4b06`, `185e6f36a`, `f6dca576c` |
| [7. Seams/verification/closeout](phases/phase-7-temporary-seams-verification-and-closeout.md) | Complete | `993222d82`, `27c41103d` |

## Retained Boundaries

- `composeResourceDatabaseSnapshot()` is a detached materializer used only for
  interchange, browser-smoke diagnostics, and the test-only adapter. It is not
  production reactive state or mutation authority.
- `/api/v1/characters/aggregate` is retained external compatibility. First-party
  production code uses narrow owners; removal waits for 30 consecutive days of
  zero supported-client path telemetry.
- Observer-shell markers are retained deployment controls. Removal waits for the
  archived rollout thresholds; the smoke-only session override is ignored in
  production.
- The persisted `settings:bridge` outbox key is a wire/storage compatibility key,
  not a live bridge family.

No execution blocker remains. The intact workstream is ready for archival.
