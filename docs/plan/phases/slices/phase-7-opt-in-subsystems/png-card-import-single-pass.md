# Slice: PNG Card Import Single Pass

Phase: [7](../../phase-7-opt-in-subsystems.md). Finding: L51. Runtime change.

Status: done on 2026-06-06; final Phase 7 proof/status refresh remains in the
proof slice.

## Scope

Avoid decoding and slicing PNG character-card asset chunks twice merely to
compute import progress.

This slice does not own CharX zip import bounds, `.risu` bundle import/export,
or inlay blob URL caching.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L51.
- `src/ts/characterCards.ts`: PNG card import asset-count pass and read pass.
- `src/ts/pngChunk.ts`: PNG chunk read/decode helpers.
- Existing suites:
  `src/ts/characters.importChat.test.ts`,
  `src/ts/storage/risuSave.test.ts`.
- New focused test home: `src/ts/characterCards.pngImport.test.ts`.

## Target Shape

- Replace the double full decode with a single pass that gathers the card data
  and asset chunks needed for import.
- If progress still needs a denominator, derive it without slicing every asset
  value twice. Acceptable shapes include a value-free count pass, a collected
  chunk list with known length, or progress based on completed steps rather than
  asset byte count.
- Preserve existing asset extraction, card parsing, import result shape,
  progress callback order where user-visible, and error behavior for malformed
  PNG cards.
- Avoid retaining unnecessary duplicate copies of asset chunk values after the
  import queue has consumed them.
- Add tests or counters proving PNG chunk values are decoded/sliced once per
  asset, while imports with multiple assets produce the same character/card
  data and assets as before.
- Register L51 as `DONE` in the v2 gate with focused tests, and flip the L51
  row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Valid PNG character-card imports remain byte-identical for card JSON and
  embedded assets.
- Malformed PNG/card errors remain visible through the same import failure
  surface.
- Progress must not regress into an unbounded memory or CPU pass.
- Non-PNG import paths are unchanged.

## Done Criteria

- PNG card import no longer decodes/slices every embedded asset chunk twice.
- Multi-asset PNG import behavior and progress remain covered by focused tests.
- The L51 v2 gate entry points at real focused tests and the risk-map row is
  `DONE`.

## Completion Notes

- `src/ts/characterCards.ts` now uses one trimmed `PngChunk.readGenerator` pass
  for PNG card data, image trimming, and embedded asset chunk collection.
- Embedded asset base64 values are consumed once into the save queue, then the
  temporary base64 and byte queues are cleared after use.
- `src/ts/pngChunk.ts` decodes PNG tEXt key/value fields from `subarray` views,
  avoiding an extra value-copy inside the single import pass.
- Focused coverage:
  `src/ts/characterCards.pngImport.test.ts` -
  `L51: decodes and slices each PNG embedded asset value once during import`
  and
  `L51: preserves multi-asset PNG import output and progress order`.

## Validation

```bash
pnpm exec vitest run src/ts/characterCards.pngImport.test.ts src/ts/characters.importChat.test.ts src/ts/storage/risuSave.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
