# Phase 7: Media And Import Memory Pressure

Back to original plan:
[`server-client-protocol-stability-performance.md`](../server-client-protocol-stability-performance.md#phase-7-media-and-import-memory-pressure)

Status: planning slice.

Goal: reduce peak memory and repeated base64 work for large assets.

## Implementation Slices

### 7.1 Size Accounting

- Add size accounting around stored asset prompt resolution.
- Add size accounting around Realm staged asset handling.
- Use the accounting to identify the largest repeat reads and encodes.

Done when asset-related memory pressure can be observed before behavior
changes.

### 7.2 Per-Generation Asset Resolution Cache

- Cache repeated stored asset resolutions within one chat generation request.
- Key the cache by asset id and purpose.
- Keep provider wire compatibility, including base64 where providers require
  it.

Done when repeated references to the same stored asset in one generation do not
re-read and re-encode the file.

### 7.3 Realm `charx` Staging

- Evaluate streaming hash/write for Realm `charx` import.
- Avoid reading staged assets into memory all at once if streaming is practical.
- Preserve existing rejection behavior for unsupported or empty assets.

Done when Realm import reduces peak memory without changing accepted/rejected
asset behavior.

### 7.4 Compatibility Tests

- Preserve content-addressed sha256 asset ids.
- Add focused generation asset-resolution tests if no current test covers cache
  behavior.
- Keep provider request shape unchanged.

Done when cache and staging changes are covered without altering provider wire
contracts.

## Acceptance

- Repeated references to the same stored asset in one generation do not re-read
  and re-encode the file.
- Realm import rejects unsupported or empty assets exactly as before.
- Asset ids remain content-addressed by sha256.

## Validation

- `pnpm api:test -- server/fastify/__tests__/realmImport.test.ts`
- Add focused generation asset-resolution tests if no current test covers cache
  behavior.
