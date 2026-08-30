# Client Resource Ownership Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [lorebook page consumer migration](phases/slices/phase-2-leaf-settings-and-collections/lorebook-page-consumer-migration.md).

1. Feed the owner from the existing route hydration result without issuing a
   duplicate standalone-setting request.
2. Split page reads from lorebook collection/body reads in each in-scope UI and
   prompt-processing consumer.
3. Route explicit selection through the owner and preserve stable-id mapping,
   queued/failure UI, current-attempt rollback, and authoritative reload.
4. Preserve structural create/delete/reorder selection repair until it can use
   the same owner contract safely.
5. Classify plugin/legacy exposures explicitly if they cannot migrate without
   changing external behavior.

## Required Scope Before Editing

The implementation must retain the existing lorebook collection/body owner and
prove there is no duplicate fetch, payload widening, selection drift, or extra
reactive fanout.

## Released Dependency

- `lorebookPageOwner` is complete at `e751edc69`.
- The standalone read is released at `33d1643ae`, durable command at
  `3f275e9dc`, and route relation at `6a6d0ac1f`.
- The page pointer is an already-singular settings row. Broader lorebook bodies,
  prompt/model/translator owners, and bridge removal remain held.

## Not First

- Do not replace `getDatabase()` with a common snapshot or common epoch.
- Do not migrate a production consumer before its complete owner contract and
  Workstream 1/2 cursors exist.
- Do not remove trusted writes, write guards, bridges, or lifecycle flushes.
- Do not widen the shell/bootstrap/resource payload.
- Do not add event deltas.

## Handoff

After page consumers and page-selection persistence migrate with browser proof,
record retained external holds and open the next dependency-released leaf only.
