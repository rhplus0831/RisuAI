# Slice: Tokenizer And Cache Caps

Phase: [8](../../phase-8-client-interpreters-plugins-media.md). Finding:
L42. Client cache boundedness change.

## Scope

Bound the Google Cloud tokenization cache so opt-in tokenizer use cannot grow a
module-level Map by full input text for the lifetime of the page.

This slice owns `googleCloudTokenizedCache` and any narrow shared cache helper
needed to align it with the existing tokenizer cache policy. It does not
change tokenizer selection, provider token counting semantics, tokenizer
fetching, or server-side tokenization.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L42.
- `src/ts/tokenizer.ts`: `googleCloudTokenizedCache`, `encodeCache`,
  `useTokenizerCaching`, GoogleCloud tokenizer branch, and cache reset/export
  helpers if present.
- Existing tokenizer mocks and tests near
  `src/ts/process/__fixtures__/mocks/tokenizerFetch.ts`; add or extend a
  focused tokenizer cache test if none exists.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts` and
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) for
  L42 proof registration.

## Target Shape

- Replace `googleCloudTokenizedCache`'s unbounded Map with a fixed-size LRU, or
  fold its entries into the existing capped `encodeCache` if that keeps the
  GoogleCloud key semantics clear.
- Keep cache keys precise enough that tokenizer mode, model/config, and input
  text collisions cannot return a count from the wrong tokenizer.
- Preserve the current successful token count for cached and uncached calls.
- Make eviction deterministic: oldest entry leaves first when the cap is
  exceeded, and replacing an existing key refreshes that key according to the
  local cache convention.
- Add focused coverage for cache hits, eviction past the cap, and output
  identity after an eviction miss refills the cache.
- Register L42 as `DONE` in the v3 gate and flip only the L42 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).

## Invariants

- Token counts for GoogleCloud tokenizer inputs remain unchanged.
- `useTokenizerCaching` behavior for other tokenizer branches remains
  unchanged unless the shared cache is intentionally reused without changing
  semantics.
- The cache cap is local and explicit; no full-text token cache may remain
  unbounded on this path.
- Cache eviction cannot leak stale counts across models or tokenizer modes.

## Done Criteria

- `googleCloudTokenizedCache` is bounded by a fixed cap or removed in favor of
  an already bounded equivalent.
- Repeated GoogleCloud tokenization of the same text still hits cache.
- More than cap-size distinct texts evict old entries deterministically.
- Cached and uncached token counts match for the same tokenizer input.
- L42 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run src/ts/tokenizer*.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
