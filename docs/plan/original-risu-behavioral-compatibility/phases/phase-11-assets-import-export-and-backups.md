# Phase 11 — Assets, Imports, Exports, Saves, And Backups

Status: Pending  
Depends on: Phases 1, 3, 5-10

## Objective

Verify asset references, codecs, historical formats, portable blocks, staged
assets, salvage, saves, backups, restore, and garbage collection in both
directions wherever the compatibility promise supports them.

## Audit Questions

- Do `.risu`, `.bin`, CharX/card, chat, preset, translator, module, asset, and
  backup codecs preserve all retained logical fields and references?
- Are unknown/legacy blocks preserved, rejected, or visibly omitted according to
  authority rather than silently dropped?
- Do asset IDs, MIME/type, order, ownership, deduplication, and embedded/external
  references survive cross-application and current round trips?
- Are staged import, overwrite, failure, cancellation, salvage, restore, and GC
  atomic with correct warnings and rollback?
- Are every SQLite table and persisted substructure classified for backup/export
  inclusion, exclusion, migration, or unsupported status?

## Required Outputs

- Closed-world codec/block/asset-reference/persisted-table classification.
- Historical real-world and synthetic adversarial fixture provenance.
- Original-to-current, current-to-original where supported, and current
  export/reimport semantic round trips.
- Explicit Phase 0 pilot coverage for portable reroll candidates.
- Fault cases for partial/corrupt input, staging failure, collision, restore, and
  GC reachability.

## Exit Criteria

- Every retained field/block/reference is preserved or has a signed visible
  disposition.
- Supported round trips have zero unexplained semantic loss.
- Failure and salvage paths cannot leave half-imported or wrongly collected data.
- Focused codec/asset/backup, persistence, browser, and compatibility lanes pass.

## Validation

Run cross-application and current round-trip fixtures, corrupt/legacy/fault
cases, real persistence restore/GC tests, selected browser journeys, affected
and compatibility lanes, formatting, and `git diff --check`.
