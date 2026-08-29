# Phase 11 — Assets, Imports, Exports, Saves, And Backups

Status: Complete
Depends on: Phases 1, 3, 5-10

Completion anchor:

- `56287bcb62c1dcdb969a7d185371a1c539bf3200` — closed portable
  envelope/block/asset/table ownership and hardened export/import integrity.

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

## Completion Record

### Closed Interchange And Asset Ownership

`server/fastify/__tests__/phase11CompatibilityStructure.test.ts` closes all four
supported `.risu` envelopes and every portable block type over explicit import
and export dispositions. It also requires every declarative asset-owner catalog
entry to be shared by reference discovery and legacy-path rewriting, binds nine
specialized asset shapes to both paths, and partitions every live SQLite table
between backup inclusion and a documented deliberate exclusion.

The codec and round-trip suites retain legacy raw, compressed, streamed, and
block envelopes; config/root, character/chat, preset, module, plugin, loadout,
and plugin-storage data; portable reroll candidates; unknown or unsupported
block reporting; Original local-backup records; legacy asset paths; and all
declared/specialized asset references. Exact logical values, identities, order,
references, MIME/bytes/hash, inclusion, warnings, and salvage results remain
semantic while archive entry metadata may vary.

### Integrity, Atomicity, And Bounded Failure

The audit hardened export at the owning stream boundary. Asset bytes are
preflighted against declared size and SHA-256 before response headers/events,
and are verified again while streamed. A corrupt asset therefore returns HTTP
400 without beginning an apparently valid archive. If a file mutates after
preflight, both ZIP and Original-compatible legacy exports abort the incomplete
response rather than emitting a successful-looking corrupt artifact.

Import remains staged and fail-closed. It bounds expanded database bytes,
archive-entry cardinality, legacy record sizes and names, duplicate database
records, malformed/truncated envelopes, unsupported manifest versions, asset
hashes, writer/auth state, and disconnects. Failure removes newly staged bytes,
preserves deduplicated live assets, avoids a database replacement, and does not
skip later cleanup attempts. Successful replacement creates a safety snapshot
and restores database plus assets into a fresh instance.

### Historical Formats, Salvage, And Boundaries

The route fixtures exercise an Original `database.risudat` plus asset backup,
legacy non-SHA media-name canonicalization, supported non-media assets,
qualified standalone-CHAT salvage, hollow and exact-boundary truncation,
group-character rejection, and ZIP/legacy current round trips. Browser Phase 4
owns visible export controls, Phase 5 owns visible acquisition/import entry
points, and this phase owns the portable bytes and atomic server-side outcome.

Historical Category K decision/finding rows are independently re-verified by
their codec, salvage, credential-warning, preset migration, CharX, and backup
owners. Signed credential inclusion/scrubbing and inert CharX exclusions remain
individual policy boundaries; none is inferred from a golden. Character/module
conversion remains the separately signed Phase 10 no-port boundary.

Category K rows `ORC-SURFACE-122` through `ORC-SURFACE-124` own portable
envelope/block/table round trips, asset/export integrity, and staged
import/restore/salvage behavior. All nine historical mapped Category K rows are
independently re-verified alongside pilot `ORC-SURFACE-004`; Category K is 13/13
verified and the total inventory is 124 rows.

No new maintainer decision was required. The remaining residual is the explicit
one from the Phase 0 pilot: the pinned Original harness has no executable save
exchange because it mocks rerolls, so every supported current codec owns reroll
round-trip proof and the exact cross-application limitation stays recorded.

## Verification Evidence

| Check | Result |
| --- | --- |
| Structure, bundle export, and bundle import owners | Passed; 3 files and 61 tests on the current branch. |
| Asset-reference, legacy-database, and codec owners | Passed; 3 files and 51 tests on the current branch. |
| Complete focused Phase 11 selection | Passed; 6 files and 112 tests. |
| `pnpm check:server` | Passed at the Phase 11 implementation anchor. |
| Register and fail-closed validator gates | Passed with 124 surfaces, 67 signed decisions, 15 findings, and all historical raw mappings. |
| Compatibility, formatting, and diff gates | Passed; exact commands and counts are recorded in `latest-verification.md`. |
