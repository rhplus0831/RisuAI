# Slice: CharX Import Stream Cap

Phase: [7](../../phase-7-opt-in-subsystems.md). Finding: M21. Runtime change.
Status: done on 2026-06-06.

## Scope

Fix the CharX asset-size guard and enforce the 50 MB asset cap while zip entry
data is streaming, including data-descriptor entries whose original size is
not known up front.

This slice does not change `.risu` import/export codecs, PNG card import, or
server-side bundle import behavior.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M21.
- `src/ts/process/processzip.ts`: `CharXImporter.#handleFile`,
  `#handleFileData`, `#handleFileComplete`, `AppendableBuffer`, and
  `MAX_ASSET_SIZE_BYTES`.
- Caller: `src/ts/characterCards.ts`.
- Existing import suites:
  `src/ts/characters.importChat.test.ts`,
  `src/ts/storage/risuSave.test.ts`.
- New focused test home: `src/ts/process/processzip.test.ts`.

## Target Shape

- Parenthesize the known-size guard so it evaluates `file.originalSize ?? 0`
  before comparing with `MAX_ASSET_SIZE_BYTES`, but do not treat this as
  sufficient by itself.
- For known oversized entries, skip starting/accumulating the entry and record
  it in `excludedFiles` consistently with the post-read exclusion path.
- For unknown-size or data-descriptor entries, track cumulative uncompressed
  bytes in `#handleFileData`. Once the cumulative size exceeds
  `MAX_ASSET_SIZE_BYTES`, terminate the `fflate.UnzipFile`, discard the partial
  `AppendableBuffer`, mark the entry excluded, and ignore later callbacks for
  that entry.
- Avoid allocating an `AppendableBuffer` for files that are excluded before
  streaming starts.
- Keep within-cap imports byte-identical, including `card.json`,
  `module.risum`, ignored JSON files, queued asset metadata, and progress.
- Add tests for a known oversized entry, an unknown-size/data-descriptor entry
  that exceeds the cap mid-stream, no completion processing for terminated
  entries, and a representative valid import that produces identical assets.
- Register M21 as `DONE` in the v2 gate with focused tests, and flip the M21
  row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Valid `.charx` and jpeg-wrapped card imports remain byte-identical.
- Excluded files are reported through the same public result surface as before.
- Terminating an oversized entry must not abort the entire import unless the
  existing importer already would have done so for that error class.
- The cap is based on decompressed asset bytes, not compressed zip bytes.

## Done Criteria

- [x] Oversized known-size entries are not buffered.
- [x] Oversized unknown-size entries are abandoned mid-stream under the cap, with a
  memory/counting assertion proving no full oversized buffer is retained.
- [x] The M21 v2 gate entry points at real focused tests and the risk-map row is
  `DONE`.

## Completion Proof

- `src/ts/process/processzip.test.ts`:
  `M21: skips a known oversized CharX asset before allocating a buffer`,
  `M21: abandons an unknown-size CharX asset mid-stream and discards partial bytes`,
  `M21: ignores completion callbacks after terminating an oversized CharX asset`,
  and `M21: preserves representative valid CharX import output`.

## Validation

```bash
pnpm exec vitest run src/ts/process/processzip.test.ts src/ts/characters.importChat.test.ts src/ts/storage/risuSave.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
