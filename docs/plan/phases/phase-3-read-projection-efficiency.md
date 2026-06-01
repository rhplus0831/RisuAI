# Phase 3: Read Projection Efficiency

Status: read optimizations implemented; full-resync reason budget implemented;
optional lorebook work remains planned only if measured.

Goal: reduce repeated REST reads and full-projection work for targeted
projection, asset metadata, bulk hydration, and full resync fallbacks.

## Source Anchors

- [`../../AUDIT.md`](../../AUDIT.md)
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/repository.ts`
- `src/ts/server/chatMessageHydration.svelte.ts`
- `src/ts/bootstrap.ts`
- `src/ts/globalApi.svelte.ts`

## Slices

- [`targeted-projection-loaders.md`](slices/phase-3-read-projection-efficiency/targeted-projection-loaders.md)
- [`asset-metadata-index.md`](slices/phase-3-read-projection-efficiency/asset-metadata-index.md)
- [`bulk-chat-lorebook-reads.md`](slices/phase-3-read-projection-efficiency/bulk-chat-lorebook-reads.md)
- [`full-bootstrap-resync-budget.md`](slices/phase-3-read-projection-efficiency/full-bootstrap-resync-budget.md)

## Exit Criteria

- Empty, small, and field-scoped targeted projection resources avoid full stub
  projection load.
- Asset metadata lookup no longer parses `db.json` for every cold asset read.
- Bulk all-chat readers have a lower request count path; optional lorebook
  stubs need a separate measured batch before changing.
- Full resync diagnostics distinguish expected from unexpected reasons and have
  fallback-path regression coverage.

## Current Progress

- Empty-field targeted projection resources such as `asset` now skip full stub
  projection loading while preserving the existing response contract.
- Small non-empty targeted projection resources such as `preset`, `prompt`,
  `promptItem`, `persona`, `translatorPreset`, and `loadout` now use a narrow
  persisted-field selector with provider secret masking.
- Character-family targeted projection resources such as `character`, `chat`,
  `chatFolder`, `message`, and `generation` now use a narrow persisted-field
  selector with chat message stubs, Hypa V3 removal, optional lorebook stubs,
  and provider secret masking.
- Mixed broad targeted projection resources such as `scriptDefinition`,
  `triggerDefinition`, `lorebook`, `module`, and `plugin` now use field
  selectors that avoid the full stub projection path while preserving character
  stubs, provider secret masking, `module.deleted` reference cleanup, and
  `loreBookPage` updates.
- Asset metadata lookup now uses an in-process repository index with
  `db.json` stat-based refresh and explicit invalidation on repository writes.
- Bulk chat-message hydration now uses authenticated read-only
  `POST /api/v1/projection/chatMessages/bulk` for all-chat workflows, replacing
  one-request-per-chat fanout while keeping active-chat hydration on the
  single-chat GET path.
- Full bootstrap resync diagnostics now expose the expected reason vocabulary
  plus an unexpected-reason counter, and bootstrap tests cover replay
  unavailable, no baseline, projection error, projection full mode, and revision
  gap fallbacks.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/chatMessageHydration.test.ts`
