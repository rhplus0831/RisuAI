# Phase Index

Archived phase index. All phases are complete; these files remain as the
historical implementation handoff boundaries used while the workstream was
active.

- [Phase 0: Contract](phase-0-contract.md)
- [Phase 1: Chat Metadata & Commands](phase-1-chat-metadata-and-commands.md)
- [Phase 2: Effective Generation Config](phase-2-effective-generation-config.md)
- [Phase 3: UI & Send Gating](phase-3-ui-and-send-gating.md)
- [Phase 4: Import, Delete & Fork Edges](phase-4-import-delete-fork-edges.md)
- [Phase 5: Verification](phase-5-verification.md)

## Historical Slice Rules

- Keep server/data, prompt, UI, import, and verification changes in separate
  patches unless a helper is shared and small.
- Re-check source symbols before editing. Investigation anchors are durable by
  symbol, not by line number.
- Server enforcement must land before relying on client UI guards.
- A phase is not complete until its focused tests pass or its remaining test
  gap is recorded in [`../status.md`](../status.md).
