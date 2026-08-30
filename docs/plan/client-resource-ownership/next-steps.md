# Client Resource Ownership Next Steps

Date: 2026-08-31

## Current Best Task

No Workstream 3 runtime slice is currently runnable. Advance the matching
Workstream 1 and 2 character/chat dependency cursors, then open the smallest
released Phase 3 owner family.

## Required Scope Before Editing

Before opening Phase 3, record exact read/command contracts, persisted canonical
owners, draft and lazy-body boundaries, optimistic outcomes, rollback, reload,
and browser proof for the chosen character/chat resource.

## Released Dependency

- `lorebookPageOwner` is complete at `e751edc69`.
- The standalone read is released at `33d1643ae`, durable command at
  `3f275e9dc`, and route relation at `6a6d0ac1f`.
- The page pointer is an already-singular settings row. Broader lorebook bodies,
  prompt/model/translator owners, and bridge removal remain held.
- Page consumers migrated at `aaf66b75d`; the plugin/database replica and cold
  prompt fallback are explicit compatibility holds, not normal owner reads.

## Not First

- Do not replace `getDatabase()` with a common snapshot or common epoch.
- Do not migrate a production consumer before its complete owner contract and
  Workstream 1/2 cursors exist.
- Do not remove trusted writes, write guards, bridges, or lifecycle flushes.
- Do not widen the shell/bootstrap/resource payload.
- Do not add event deltas.

## Handoff

Open exactly one Phase 3 slice after both dependency workstreams release it.
Until then, leave character/chat consumers and bridges unchanged.
