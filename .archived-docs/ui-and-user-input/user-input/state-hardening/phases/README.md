# Phase Index

Active phase index for the user input state hardening workstream.

- [Phase 0: Contract & Baseline](phase-0-contract-and-baseline.md)
- [Phase 1: Shared Primitives & Rollback](phase-1-shared-primitives-and-rollback.md)
- [Phase 2: Dirty Draft Projection](phase-2-dirty-draft-projection.md)
- [Phase 3: Upload, Import & Fetch Callbacks](phase-3-upload-import-fetch-callbacks.md)
- [Phase 4: Chat, Messages & Generation](phase-4-chat-messages-generation.md)
- [Phase 5: Collection Domains](phase-5-collection-domains.md)
- [Phase 6: Resync, Memory & Navigation](phase-6-resync-memory-navigation.md)
- [Phase 7: Verification](phase-7-verification.md)

## Slice Rules

- Keep shared helpers separate from domain conversions when possible.
- Re-check source symbols before editing. Audit anchors are durable by concept,
  not by line number.
- Prefer entity ids and field keys over indexes or whole snapshots.
- A phase is not complete until focused tests pass or its exact test gap is
  recorded in `../status.md`.
- Server command revision checks do not close client stale-state risks by
  themselves; projection, rollback, and callbacks still need direct coverage.
